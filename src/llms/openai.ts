import { LlmClient, LlmMessage, Tool, ToolCall } from '../types.js';

const OPENAI_URL = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1/chat/completions';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-5.1';

function mapMessages(messages: LlmMessage[]) {
  return messages
    .filter((m) => m.role !== 'tool') // tool replies are not carried across in this simple client
    .map((m) => {
      return { role: m.role, content: m.content } as { role: string; content: string };
    });
}

function mapTools(tools: Tool[]) {
  return tools.map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description || undefined,
      parameters: t.inputSchema || { type: 'object', properties: {} },
    },
  }));
}

export class OpenAiLlm implements LlmClient {
  constructor(private readonly apiKey: string) {
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY is required for OpenAiLlm');
    }
  }

  async chat(messages: LlmMessage[], tools: Tool[]): Promise<{ content: string; toolCalls: ToolCall[]; conversationId?: string; responseId?: string }> {
    const body: any = {
      model: OPENAI_MODEL,
      messages: mapMessages(messages),
      tools: tools.length ? mapTools(tools) : undefined,
      tool_choice: tools.length ? 'auto' : undefined,
    };

    const res = await fetch(OPENAI_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`OpenAI error ${res.status}: ${text}`);
    }
    const data = (await res.json()) as any;
    const choice = data.choices?.[0]?.message ?? {};
    const toolCalls: ToolCall[] = (choice.tool_calls || []).map((tc: any) => ({
      name: tc.function?.name,
      arguments: (() => {
        try {
          return JSON.parse(tc.function?.arguments || '{}');
        } catch {
          return {};
        }
      })(),
    }));

    return {
      content: choice.content || '',
      toolCalls,
      conversationId: data.id,
      responseId: data.id,
    };
  }
}
