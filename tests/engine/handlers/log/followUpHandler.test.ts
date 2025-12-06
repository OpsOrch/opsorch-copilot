
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { logFollowUpHandler } from '../../../../src/engine/handlers/log/followUpHandler.js';
import { ToolResult, HandlerContext } from '../../../../src/types.js';

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
            result: [
                {
                    timestamp: '2023-01-01T00:00:00Z',
                    message: 'Connection failed to database',
                    severity: 'error',
                    service: 'svc-db-conn'
                }
            ],
        };

        const suggestions = await logFollowUpHandler(context, result);

        const metricsSuggestion = suggestions.find(s => s.name === 'describe-metrics');
        assert.ok(metricsSuggestion);
        assert.deepEqual(metricsSuggestion.arguments, { scope: { service: 'svc-db-conn' } });
    });

    await t.test('should NOT suggest describe-metrics if already called in current turn results', async () => {
        const result: ToolResult = {
            name: 'query-logs',
            result: [
                {
                    timestamp: '2023-01-01T00:00:00Z',
                    message: 'Critical failure',
                    severity: 'error',
                    service: 'svc-dup-log'
                }
            ],
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
            result: [
                {
                    timestamp: '2023-01-01T00:00:00Z',
                    message: 'Another failure',
                    severity: 'error',
                    service: 'svc-hist-log'
                }
            ],
        };

        const contextWithHistory: HandlerContext = {
            ...context,
            conversationHistory: [{
                userMessage: 'previous check',
                assistantResponse: 'checked',
                timestamp: Date.now(),
                toolResults: [
                    {
                        name: 'describe-metrics',
                        result: {},
                        arguments: { scope: { service: 'svc-hist-log' } }
                    }
                ]
            }]
        };

        const suggestions = await logFollowUpHandler(contextWithHistory, result);
        const hasMetrics = suggestions.some(s => s.name === 'describe-metrics');
        assert.equal(hasMetrics, false, 'Should deduplicate describe-metrics against history');
    });
});
