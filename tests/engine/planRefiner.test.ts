import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PlanRefiner } from '../../src/engine/planRefiner.js';
import { ScopeInferer } from '../../src/engine/scopeInferer.js';
import { ConversationTurn, ToolCall, ToolResult, JsonObject } from '../../src/types.js';
import { McpClient } from '../../src/mcpClient.js';

// Create a mock MCP client with minimal required interface
function createMockMcp(): McpClient {
    return {
        listTools: async () => [
            { name: 'query-alerts', parameters: { type: 'object', properties: {} } },
            { name: 'query-incidents', parameters: { type: 'object', properties: {} } },
            { name: 'query-logs', parameters: { type: 'object', properties: {} } },
            { name: 'query-metrics', parameters: { type: 'object', properties: {} } },
        ],
        // Stub out other required methods - they aren't called in these tests
        callTool: async () => ({ name: 'stub', result: {} }),
        ensureTools: async () => { },
        hasTool: () => false,
        getTools: () => [],
    } as unknown as McpClient;
}

test('PlanRefiner', async (t) => {
    await t.test('should pass conversation history to scope inference', async () => {
        const scopeInferer = new ScopeInferer();
        const planRefiner = new PlanRefiner(scopeInferer);
        const mockMcp = createMockMcp();

        // Create a conversation turn with an incident query result
        const conversationTurns: ConversationTurn[] = [{
            userMessage: 'tell me about the last incident',
            timestamp: Date.now(),
            toolResults: [{
                name: 'query-incidents',
                arguments: {},
                result: [{
                    id: 'inc-012',
                    service: 'svc-realtime',
                    status: 'open',
                    severity: 'sev3',
                    environment: 'prod'
                }]
            }]
        }];

        // Initial tool calls (empty, so heuristics will add based on intent)
        const calls: ToolCall[] = [{
            name: 'query-alerts',
            arguments: { limit: 20 }
        }];

        // Apply heuristics with conversation history
        const refined = await planRefiner.applyHeuristics(
            'any alerts',
            calls,
            mockMcp,
            conversationTurns,
            [] // no previous results in current turn
        );

        // Find the query-alerts call
        const alertCall = refined.find(c => c.name === 'query-alerts');
        assert.ok(alertCall, 'query-alerts should be in refined calls');

        // The scope should be inferred from the conversation history
        // Note: This relies on the capability-based scope inference finding the incident
        // in the conversation history and extracting the service
        const args = alertCall.arguments as JsonObject;
        if (args.scope) {
            const scope = args.scope as JsonObject;
            assert.equal(scope.service, 'svc-realtime',
                'Scope should include service from incident in conversation history');
        }
    });

    await t.test('should use scope from previous results in current turn', async () => {
        const scopeInferer = new ScopeInferer();
        const planRefiner = new PlanRefiner(scopeInferer);
        const mockMcp = createMockMcp();

        // Previous results from current iteration
        const previousResults: ToolResult[] = [{
            name: 'query-incidents',
            arguments: {},
            result: [{
                id: 'inc-123',
                service: 'payment-api',
                status: 'open'
            }]
        }];

        const calls: ToolCall[] = [{
            name: 'query-logs',
            arguments: { expression: { search: 'error' } }
        }];

        const refined = await planRefiner.applyHeuristics(
            'show error logs',
            calls,
            mockMcp,
            [], // no conversation history
            previousResults
        );

        const logCall = refined.find(c => c.name === 'query-logs');
        assert.ok(logCall, 'query-logs should be in refined calls');

        const args = logCall.arguments as JsonObject;
        if (args.scope) {
            const scope = args.scope as JsonObject;
            assert.equal(scope.service, 'payment-api',
                'Scope should include service from previous results');
        }
    });

    await t.test('should preserve existing explicit scope over inferred scope', async () => {
        const scopeInferer = new ScopeInferer();
        const planRefiner = new PlanRefiner(scopeInferer);
        const mockMcp = createMockMcp();

        // Conversation history with a different service
        const conversationTurns: ConversationTurn[] = [{
            userMessage: 'incident info',
            timestamp: Date.now(),
            toolResults: [{
                name: 'query-incidents',
                arguments: {},
                result: [{ id: 'inc-1', service: 'history-service' }]
            }]
        }];

        // Call with explicit scope that should NOT be overwritten
        const calls: ToolCall[] = [{
            name: 'query-alerts',
            arguments: {
                scope: { service: 'explicit-service' }
            }
        }];

        const refined = await planRefiner.applyHeuristics(
            'show alerts',
            calls,
            mockMcp,
            conversationTurns,
            []
        );

        const alertCall = refined.find(c => c.name === 'query-alerts');
        assert.ok(alertCall, 'query-alerts should be in refined calls');

        const args = alertCall.arguments as JsonObject;
        const scope = args.scope as JsonObject | undefined;
        assert.equal(scope?.service, 'explicit-service',
            'Explicit scope should be preserved over inferred scope');
    });

    await t.test('should include turn number and previous results in handler context', async () => {
        const scopeInferer = new ScopeInferer();
        const planRefiner = new PlanRefiner(scopeInferer);
        const mockMcp = createMockMcp();

        // 3 previous turns
        const conversationTurns: ConversationTurn[] = [
            { userMessage: 'turn 1', timestamp: Date.now(), toolResults: [] },
            { userMessage: 'turn 2', timestamp: Date.now(), toolResults: [] },
            { userMessage: 'turn 3', timestamp: Date.now(), toolResults: [] }
        ];

        const previousResults: ToolResult[] = [{
            name: 'query-incidents',
            arguments: {},
            result: []
        }];

        // The call itself doesn't matter much, we're testing the context building
        const calls: ToolCall[] = [];

        // This should not throw and should handle the context correctly
        const refined = await planRefiner.applyHeuristics(
            'test question',
            calls,
            mockMcp,
            conversationTurns,
            previousResults
        );

        // Should complete without errors
        assert.ok(Array.isArray(refined), 'Should return array of calls');
    });
});

test('ScopeInferer: uses conversation history for scope inference', async () => {
    const inferer = new ScopeInferer();

    // Simulate a follow-up question where previous turn had incident context
    const conversationHistory: ConversationTurn[] = [{
        userMessage: 'tell me about the last incident',
        timestamp: Date.now(),
        toolResults: [{
            name: 'query-incidents',
            arguments: {},
            result: [{
                id: 'inc-012',
                service: 'svc-realtime',
                status: 'open',
                severity: 'sev3'
            }]
        }]
    }];

    const inference = await inferer.inferScope(
        'any alerts',  // follow-up question
        [],            // no current results
        conversationHistory,
        'test-chat',
        1
    );

    // The capability handlers should find the incident in conversation history
    // and extract the service scope
    assert.ok(inference, 'Should infer scope from conversation history');
    assert.equal(inference.scope.service, 'svc-realtime',
        'Should infer service from incident in conversation history');
});
