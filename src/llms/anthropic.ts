import { randomUUID } from 'node:crypto';
import {
    JsonObject,
    LlmClient,
    LlmMessage,
    LlmResponse,
    Tool,
    ToolCall,
} from '../types.js';

const ANTHROPIC_BASE_URL = process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com/v1';
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4.5';
const ANTHROPIC_VERSION = '2025-09-29';

/**
 * Map internal Tool definitions to Anthropic tools format.
 */
function mapToolsForAnthropic(tools: Tool[]) {
    if (!tools.length) return undefined;

    return tools.map((t) => ({
        name: t.name,
        description: t.description || 'No description provided.',
        input_schema: t.inputSchema || { type: 'object', properties: {} },
    }));
}

/**
 * Map internal messages to Anthropic format.
 * System messages are extracted separately in Anthropic API.
 */
function mapMessagesForAnthropic(
    messages: LlmMessage[]
): { system?: string; messages: Array<{ role: string; content: any }> } {
    const systemMessages = messages.filter((m) => m.role === 'system');
    const nonSystemMessages = messages.filter((m) => m.role !== 'system' && m.role !== 'tool');

    const system = systemMessages.map((m) => m.content).join('\n\n') || undefined;

    const anthropicMessages = nonSystemMessages.map((m) => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content,
    }));

    return { system, messages: anthropicMessages };
}

/**
 * Anthropic LLM client implementation.
 */
export class AnthropicLlm implements LlmClient {
    constructor(private readonly apiKey: string) {
        if (!apiKey) {
            throw new Error('ANTHROPIC_API_KEY is required for AnthropicLlm');
        }
    }

    async chat(
        messages: LlmMessage[],
        tools: Tool[],
    ): Promise<LlmResponse> {
        const { system, messages: anthropicMessages } = mapMessagesForAnthropic(messages);

        const body: any = {
            model: ANTHROPIC_MODEL,
            max_tokens: 4096,
            messages: anthropicMessages,
            system,
        };

        // Add tools if available
        if (tools.length > 0) {
            body.tools = mapToolsForAnthropic(tools);
        }

        const res = await fetch(`${ANTHROPIC_BASE_URL}/messages`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': this.apiKey,
                'anthropic-version': ANTHROPIC_VERSION,
            },
            body: JSON.stringify(body),
        });

        if (!res.ok) {
            const text = await res.text();
            throw new Error(`Anthropic error ${res.status}: ${text}`);
        }

        const data: any = await res.json();
        console.log('[Anthropic] raw response:', JSON.stringify(data));

        // Extract tool calls from response
        const toolCalls: ToolCall[] = [];
        let textContent = '';

        const content = data.content || [];
        for (const block of content) {
            if (block.type === 'text') {
                textContent += block.text || '';
            } else if (block.type === 'tool_use') {
                toolCalls.push({
                    name: block.name,
                    arguments: (block.input || {}) as JsonObject,
                    callId: block.id,
                });
            }
        }

        return {
            content: textContent.trim(),
            toolCalls,
        };
    }
}
