import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LlmClient, LlmMessage, Tool } from '../src/types.js';
import { makeEngine, StubMcp } from './helpers/copilotTestUtils.js';

test('passes conversation history to LLM for contextual follow-up questions', async () => {
    let receivedMessages: LlmMessage[][] = [];

    const llm: LlmClient = {
        async chat(messages: LlmMessage[], tools: Tool[]) {
            receivedMessages.push([...messages]);

            // First turn: "what services are running?"
            if (receivedMessages.length === 1 && tools.length > 0) {
                return {
                    content: 'plan',
                    toolCalls: [{ name: 'query-services', arguments: {} }],
                };
            }

            // First turn synthesis
            if (receivedMessages.length === 2 && tools.length === 0) {
                return {
                    content: JSON.stringify({
                        conclusion: 'The payment-service is running.',
                        evidence: ['Found payment-service in service list'],
                        confidence: 0.95
                    }),
                };
            }

            // Second turn: "are there any incidents related to this service"
            // Should have history of previous conversation
            if (receivedMessages.length === 3 && tools.length > 0) {
                // Verify history is present
                const hasHistory = messages.some(m =>
                    m.role === 'user' && m.content.includes('what services are running')
                );
                assert.ok(hasHistory, 'LLM should receive conversation history');

                return {
                    content: 'plan with context',
                    toolCalls: [{
                        name: 'query-incidents',
                        arguments: {
                            scope: { service: 'payment-service' } // LLM can resolve "this service" with context
                        }
                    }],
                };
            }

            // Second turn synthesis
            return {
                content: JSON.stringify({
                    conclusion: 'No incidents for payment-service',
                    evidence: [],
                    confidence: 0.9
                }),
            };
        },
    };

    const mcp: StubMcp = {
        async listTools() {
            return [
                { name: 'query-services' } as Tool,
                { name: 'query-incidents' } as Tool,
            ];
        },
        async callTool(call) {
            if (call.name === 'query-services') {
                return { name: 'query-services', result: { services: ['payment-service'] } };
            }
            if (call.name === 'query-incidents') {
                // Verify the LLM resolved "this service" correctly
                assert.deepEqual(
                    (call.arguments as any)?.scope,
                    { service: 'payment-service' },
                    'LLM should resolve "this service" to "payment-service" using history'
                );
                return { name: 'query-incidents', result: [] };
            }
            return { name: call.name, result: null };
        },
    };

    const engine = makeEngine(llm, mcp);

    // First turn
    const answer1 = await engine.answer('what services are running?');
    const chatId = answer1.chatId;

    // Second turn - follow-up question referring to "this service"
    const answer2 = await engine.answer('are there any incidents related to this service', { chatId });

    // Verify we got both answers
    assert.ok(answer1.conclusion.includes('payment-service'));
    assert.ok(answer2.conclusion.length > 0);

    // Verify history was passed (checked in LLM mock above)
    assert.ok(receivedMessages.length >= 3, 'Should have made multiple LLM calls with history');
});
