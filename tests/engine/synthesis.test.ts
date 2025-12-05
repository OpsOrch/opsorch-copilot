import assert from 'node:assert';
import { test } from 'node:test';
import { synthesizeCopilotAnswer } from '../../src/engine/synthesis.js';
import { LlmClient, ToolResult, LlmMessage, Tool } from '../../src/types.js';

test('synthesizeCopilotAnswer - basic functionality', async () => {
    // Mock LLM that returns a simple response
    const llm: LlmClient = {
        async chat(_messages: LlmMessage[], _tools: Tool[]) {
            return {
                content: JSON.stringify({
                    conclusion: 'Test conclusion',
                    confidence: 0.9
                }),
                toolCalls: []
            };
        }
    };

    const results: ToolResult[] = [
        {
            name: 'query-incidents',
            arguments: {},
            result: {
                incidents: [
                    { id: 'inc-003', title: 'Incident 3' }
                ]
            }
        }
    ];

    const answer = await synthesizeCopilotAnswer(
        'test question',
        results,
        'chat-123',
        llm
    );

    assert.ok(answer.conclusion, 'Conclusion should be defined');
    assert.ok(answer.references, 'References should be defined');

});
