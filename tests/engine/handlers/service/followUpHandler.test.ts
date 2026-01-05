import assert from 'node:assert/strict';
import { test } from 'node:test';
import { serviceFollowUpHandler } from '../../../../src/engine/handlers/service/followUpHandler.js';
import { ToolResult, HandlerContext, ConversationTurn, TurnExecutionTrace, JsonObject } from '../../../../src/types.js';

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

test('serviceFollowUpHandler', async (t) => {
    const baseContext: HandlerContext = {
        userQuestion: 'check service',
        chatId: 'test-chat',
        turnNumber: 1,
        conversationHistory: [],
        toolResults: [],
    };

    type LogQueryArgs = {
        scope: { service: string };
        expression: { search: string };
    };

    await t.test('should suggest latency logs when user asks about slowness', async () => {
        const context = {
            ...baseContext,
            userQuestion: 'why is the payment service slow?', // "slow" keyword
        };
        const result: ToolResult = {
            name: 'query-services',
            result: [{
                name: 'svc-payment',
                id: 'svc-123'
            }],
        };

        const suggestions = await serviceFollowUpHandler(context, result);
        const logsSuggestion = suggestions.find(s => s.name === 'query-logs');

        assert.ok(logsSuggestion);
        const logsArgs = logsSuggestion.arguments as unknown as LogQueryArgs;
        assert.equal(logsArgs.scope.service, 'svc-payment');
        assert.ok(logsArgs.expression.search.includes('latency') || logsArgs.expression.search.includes('slow'), 'Search should relate to slowness');
    });

    await t.test('should fallback to error logs for generic queries', async () => {
        const context = {
            ...baseContext,
            userQuestion: 'show me service details', // Generic
        };
        const result: ToolResult = {
            name: 'query-services',
            result: [{
                name: 'svc-auth',
                id: 'svc-456'
            }],
        };

        const suggestions = await serviceFollowUpHandler(context, result);
        const logsSuggestion = suggestions.find(s => s.name === 'query-logs');

        assert.ok(logsSuggestion);
        const logsArgs = logsSuggestion.arguments as unknown as LogQueryArgs;
        // "service details" -> "service" AND "details" (better than generic error!)
        assert.ok(logsArgs.expression.search.includes('service'), 'Should include service');
        assert.ok(logsArgs.expression.search.includes('details'), 'Should include details');
    });

    await t.test('should NOT suggest describe-metrics if already called in current turn results', async () => {
        const result: ToolResult = {
            name: "query-services",
            result: [{ name: "test-svc" }],
            arguments: {}
        };

        const contextWithExisting: HandlerContext = {
            ...baseContext,
            toolResults: [
                {
                    name: "describe-metrics", // Simulate it happened in this turn
                    result: {},
                    arguments: { scope: { service: "test-svc" } }
                }
            ]
        };

        const suggestions = await serviceFollowUpHandler(contextWithExisting, result);

        const hasDescribe = suggestions.some(s => s.name === "describe-metrics");
        assert.equal(hasDescribe, false, "Should deduplicate against current turn results");
    });

    await t.test('should NOT suggest describe-metrics if already called in history', async () => {
        const result: ToolResult = {
            name: "query-services",
            result: [{ name: "test-svc" }],
            arguments: {}
        };

        const contextWithHistory: HandlerContext = {
            ...baseContext,
            conversationHistory: [createTurnWithTools([
                {
                    name: "describe-metrics",
                    result: {},
                    arguments: { scope: { service: "test-svc" } }
                }
            ])]
        };

        const suggestions = await serviceFollowUpHandler(contextWithHistory, result);

        const hasDescribe = suggestions.some(s => s.name === "describe-metrics");
        assert.equal(hasDescribe, false, "Should deduplicate against history");
    });
});
