import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LlmClient, LlmMessage, Tool } from '../src/types.js';
import { makeEngine, StubMcp } from './helpers/copilotTestUtils.js';

test('injects anchorTime into system prompt', async () => {
    let systemPromptFoundTime = false;
    let capturedTime: string | undefined;

    const llm: LlmClient = {
        async chat(messages: LlmMessage[], _tools: Tool[]) {
            // Inspect system messages
            for (const msg of messages) {
                if (msg.role === 'system' && msg.content.startsWith('Current Time: ')) {
                    systemPromptFoundTime = true;
                    capturedTime = msg.content.replace('Current Time: ', '');
                }
            }

            return {
                content: JSON.stringify({ conclusion: 'done' }),
                toolCalls: [],
            };
        },
    };

    const mcp: StubMcp = {
        async listTools() {
            return [];
        },
        async callTool(call) {
            return { name: call.name, result: {} };
        },
    };

    const engine = makeEngine(llm, mcp);
    await engine.answer('hello');

    assert.ok(systemPromptFoundTime, 'Should have found system prompt with Current Time');
    assert.ok(capturedTime, 'Should have captured a time string');

    // Validate ISO format
    assert.match(capturedTime!, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/, 'Time should be ISO formatted');
});
