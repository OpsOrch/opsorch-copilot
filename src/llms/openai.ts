
import {
  JsonObject,
  JsonValue,
  LlmClient,
  LlmMessage,
  LlmResponse,
  Tool,
  ToolCall,
} from "../types.js";
import { withRetry } from "../engine/retryStrategy.js";

const OPENAI_BASE_URL =
  process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-5.1";

const RESPONSES_URL = `${OPENAI_BASE_URL.replace(/\/+$/, "")}/responses`;

// IMPORTANT: no "array" here, to avoid "array schema missing items" errors.
const ANY_JSON_SCHEMA: JsonObject = {
  type: ["string", "number", "boolean", "object", "null"],
};

function mapMessages(
  messages: LlmMessage[],
): Array<{ role: string; content: JsonValue }> {
  return messages
    .filter((m) => m.role !== "tool") // tool replies are not carried across
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
): Array<{ role: string; content: JsonValue }> {
  const inputMessages = mapMessages(messages);

  if (!chatId) {
    return inputMessages;
  }

  const systemLike = inputMessages.filter(
    (m) => m.role === "system" || m.role === "developer",
  );
  const conversational = inputMessages.filter(
    (m) => m.role === "user" || m.role === "assistant",
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
      type: "function",
      name: t.name,
      description: t.description || undefined,
      parameters,
      strict,
    };
  });
}

function normalizeToolSchema(schema?: JsonObject): JsonObject {
  if (!isJsonObject(schema)) {
    return { type: "object", properties: {}, required: [] };
  }
  return normalizeSchemaNode(schema, false);
}

function normalizeSchemaNode(
  schema: JsonObject,
  optional: boolean,
): JsonObject {
  if (!hasExplicitStructure(schema)) {
    const anyClone = { ...ANY_JSON_SCHEMA };
    return optional ? withNullability(anyClone) : anyClone;
  }

  // anyOf
  if (Array.isArray(schema.anyOf)) {
    const normalizedAnyOf = (schema.anyOf as JsonValue[])
      .map((entry) =>
        isJsonObject(entry) ? normalizeSchemaNode(entry, false) : entry,
      )
      .filter((v): v is JsonObject => isJsonObject(v));
    const base: JsonObject = { ...schema, anyOf: normalizedAnyOf };
    delete base.type;
    delete base.properties;
    delete base.required;
    delete base.items;
    return optional ? withNullability(base) : base;
  }

  // object
  if (schema.type === "object" || isJsonObject(schema.properties)) {
    const properties = isJsonObject(schema.properties) ? schema.properties : {};
    const actualRequired = Array.isArray(schema.required)
      ? (schema.required as string[])
      : [];
    const normalizedProps: Record<string, JsonObject> = {};

    for (const [key, value] of Object.entries(properties)) {
      const child = isJsonObject(value) ? value : {};
      normalizedProps[key] = normalizeSchemaNode(
        child,
        !actualRequired.includes(key),
      );
    }

    const normalized: JsonObject = {
      ...schema,
      type: "object",
      properties: normalizedProps,
      required: Object.keys(normalizedProps),
    };

    const additionalProps = normalizeAdditionalProperties(
      schema.additionalProperties,
    );
    if (additionalProps !== undefined) {
      normalized.additionalProperties = additionalProps;
    } else {
      delete normalized.additionalProperties;
    }

    return optional ? withNullability(normalized) : normalized;
  }

  // array – always enforce items
  if (schema.type === "array" || isJsonObject(schema.items)) {
    const itemsSchema = isJsonObject(schema.items)
      ? normalizeSchemaNode(schema.items, false)
      : { ...ANY_JSON_SCHEMA };

    const normalized: JsonObject = {
      ...schema,
      type: "array",
      items: itemsSchema,
    };
    return optional ? withNullability(normalized) : normalized;
  }

  const normalized = hasExplicitStructure(schema)
    ? { ...schema }
    : { ...ANY_JSON_SCHEMA };
  return optional ? withNullability(normalized) : normalized;
}

