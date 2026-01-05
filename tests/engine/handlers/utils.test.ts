import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HandlerUtils } from '../../../src/engine/handlers/utils.js';
import { HandlerContext, ToolResult, ConversationTurn, TurnExecutionTrace, JsonObject } from '../../../src/types.js';

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

test('HandlerUtils.isDuplicateToolCall', async (t) => {
    // Mock context
    const context: HandlerContext = {
        chatId: 'test',
        turnNumber: 1,
        conversationHistory: [],
        toolResults: [],
        userQuestion: 'test'
    };

    await t.test('should return false when logic is completely empty', () => {
        assert.equal(HandlerUtils.isDuplicateToolCall(context, 'query-logs', 'svc-a'), false);
    });

    await t.test('should detect duplicate in current toolResults', () => {
        const result: ToolResult = {
            name: 'query-logs',
            result: [],
            arguments: { scope: { service: 'svc-cached' } }
        };
        const contextWithResult: HandlerContext = {
            ...context,
            toolResults: [result]
        };

        // Same tool, same service -> true
        assert.equal(HandlerUtils.isDuplicateToolCall(contextWithResult, 'query-logs', 'svc-cached'), true);

        // Different tool -> false
        assert.equal(HandlerUtils.isDuplicateToolCall(contextWithResult, 'query-incidents', 'svc-cached'), false);

        // Same tool, different service -> false
        assert.equal(HandlerUtils.isDuplicateToolCall(contextWithResult, 'query-logs', 'svc-other'), false);
    });

    await t.test('should detect duplicate in conversationHistory', () => {
        const contextWithHistory: HandlerContext = {
            ...context,
            conversationHistory: [createTurnWithTools([{
                name: 'describe-metrics',
                result: {},
                arguments: { scope: { service: 'svc-history' } }
            }])]
        };

        // Match history
        assert.equal(HandlerUtils.isDuplicateToolCall(contextWithHistory, 'describe-metrics', 'svc-history'), true);

        // No match
        assert.equal(HandlerUtils.isDuplicateToolCall(contextWithHistory, 'describe-metrics', 'svc-fresh'), false);
    });

    await t.test('should handle undefined arguments/scope gracefully', () => {
        const result: ToolResult = {
            name: 'list-providers',
            result: {},
            // arguments missing or empty
        };
        const contextWithResult: HandlerContext = {
            ...context,
            toolResults: [result]
        };

        // If we ask for scoped check but result has no args -> false
        assert.equal(HandlerUtils.isDuplicateToolCall(contextWithResult, 'list-providers', 'some-scope'), false);

        // If we ask for unscoped check -> true (name match)
        assert.equal(HandlerUtils.isDuplicateToolCall(contextWithResult, 'list-providers'), true);
    });

    await t.test('should ignore non-matching tool names even if scope matches', () => {
        const result: ToolResult = {
            name: 'query-incidents',
            result: [],
            arguments: { scope: { service: 'svc-common' } }
        };
        const contextWithResult: HandlerContext = {
            ...context,
            toolResults: [result]
        };

        assert.equal(HandlerUtils.isDuplicateToolCall(contextWithResult, 'query-logs', 'svc-common'), false);
    });
});
