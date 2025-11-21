import { randomUUID } from 'node:crypto';
import {
  JsonObject,
  JsonValue,
  LlmClient,
  LlmMessage,
  LlmResponse,
  Tool,
  ToolCall,
} from '../types.js';

const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-5.1';

const RESPONSES_URL = `${OPENAI_BASE_URL.replace(/\/+$/, '')}/responses`;

// IMPORTANT: no "array" here, to avoid "array schema missing items" errors.
const ANY_JSON_SCHEMA: JsonObject = {
  type: ['string', 'number', 'boolean', 'object', 'null'],
};

function mapMessages(messages: LlmMessage[]): Array<{ role: string; content: any }> {
  return messages
    .filter((m) => m.role !== 'tool') // tool replies are not carried across
    .map((m) => ({
      role: m.role,
      content: m.content,
    }));
}

/**
 * When chatId is present, we rely on previous_response_id for context and only send:
 * - all system/developer messages
 * - the latest user/assistant message
 * When chatId is not present, we send the full mapped history.
 */
function buildInputForResponses(
  messages: LlmMessage[],
  chatId?: string,
): Array<{ role: string; content: any }> {
  const inputMessages = mapMessages(messages);

  if (!chatId) {
    return inputMessages;
  }

  const systemLike = inputMessages.filter(
    (m) => m.role === 'system' || m.role === 'developer',
  );
  const conversational = inputMessages.filter(
    (m) => m.role === 'user' || m.role === 'assistant',
  );

  const lastTurn = conversational[conversational.length - 1];
  if (!lastTurn) {
    // Fallback: if we somehow have no user/assistant messages, just send everything.
    return inputMessages;
  }

  return [...systemLike, lastTurn];
}

/**
 * Map internal Tool definitions to Responses API tools format.
 */
function mapToolsForResponses(tools: Tool[]) {
  if (!tools.length) return undefined;

  return tools.map((t) => {
    const parameters = normalizeToolSchema(t.inputSchema);
    const strict = allowsAdditionalProperties(parameters) ? undefined : true;
    return {
      type: 'function',
      name: t.name,
      description: t.description || undefined,
      parameters,
      strict,
    };
  });
}

function normalizeToolSchema(schema?: JsonObject): JsonObject {
  if (!isJsonObject(schema)) {
    return { type: 'object', properties: {}, required: [] };
  }
  return normalizeSchemaNode(schema, false);
}

function normalizeSchemaNode(schema: JsonObject, optional: boolean): JsonObject {
  if (!hasExplicitStructure(schema)) {
    const anyClone = { ...ANY_JSON_SCHEMA };
    return optional ? withNullability(anyClone) : anyClone;
  }

  // anyOf
  if (Array.isArray((schema as any).anyOf)) {
    const normalizedAnyOf = ((schema as any).anyOf as unknown[])
      .map((entry) => (isJsonObject(entry) ? normalizeSchemaNode(entry, false) : entry))
      .filter(Boolean) as JsonValue[];
    const base: JsonObject = { ...schema, anyOf: normalizedAnyOf };
    delete (base as any).type;
    delete (base as any).properties;
    delete (base as any).required;
    delete (base as any).items;
    return optional ? withNullability(base) : base;
  }

  // object
  if (schema.type === 'object' || isJsonObject(schema.properties)) {
    const properties = isJsonObject(schema.properties) ? schema.properties : {};
    const actualRequired = Array.isArray(schema.required) ? (schema.required as string[]) : [];
    const normalizedProps: Record<string, JsonObject> = {};

    for (const [key, value] of Object.entries(properties)) {
      const child = isJsonObject(value) ? value : {};
      normalizedProps[key] = normalizeSchemaNode(child, !actualRequired.includes(key));
    }

    const normalized: JsonObject = {
      ...schema,
      type: 'object',
      properties: normalizedProps,
      required: Object.keys(normalizedProps),
    };

    const additionalProps = normalizeAdditionalProperties((schema as any).additionalProperties);
    if (additionalProps !== undefined) {
      normalized.additionalProperties = additionalProps;
    } else {
      delete normalized.additionalProperties;
    }

    return optional ? withNullability(normalized) : normalized;
  }

  // array – always enforce items
  if (schema.type === 'array' || isJsonObject(schema.items)) {
    const itemsSchema = isJsonObject(schema.items)
      ? normalizeSchemaNode(schema.items, false)
      : { ...ANY_JSON_SCHEMA };

    const normalized: JsonObject = {
      ...schema,
      type: 'array',
      items: itemsSchema,
    };
    return optional ? withNullability(normalized) : normalized;
  }

  const normalized = hasExplicitStructure(schema) ? { ...schema } : { ...ANY_JSON_SCHEMA };
  return optional ? withNullability(normalized) : normalized;
}

function withNullability(schema: JsonObject): JsonObject {
  if (!schema) return { type: ['null'] } as JsonObject;
  if (Array.isArray(schema.anyOf)) {
    const hasNull = schema.anyOf.some((entry) => isNullSchema(entry));
    if (hasNull) return schema;
    return { ...schema, anyOf: [...schema.anyOf, { type: 'null' }] };
  }
  if (typeof schema.type === 'string') {
    if (schema.type === 'null') return schema;
    return { ...schema, type: [schema.type, 'null'] };
  }
  if (Array.isArray(schema.type)) {
    if (schema.type.includes('null')) return schema;
    return { ...schema, type: [...schema.type, 'null'] };
  }
  return { ...schema, anyOf: [schema, { type: 'null' }] };
}