function withNullability(schema: JsonObject): JsonObject {
  if (!schema) return { type: ["null"] } as JsonObject;
  if (Array.isArray(schema.anyOf)) {
    const hasNull = schema.anyOf.some((entry) => isNullSchema(entry));
    if (hasNull) return schema;
    return { ...schema, anyOf: [...schema.anyOf, { type: "null" }] };
  }
  if (typeof schema.type === "string") {
    if (schema.type === "null") return schema;
    return { ...schema, type: [schema.type, "null"] };
  }
  if (Array.isArray(schema.type)) {
    if (schema.type.includes("null")) return schema;
    return { ...schema, type: [...schema.type, "null"] };
  }
  return { ...schema, anyOf: [schema, { type: "null" }] };
}

function isNullSchema(entry: unknown): boolean {
  if (!entry || typeof entry !== "object") return false;
  const obj = entry as JsonObject;
  if (Array.isArray(obj.type)) {
    return (obj.type as JsonValue[]).includes("null");
  }
  return obj.type === "null";
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function allowsAdditionalProperties(schema?: JsonObject): boolean {
  if (!schema) return false;
  const anyOfEntries = Array.isArray(schema.anyOf)
    ? (schema.anyOf as JsonValue[])
    : undefined;
  if (anyOfEntries?.length) {
    return anyOfEntries.some((entry) =>
      isJsonObject(entry)
        ? allowsAdditionalProperties(entry)
        : false,
    );
  }

  const type = schema.type;
  const isObjectType =
    type === "object" ||
    (Array.isArray(type) && (type as JsonValue[]).includes("object")) ||
    (!!schema.properties && typeof schema.properties === "object");

  if (isObjectType) {
    const additional = schema.additionalProperties;
    if (additional === false) {
      const props = schema.properties ?? {};
      return Object.values(props).some(
        (child) => isJsonObject(child) && allowsAdditionalProperties(child),
      );
    }
    // undefined, true, or object -> still allows unspecified keys in strict mode
    return true;
  }

  if (
    type === "array" ||
    (Array.isArray(type) && type.includes("array")) ||
    schema.items
  ) {
    const items = schema.items;
    if (isJsonObject(items)) {
      return allowsAdditionalProperties(items);
    }
  }

  return false;
}

function hasExplicitStructure(schema: JsonObject): boolean {
  if (!schema) return false;
  if (typeof schema.type === "string" || Array.isArray(schema.type))
    return true;
  if (schema.anyOf || schema.oneOf || schema.allOf)
    return true;
  if (schema.enum || schema.const) return true;
  if (schema.properties || schema.items) return true;
  if (schema.$ref) return true;
  return false;
}

function normalizeAdditionalProperties(
  value: unknown,
): boolean | JsonObject | undefined {
  if (typeof value === "boolean") {
    return value;
  }
  if (isJsonObject(value)) {
    const normalized = normalizeSchemaNode(value, false);
    return hasExplicitStructure(normalized)
      ? normalized
      : { ...ANY_JSON_SCHEMA };
  }
  if (value === undefined) {
    return undefined;
  }
  return { ...ANY_JSON_SCHEMA };
}

export class OpenAiLlm implements LlmClient {
  constructor(private readonly apiKey: string) {
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY is required for OpenAiLlm");
    }
  }

  async chat(messages: LlmMessage[], tools: Tool[]): Promise<LlmResponse> {
    const input = buildInputForResponses(messages, undefined);

    const body: Record<string, unknown> = {
      model: OPENAI_MODEL,
      input,
      tools: mapToolsForResponses(tools),
      tool_choice: tools.length ? "auto" : undefined,
      store: true,
    };

    console.log(
      "[OpenAI] Request:",
      JSON.stringify({
        model: body.model,
        inputMessages: input.length,
        toolsCount: tools.length,
        tool_choice: body.tool_choice,
      }),
    );

    try {
      const res = await withRetry(
        async () => {
          const response = await fetch(RESPONSES_URL, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${this.apiKey}`,
            },
            body: JSON.stringify(body),
          });

          if (!response.ok) {
            const text = await response.text();
            console.error(`[OpenAI] API error ${response.status}`);
            console.error(`[OpenAI] Error details:`, text);

            // Throw for retryable errors (rate limits, 5xx)
            if (response.status === 429 || response.status >= 500) {
              throw new Error(`OpenAI API error ${response.status}: ${text}`);
            }

            // Don't retry for 4xx errors (except 429)
            console.warn(
              "[OpenAI] Non-retryable error, returning empty response",
            );
            return null; // Signal non-retryable error
          }

          return response;
        },
        { maxRetries: 3, baseDelayMs: 1000 },
        "llm-openai",
      );

      // Handle non-retryable error
      if (res === null) {
        return {
          content: "",
          toolCalls: [],
        };
      }

      const data = (await res.json()) as JsonObject;
      console.log("[OpenAI] raw response:", JSON.stringify(data));

      const outputs: JsonObject[] = Array.isArray(data.output)
        ? (data.output as JsonObject[])
        : [];

      // Diagnostic logging for tool call extraction
      console.log(
        `[OpenAI] Extraction: Found ${outputs.length} output item(s)`,
      );
      if (outputs.length > 0) {
        console.log(
          `[OpenAI] Extraction: Output types: ${outputs.map((o) => o.type).join(", ")}`,
        );
      }

      // Extract function calls from Responses output
      const toolCalls: ToolCall[] = [];
      for (const item of outputs) {
        // Case 1: Direct function_call type
        if (item.type === "function_call") {
          const rawArgs = (item.arguments as string) ?? "{}";
          let parsedArgs: JsonObject;
          try {
            const parsed =
              typeof rawArgs === "string" ? JSON.parse(rawArgs) : rawArgs;
            if (isJsonObject(parsed)) {
              parsedArgs = parsed;
            } else {
              parsedArgs = {};
            }
          } catch {
            parsedArgs = {};
          }

          toolCalls.push({
            name: String(item.name),
            arguments: parsedArgs,
            callId: typeof item.call_id === "string" ? item.call_id : undefined,
          });
          continue;
        }

        // Case 2: Item has content array - check for function_call inside
        if (Array.isArray(item.content)) {
          for (const c of item.content) {
            if (isJsonObject(c) && c.type === "function_call") {
              const rawArgs = (c.arguments as string) ?? "{}";
              let parsedArgs: JsonObject;
              try {
                const parsed =
                  typeof rawArgs === "string" ? JSON.parse(rawArgs) : rawArgs;
                if (isJsonObject(parsed)) {
                  parsedArgs = parsed;
                } else {
                  parsedArgs = {};
                }
              } catch {
                parsedArgs = {};
              }

              toolCalls.push({
                name: String(c.name),
                arguments: parsedArgs,
                callId: typeof c.call_id === "string" ? c.call_id : undefined,
              });
            }
          }
        }
      }

      // Extract human-readable text content
      const contentParts: string[] = [];

      if (typeof data.output_text === "string") {
        contentParts.push(data.output_text);
      } else {
        for (const item of outputs) {
          if (
            item.type === "output_text" &&
            isJsonObject(item.output_text) &&
            typeof item.output_text.text === "string"
          ) {
            contentParts.push(item.output_text.text);
          }

          if (Array.isArray(item.content)) {
            for (const c of item.content) {
              if (
                isJsonObject(c) &&
                c.type === "output_text" &&
                typeof c.text === "string"
              ) {
                contentParts.push(c.text);
              }
            }
          }
        }
      }

      const content = contentParts.join(" ").trim();

      // Diagnostic logging for extraction results
      console.log(
        `[OpenAI] Extraction: Extracted ${toolCalls.length} tool call(s)`,
      );
      if (toolCalls.length > 0) {
        console.log(
          `[OpenAI] Extraction: Tool names: ${toolCalls.map((t) => t.name).join(", ")}`,
        );
      } else if (tools.length > 0) {
        // Tools were available but none extracted - this might indicate a bug
        console.warn(
          `[OpenAI] Extraction: No tool calls extracted despite ${tools.length} tool(s) being available`,
        );
        console.warn(
          `[OpenAI] Extraction: Response structure for debugging:`,
          JSON.stringify(
            {
              outputCount: outputs.length,
              outputTypes: outputs.map((o) => o.type),
              hasContent: outputs.some((o) => Array.isArray(o.content)),
              contentStructure: outputs
                .filter((o) => Array.isArray(o.content))
                .map((o) => ({
                  type: o.type,
                  contentTypes: (o.content as JsonObject[]).map((c) => c.type),
                })),
            },
            null,
            2,
          ),
        );
      }

      return {
        content,
        toolCalls,
      };
    } catch (error) {
      // Catch ANY error (network, parsing, etc.) and return empty response
      console.error("[OpenAI] Request failed:", error);
      console.warn("[OpenAI] Returning empty response due to error");
      return {
        content: "",
        toolCalls: [],
      };
    }
  }
}
