import assert from 'node:assert/strict';
import { test } from 'node:test';
import { metricFollowUpHandler } from '../../../../src/engine/handlers/metric/followUpHandler.js';
import { ToolResult, HandlerContext } from '../../../../src/types.js';

test('metricFollowUpHandler', async (t) => {
    const baseContext: HandlerContext = {
        userQuestion: 'check metrics',
        chatId: 'test-chat',
        turnNumber: 1,
        conversationHistory: [],
        toolResults: [],
    };

    type LogQueryArgs = {
        scope: { service: string };
        expression: { search: string };
    };

    await t.test('should suggest latency logs for latency metrics', async () => {
        const result: ToolResult = {
            name: 'query-metrics',
            result: [{
                name: 'http_request_latency_seconds',
                service: 'svc-api',
                points: []
            }],
        };

        const suggestions = await metricFollowUpHandler(baseContext, result);
        const logsSuggestion = suggestions.find(s => s.name === 'query-logs');

        assert.ok(logsSuggestion);
        const logsArgs = logsSuggestion.arguments as unknown as LogQueryArgs;
        assert.equal(logsArgs.scope.service, 'svc-api');
        // Should contain 'latency' in search term
        assert.ok(logsArgs.expression.search.includes('latency'), 'Search should include latency');
    });

    await t.test('should suggest error logs for error metrics', async () => {
        const result: ToolResult = {
            name: 'query-metrics',
            result: [{
                name: 'error_count',
                service: 'svc-core',
                points: []
            }],
        };

        const suggestions = await metricFollowUpHandler(baseContext, result);
        const logsSuggestion = suggestions.find(s => s.name === 'query-logs');

        assert.ok(logsSuggestion);
        const logsArgs = logsSuggestion.arguments as unknown as LogQueryArgs;
        assert.equal(logsArgs.scope.service, 'svc-core');
        assert.ok(logsArgs.expression.search.includes('error'), 'Should include error expansion');
    });

    await t.test('should describe metrics for context awareness (general)', async () => {
        // Just verifying it returns some suggestions
        const result: ToolResult = {
            name: 'query-metrics',
            result: [{
                name: 'cpu_usage', // Not latency or error
                service: 'svc-node',
                points: []
            }],
        };
        const suggestions = await metricFollowUpHandler(baseContext, result);
        // For CPU usage, current logic (as seen in file view previously) might not trigger logs if it only checks for latency/error keywords
        // But let's verify what happens. 
        // The previous file content shows: if (metricName.toLowerCase().includes("latency") || metricName.toLowerCase().includes("error"))
        // So cpu_usage should NOT trigger log query.
        // With enhanced LogQueryGenerator, cpu_usage should triggers 'cpu' related logs (and alerts)
        assert.equal(suggestions.length, 2);
        const logsSuggestion = suggestions.find(s => s.name === 'query-logs');
        assert.ok(logsSuggestion);
        const logsArgs = logsSuggestion.arguments as unknown as LogQueryArgs;
        // cpu_usage -> cpu (expanded) AND usage
        assert.ok(logsArgs.expression.search.includes('cpu'), 'Search should include cpu');
    });
});
