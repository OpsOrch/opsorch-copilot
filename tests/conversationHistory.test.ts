import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LlmClient, LlmMessage, Tool, JsonObject } from '../src/types.js';
import { makeEngine, StubMcp } from './helpers/copilotTestUtils.js';

test('passes conversation history to LLM for contextual follow-up questions', async () => {
    const receivedMessages: LlmMessage[][] = [];
    const toolCalls: Array<{ name: string; arguments?: JsonObject }> = [];

    const llm: LlmClient = {
        async chat(messages: LlmMessage[], tools: Tool[]) {
            receivedMessages.push([...messages]);
            const latestUserMessage = [...messages].reverse().find((message) => message.role === 'user')?.content ?? '';

            if (tools.length > 0 && latestUserMessage === 'what services are running?') {
                return {
                    content: 'plan',
                    toolCalls: [{ name: 'query-services', arguments: {} }],
                };
            }

            if (tools.length > 0 && latestUserMessage === 'are there any incidents related to this service') {
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

            return {
                content: JSON.stringify({
                    conclusion: latestUserMessage.includes('what services are running')
                        ? 'The payment-service is running.'
                        : 'No incidents for payment-service',
                    evidence: [],
                    confidence: 0.9,
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
            toolCalls.push({ name: call.name, arguments: call.arguments as JsonObject });
            if (call.name === 'query-services') {
                return { name: 'query-services', result: { services: ['payment-service'] } };
            }
            if (call.name === 'query-incidents') {
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
    const incidentCall = toolCalls.find((call) => call.name === 'query-incidents');
    assert.ok(incidentCall, 'Expected query-incidents to run on follow-up');
    assert.deepEqual(
        incidentCall?.arguments?.scope,
        { service: 'payment-service' },
        'Follow-up incident query should inherit the referenced service'
    );

    assert.ok(receivedMessages.length >= 3, 'Should have made multiple LLM calls with history');
});

test('passes tool results from previous turns to LLM', async () => {
    const receivedMessages: LlmMessage[][] = [];

    const llm: LlmClient = {
        async chat(messages: LlmMessage[], _tools: Tool[]) {
            receivedMessages.push([...messages]);
            const latestUserMessage = [...messages].reverse().find((message) => message.role === 'user')?.content ?? '';

            if (latestUserMessage === 'check services') {
                return {
                    content: 'Checking services...',
                    toolCalls: [{ name: 'query-services', arguments: {} }],
                };
            }

            if (latestUserMessage === 'what did it return?') {
                return {
                    content: 'No additional tool needed.',
                };
            }

            return {
                content: JSON.stringify({
                    conclusion: 'The payment-service is active.',
                    evidence: [],
                    confidence: 0.9
                }),
            };
        }
    };

    const mcp: StubMcp = {
        async listTools() { return [{ name: 'query-services' }] as Tool[]; },
        async callTool(call) {
            if (call.name === 'query-services') {
                return { name: 'query-services', result: { services: ['payment-service'] } };
            }
            return { name: call.name, result: null };
        }
    };

    const engine = makeEngine(llm, mcp);

    // Turn 1
    const ans1 = await engine.answer('check services');

    // Turn 2
    await engine.answer('what did it return?', { chatId: ans1.chatId });

    const followUpPlanningMessages = receivedMessages.find((messages) =>
        messages.some((message) => message.role === 'user' && message.content === 'what did it return?')
    );
    assert.ok(followUpPlanningMessages, 'Expected a follow-up planning call');
    const toolMessage = followUpPlanningMessages.find(m => m.role === 'tool');
    assert.ok(toolMessage, 'History should contain tool messages');
    assert.ok(toolMessage.content.includes('payment-service'), 'History should contain tool result content');
    assert.ok(receivedMessages.length >= 3);
});
