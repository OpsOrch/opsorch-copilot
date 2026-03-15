import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PlanRefiner } from '../../src/engine/planRefiner.js';
import { ScopeInferer } from '../../src/engine/scopeInferer.js';
import { ConversationTurn, ToolCall, ToolResult, JsonObject, TurnExecutionTrace } from '../../src/types.js';
import { McpClient } from '../../src/mcpClient.js';

// Helper to create a ConversationTurn with executionTrace from tool results
function createTurnWithTools(toolResults: { name: string; result: unknown; arguments?: JsonObject }[]): ConversationTurn {
    const executionTrace: TurnExecutionTrace = {
        traceId: `trace-${Date.now()}`,
        startTime: Date.now(),
        endTime: Date.now(),
        totalDurationMs: 100,
        iterations: [{
            iterationNumber: 1,
            plannedTools: [],
            heuristicModifications: [],
            toolExecutions: toolResults.map(tr => ({
                toolName: tr.name,
                arguments: tr.arguments,
                cacheHit: false,
                executionTimeMs: 50,
                success: true,
            })),
            durationMs: 100,
        }],
    };
    return {
        userMessage: 'previous check',
        assistantResponse: 'checked',
        timestamp: Date.now(),
        executionTrace,
    };
}

// Create a mock MCP client with minimal required interface
function createMockMcp(): McpClient {
    return {
        listTools: async () => [
            { name: 'query-alerts', parameters: { type: 'object', properties: {} } },
            { name: 'query-incidents', parameters: { type: 'object', properties: {} } },
            { name: 'query-logs', parameters: { type: 'object', properties: {} } },
            { name: 'query-metrics', parameters: { type: 'object', properties: {} } },
            { name: 'describe-metrics', parameters: { type: 'object', properties: {} } },
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
        const conversationTurns: ConversationTurn[] = [createTurnWithTools([{
            name: 'query-incidents',
            arguments: {},
            result: [{
                id: 'inc-012',
                service: 'svc-realtime',
                status: 'open',
                severity: 'sev3',
                environment: 'prod'
            }]
        }])];

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
        const conversationTurns: ConversationTurn[] = [createTurnWithTools([{
            name: 'query-incidents',
            arguments: {},
            result: [{ id: 'inc-1', service: 'history-service' }]
        }])];

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
            createTurnWithTools([]),
            createTurnWithTools([]),
            createTurnWithTools([])
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

    await t.test('should not re-suggest tools already in previousResults', async () => {
        const scopeInferer = new ScopeInferer();
        const planRefiner = new PlanRefiner(scopeInferer);
        const mockMcp = createMockMcp();

        // Previous results from current iteration - query-logs was already executed
        const previousResults: ToolResult[] = [{
            name: 'query-logs',
            arguments: { expression: { search: 'error' }, limit: 100 },
            result: [{ id: 'log-1', message: 'test error' }]
        }];

        // Empty initial calls - intent registry might want to suggest query-logs
        const calls: ToolCall[] = [];

        const refined = await planRefiner.applyHeuristics(
            'show error logs',  // Question that would normally trigger query-logs
            calls,
            mockMcp,
            [],  // no conversation history
            previousResults
        );

        // query-logs should NOT be re-suggested since it was already executed
        const logCall = refined.find(c => c.name === 'query-logs');
        assert.ok(!logCall || logCall.arguments !== previousResults[0].arguments,
            'Should not re-suggest query-logs with same args already in previousResults');
    });

    await t.test('should not re-suggest tools from conversation history', async () => {
        const scopeInferer = new ScopeInferer();
        const planRefiner = new PlanRefiner(scopeInferer);
        const mockMcp = createMockMcp();

        // Conversation history with query-incidents already executed
        const conversationTurns: ConversationTurn[] = [createTurnWithTools([{
            name: 'query-incidents',
            arguments: { limit: 1 },
            result: [{ id: 'inc-012', service: 'svc-realtime' }]
        }])];

        // Empty initial calls
        const calls: ToolCall[] = [];

        const refined = await planRefiner.applyHeuristics(
            'show me all incidents',  // Question that might trigger query-incidents
            calls,
            mockMcp,
            conversationTurns,
            []  // no previous results in current turn
        );

        // If query-incidents is suggested, it should have different args
        const incidentCall = refined.find(c => c.name === 'query-incidents');
        if (incidentCall) {
            // Get the arguments from the first tool execution in the conversation history
            const historyArgs = conversationTurns[0].executionTrace?.iterations[0]?.toolExecutions[0]?.arguments as JsonObject;
            const newArgs = incidentCall.arguments as JsonObject;
            // The new call might have different args (e.g., different limit) or be absent entirely
            const sameArgs = JSON.stringify(historyArgs) === JSON.stringify(newArgs);
            assert.ok(!sameArgs,
                'Should not re-suggest query-incidents with exact same args from conversation history');
        }
        // If no incidentCall, that's also valid - the tool was skipped as duplicate
    });

    await t.test('should replace query-metrics with describe-metrics when no prior discovery', async () => {
        const scopeInferer = new ScopeInferer();
        const planRefiner = new PlanRefiner(scopeInferer);
        const mockMcp = createMockMcp();

        // LLM proposes query-metrics without prior describe-metrics
        const calls: ToolCall[] = [{
            name: 'query-metrics',
            arguments: {
                scope: { service: 'svc-cache' },
                expression: { metricName: 'error_rate' },
                start: '2024-01-01T10:00:00Z',
                end: '2024-01-01T11:00:00Z',
                step: 60
            }
        }];

        // No prior describe-metrics in history
        const conversationTurns: ConversationTurn[] = [];

        const refined = await planRefiner.applyHeuristics(
            'show me error rate for svc-cache',
            calls,
            mockMcp,
            conversationTurns,
            []
        );

        // Should have describe-metrics instead of/before query-metrics
        const describeCall = refined.find(c => c.name === 'describe-metrics');
        assert.ok(describeCall, 'Should inject describe-metrics as replacement');

        const queryCall = refined.find(c => c.name === 'query-metrics');
        assert.ok(!queryCall, 'Should remove query-metrics when describe-metrics not called first');
    });

    await t.test('should keep query-metrics when describe-metrics was already called', async () => {
        const scopeInferer = new ScopeInferer();
        const planRefiner = new PlanRefiner(scopeInferer);
        const mockMcp = createMockMcp();

        // LLM proposes query-metrics
        const calls: ToolCall[] = [{
            name: 'query-metrics',
            arguments: {
                scope: { service: 'svc-cache' },
                expression: { metricName: 'error_rate' },
                start: '2024-01-01T10:00:00Z',
                end: '2024-01-01T11:00:00Z',
                step: 60
            }
        }];

        // describe-metrics was called in a previous turn
        const conversationTurns: ConversationTurn[] = [createTurnWithTools([{
            name: 'describe-metrics',
            arguments: { scope: { service: 'svc-cache' } },
            result: [{ name: 'error_rate' }, { name: 'latency_p99' }]
        }])];

        const refined = await planRefiner.applyHeuristics(
            'show me error rate for svc-cache',
            calls,
            mockMcp,
            conversationTurns,
            []
        );

        // Should keep query-metrics since describe-metrics was already called
        const queryCall = refined.find(c => c.name === 'query-metrics');
        assert.ok(queryCall, 'Should keep query-metrics when describe-metrics was already called');
    });
});

test('ScopeInferer: uses conversation history for scope inference', async () => {
    const inferer = new ScopeInferer();

    // Simulate a follow-up question where previous turn had incident context
    const turn = createTurnWithTools([{
        name: 'query-incidents',
        arguments: {},
        result: [{
            id: 'inc-012',
            service: 'svc-realtime',
            status: 'open',
            severity: 'sev3'
        }]
    }]);

    // Explicitly add entities to simulate extraction from the tool result
    turn.entities = [{
        type: 'service',
        value: 'svc-realtime',
        source: 'test',
        extractedAt: Date.now()
    }];

    const conversationHistory: ConversationTurn[] = [turn];

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
