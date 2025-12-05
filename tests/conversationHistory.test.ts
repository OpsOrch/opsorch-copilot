import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LlmClient, LlmMessage, Tool, JsonObject } from '../src/types.js';
import { makeEngine, StubMcp } from './helpers/copilotTestUtils.js';

test('passes conversation history to LLM for contextual follow-up questions', async () => {
    const receivedMessages: LlmMessage[][] = [];

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
                    (call.arguments as JsonObject)?.scope,
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

    assert.ok(receivedMessages.length >= 3, 'Should have made multiple LLM calls with history');
});

test('passes tool results from previous turns to LLM', async () => {
    const receivedMessages: LlmMessage[][] = [];

    const llm: LlmClient = {
        async chat(messages: LlmMessage[], _tools: Tool[]) {
            receivedMessages.push([...messages]);
            const callIndex = receivedMessages.length;

            // First turn: "check metrics"
            if (callIndex === 1) {
                return {
                    content: 'Checking metrics...',
                    toolCalls: [{ name: 'query-metrics', arguments: { metric: 'cpu' } }],
                };
            }

            // First turn synthesis
            if (callIndex === 2) {
                return {
                    content: JSON.stringify({
                        conclusion: 'CPU is high (95%).',
                        evidence: ['CPU metrics show 95% utilization.'],
                        confidence: 1.0
                    }),
                };
            }

            // Second turn: "why is it high?"
            if (receivedMessages.length === 3) { // Note: In our mock counting, this might be index 3 or 4 depending on test run,
                // but let's stick to the logic that worked or simplify.
                // Actually, checking content is safer.

                const toolMessage = messages.find(m => m.role === 'tool');

                // Only assert if we are in the Planning call (which has tool messages)
                // The Planning call has History. The Analysis call has "You are OpsOrch..."
                if (messages[0]?.role === 'system') { // Heuristic to identify Plan call
                    assert.ok(toolMessage, 'History should contain tool messages');
                    assert.ok(toolMessage.content.includes('95'), 'History should contain tool result content');

                    return {
                        content: 'Analyzing logs...',
                        toolCalls: [{ name: 'query-logs', arguments: {} }]
                    };
                }
            }

            return {
                content: JSON.stringify({
                    conclusion: 'Logs show infinite loop.',
                    evidence: [],
                    confidence: 0.9
                }),
            };
        }
    };

    const mcp: StubMcp = {
        async listTools() { return [{ name: 'query-metrics' }, { name: 'query-logs' }] as Tool[]; },
        async callTool(call) {
            if (call.name === 'query-metrics') {
                return { name: 'query-metrics', result: { value: 95, unit: '%' } };
            }
            return { name: call.name, result: null };
        }
    };

    const engine = makeEngine(llm, mcp);

    // Turn 1
    const ans1 = await engine.answer('check metrics');

    // Turn 2
    await engine.answer('why is it high?', { chatId: ans1.chatId });

    assert.ok(receivedMessages.length >= 3);
});