function isNullSchema(entry: unknown): boolean {
  if (!entry || typeof entry !== 'object') return false;
  if (Array.isArray((entry as any).type)) {
    return (entry as any).type.includes('null');
  }
  return (entry as any).type === 'null';
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function allowsAdditionalProperties(schema?: JsonObject): boolean {
  if (!schema) return false;
  const anyOfEntries = Array.isArray((schema as any).anyOf) ? ((schema as any).anyOf as unknown[]) : undefined;
  if (anyOfEntries?.length) {
    return anyOfEntries.some((entry) =>
      isJsonObject(entry as JsonObject) ? allowsAdditionalProperties(entry as JsonObject) : false,
    );
  }

  const type = (schema as any).type;
  const isObjectType =
    type === 'object' ||
    (Array.isArray(type) && type.includes('object')) ||
    (!!schema.properties && typeof schema.properties === 'object');

  if (isObjectType) {
    const additional = (schema as any).additionalProperties;
    if (additional === false) {
      const props = schema.properties ?? {};
      return Object.values(props).some((child) => isJsonObject(child) && allowsAdditionalProperties(child));
    }
    // undefined, true, or object -> still allows unspecified keys in strict mode
    return true;
  }

  if (type === 'array' || (Array.isArray(type) && type.includes('array')) || schema.items) {
    const items = schema.items;
    if (isJsonObject(items)) {
      return allowsAdditionalProperties(items);
    }
  }

  return false;
}

function hasExplicitStructure(schema: JsonObject): boolean {
  if (!schema) return false;
  if (typeof schema.type === 'string' || Array.isArray(schema.type)) return true;
  if (schema.anyOf || (schema as any).oneOf || (schema as any).allOf) return true;
  if ((schema as any).enum || (schema as any).const) return true;
  if (schema.properties || schema.items) return true;
  if ((schema as any).$ref) return true;
  return false;
}

function normalizeAdditionalProperties(value: unknown): boolean | JsonObject | undefined {
  if (typeof value === 'boolean') {
    return value;
  }
  if (isJsonObject(value)) {
    const normalized = normalizeSchemaNode(value, false);
    return hasExplicitStructure(normalized) ? normalized : { ...ANY_JSON_SCHEMA };
  }
  if (value === undefined) {
    return undefined;
  }
  return { ...ANY_JSON_SCHEMA };
}

export class OpenAiLlm implements LlmClient {
  constructor(private readonly apiKey: string) {
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY is required for OpenAiLlm');
    }
  }

  async chat(
    messages: LlmMessage[],
    tools: Tool[],
  ): Promise<LlmResponse> {
    const input = buildInputForResponses(messages, undefined);

    const body: any = {
      model: OPENAI_MODEL,
      input,
      tools: mapToolsForResponses(tools),
      tool_choice: tools.length ? 'auto' : undefined,
      store: true,
    };

    console.log('[OpenAI] Request:', JSON.stringify({
      model: body.model,
      inputMessages: input.length,
      toolsCount: tools.length,
      tool_choice: body.tool_choice,
    }));

    try {
      const res = await fetch(RESPONSES_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const text = await res.text();
        console.error(`[OpenAI] API error ${res.status}`);
        console.error(`[OpenAI] Error details:`, text);

        // Don't throw - return empty response to allow graceful fallback
        // The planner/synthesis will handle empty responses appropriately
        console.warn('[OpenAI] Returning empty response to trigger fallback mechanisms');
        return {
          content: '',
          toolCalls: [],
        };
      }

      const data: any = await res.json();
      console.log('[OpenAI] raw response:', JSON.stringify(data));

      const outputs: any[] = Array.isArray(data.output) ? data.output : [];

      // Extract function calls from Responses output
      const toolCalls: ToolCall[] = [];
      for (const item of outputs) {
        if (item?.type === 'function_call') {
          const rawArgs = item.arguments ?? '{}';
          let parsedArgs: any;
          try {
            parsedArgs = typeof rawArgs === 'string' ? JSON.parse(rawArgs) : rawArgs;
          } catch {
            parsedArgs = {};
          }

          toolCalls.push({
            name: item.name,
            arguments: parsedArgs,
            callId: typeof item.call_id === 'string' ? item.call_id : undefined,
          });
          continue;
        }

        if (Array.isArray(item?.content)) {
          for (const c of item.content) {
            if (c?.type === 'function_call') {
              const rawArgs = c.arguments ?? '{}';
              let parsedArgs: any;
              try {
                parsedArgs = typeof rawArgs === 'string' ? JSON.parse(rawArgs) : rawArgs;
              } catch {
                parsedArgs = {};
              }

              toolCalls.push({
                name: c.name,
                arguments: parsedArgs,
                callId: typeof c.call_id === 'string' ? c.call_id : undefined,
              });
            }
          }
        }
      }

      // Extract human-readable text content
      const contentParts: string[] = [];

      if (typeof data.output_text === 'string') {
        contentParts.push(data.output_text);
      } else {
        for (const item of outputs) {
          if (item?.type === 'output_text' && item?.output_text?.text) {
            contentParts.push(item.output_text.text);
          }

          if (Array.isArray(item?.content)) {
            for (const c of item.content) {
              if (c?.type === 'output_text' && typeof c.text === 'string') {
                contentParts.push(c.text);
              }
            }
          }
        }
      }


      const content = contentParts.join(' ').trim();

      return {
        content,
        toolCalls,
      };
    } catch (error) {
      // Catch ANY error (network, parsing, etc.) and return empty response
      console.error('[OpenAI] Request failed:', error);
      console.warn('[OpenAI] Returning empty response due to error');
      return {
        content: '',
        toolCalls: [],
      };
    }
  }
}
