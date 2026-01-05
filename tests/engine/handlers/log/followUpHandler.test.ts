
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { logFollowUpHandler } from '../../../../src/engine/handlers/log/followUpHandler.js';
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

test('logFollowUpHandler', async (t) => {
    // Mock context
    const context: HandlerContext = {
        chatId: 'test',
        turnNumber: 1,
        conversationHistory: [],
        toolResults: [],
        userQuestion: 'check logs'
    };

    await t.test('should return empty suggestions for non-object result', async () => {
        const result: ToolResult = {
            name: 'query-logs',
            result: null,
        };
        const suggestions = await logFollowUpHandler(context, result);
        assert.deepEqual(suggestions, []);
    });

    await t.test('should return empty suggestions for non-array result', async () => {
        const result: ToolResult = {
            name: 'query-logs',
            result: { error: 'oops' },
        };
        const suggestions = await logFollowUpHandler(context, result);
        assert.deepEqual(suggestions, []);
    });

    await t.test('should suggest describe-metrics for error logs with service', async () => {
        const result: ToolResult = {
            name: 'query-logs',
            result: {
                entries: [
                    {
                        timestamp: '2023-01-01T00:00:00Z',
                        message: 'Connection failed to database',
                        severity: 'error',
                        service: 'svc-db-conn'
                    }
                ]
            },
        };

        const suggestions = await logFollowUpHandler(context, result);

        const metricsSuggestion = suggestions.find(s => s.name === 'describe-metrics');
        assert.ok(metricsSuggestion);
        assert.deepEqual(metricsSuggestion.arguments, { scope: { service: 'svc-db-conn' } });
    });

    await t.test('should NOT suggest describe-metrics if already called in current turn results', async () => {
        const result: ToolResult = {
            name: 'query-logs',
            result: {
                entries: [
                    {
                        timestamp: '2023-01-01T00:00:00Z',
                        message: 'Critical failure',
                        severity: 'error',
                        service: 'svc-dup-log'
                    }
                ]
            },
        };

        const contextWithExisting: HandlerContext = {
            ...context,
            toolResults: [
                {
                    name: 'describe-metrics', // Simulate it happened in this turn
                    result: {},
                    arguments: { scope: { service: 'svc-dup-log' } }
                }
            ]
        };

        const suggestions = await logFollowUpHandler(contextWithExisting, result);
        const hasMetrics = suggestions.some(s => s.name === 'describe-metrics');
        assert.equal(hasMetrics, false, 'Should deduplicate describe-metrics against current results');
    });

    await t.test('should NOT suggest describe-metrics if already called in history', async () => {
        const result: ToolResult = {
            name: 'query-logs',
            result: {
                entries: [
                    {
                        timestamp: '2023-01-01T00:00:00Z',
                        message: 'Another failure',
                        severity: 'error',
                        service: 'svc-hist-log'
                    }
                ]
            },
        };

        const contextWithHistory: HandlerContext = {
            ...context,
            conversationHistory: [createTurnWithTools([
                {
                    name: 'describe-metrics',
                    result: {},
                    arguments: { scope: { service: 'svc-hist-log' } }
                }
            ])]
        };

        const suggestions = await logFollowUpHandler(contextWithHistory, result);
        const hasMetrics = suggestions.some(s => s.name === 'describe-metrics');
        assert.equal(hasMetrics, false, 'Should deduplicate describe-metrics against history');
    });

    await t.test('should suggest deployments for timeout error patterns', async () => {
        const result: ToolResult = {
            name: 'query-logs',
            result: {
                entries: [
                    {
                        timestamp: '2023-01-01T00:00:00Z',
                        message: 'Request timeout after 30s',
                        severity: 'error',
                        service: 'svc-api'
                    }
                ]
            },
        };

        const suggestions = await logFollowUpHandler(context, result);

        const deploymentsSuggestion = suggestions.find(s => s.name === 'query-deployments');
        assert.ok(deploymentsSuggestion, 'should suggest query-deployments for timeout errors');
        const args = deploymentsSuggestion.arguments as { scope: { service: string }, limit: number };
        assert.equal(args.scope.service, 'svc-api');
        assert.equal(args.limit, 5);
    });

    await t.test('should suggest deployments for connection error patterns', async () => {
        const result: ToolResult = {
            name: 'query-logs',
            result: {
                entries: [
                    {
                        timestamp: '2023-01-01T00:00:00Z',
                        message: 'Connection refused to database',
                        severity: 'error',
                        service: 'svc-db'
                    }
                ]
            },
        };

        const suggestions = await logFollowUpHandler(context, result);

        const deploymentsSuggestion = suggestions.find(s => s.name === 'query-deployments');
        assert.ok(deploymentsSuggestion, 'should suggest query-deployments for connection errors');
    });

    await t.test('should suggest deployments for 5xx status code patterns', async () => {
        const result: ToolResult = {
            name: 'query-logs',
            result: {
                entries: [
                    {
                        timestamp: '2023-01-01T00:00:00Z',
                        message: 'Returned 502 bad gateway',
                        severity: 'error',
                        service: 'svc-gateway'
                    }
                ]
            },
        };

        const suggestions = await logFollowUpHandler(context, result);

        const deploymentsSuggestion = suggestions.find(s => s.name === 'query-deployments');
        assert.ok(deploymentsSuggestion, 'should suggest query-deployments for 5xx errors');
    });

    await t.test('should suggest deployments when logs mention deployments', async () => {
        const result: ToolResult = {
            name: 'query-logs',
            result: {
                entries: [
                    {
                        timestamp: '2023-01-01T00:00:00Z',
                        message: 'Error after deploying version 1.2.3',
                        severity: 'error',
                        service: 'svc-app'
                    }
                ]
            },
        };

        const suggestions = await logFollowUpHandler(context, result);

        const deploymentsSuggestion = suggestions.find(s => s.name === 'query-deployments');
        assert.ok(deploymentsSuggestion, 'should suggest query-deployments when logs mention deployments');
    });

    await t.test('should suggest deployments when user question has latency context', async () => {
        const contextWithLatency: HandlerContext = {
            ...context,
            userQuestion: 'check logs for latency issues'
        };
        const result: ToolResult = {
            name: 'query-logs',
            result: {
                entries: [
                    {
                        timestamp: '2023-01-01T00:00:00Z',
                        message: 'Generic error occurred',
                        severity: 'error',
                        service: 'svc-api'
                    }
                ]
            },
        };

        const suggestions = await logFollowUpHandler(contextWithLatency, result);

        const deploymentsSuggestion = suggestions.find(s => s.name === 'query-deployments');
        assert.ok(deploymentsSuggestion, 'should suggest query-deployments when question has latency context');
    });

    await t.test('should suggest deployments when user question asks about slow performance', async () => {
        const contextWithSlow: HandlerContext = {
            ...context,
            userQuestion: 'why is the service slow?'
        };
        const result: ToolResult = {
            name: 'query-logs',
            result: {
                entries: [
                    {
                        timestamp: '2023-01-01T00:00:00Z',
                        message: 'Request completed with error',
                        severity: 'error',
                        service: 'svc-web'
                    }
                ]
            },
        };

        const suggestions = await logFollowUpHandler(contextWithSlow, result);

        const deploymentsSuggestion = suggestions.find(s => s.name === 'query-deployments');
        assert.ok(deploymentsSuggestion, 'should suggest query-deployments when question asks about slow performance');
    });

    await t.test('should NOT suggest deployments for unrelated error patterns', async () => {
        const contextWithoutContext: HandlerContext = {
            ...context,
            userQuestion: 'show me the logs' // No latency context
        };
        const result: ToolResult = {
            name: 'query-logs',
            result: {
                entries: [
                    {
                        timestamp: '2023-01-01T00:00:00Z',
                        message: 'Invalid user input',
                        severity: 'error',
                        service: 'svc-api'
                    }
                ]
            },
        };

        const suggestions = await logFollowUpHandler(contextWithoutContext, result);

        const deploymentsSuggestion = suggestions.find(s => s.name === 'query-deployments');
        assert.ok(!deploymentsSuggestion, 'should NOT suggest query-deployments for unrelated errors');
    });

    await t.test('should NOT duplicate deployment suggestions if already called', async () => {
        const contextWithExisting: HandlerContext = {
            ...context,
            userQuestion: 'check latency logs',
            toolResults: [{
                name: 'query-deployments',
                result: [],
                arguments: { scope: { service: 'svc-dup' } }
            }]
        };
        const result: ToolResult = {
            name: 'query-logs',
            result: {
                entries: [
                    {
                        timestamp: '2023-01-01T00:00:00Z',
                        message: 'Timeout error',
                        severity: 'error',
                        service: 'svc-dup'
                    }
                ]
            },
        };

        const suggestions = await logFollowUpHandler(contextWithExisting, result);

        const deploymentsSuggestion = suggestions.find(s => s.name === 'query-deployments');
        assert.ok(!deploymentsSuggestion, 'should NOT duplicate query-deployments');
    });
});

