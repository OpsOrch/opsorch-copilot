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
        assert.equal(suggestions.length, 3);
        const logsSuggestion = suggestions.find(s => s.name === 'query-logs');
        assert.ok(logsSuggestion);
        const logsArgs = logsSuggestion.arguments as unknown as LogQueryArgs;
        // cpu_usage -> cpu (expanded) AND usage
        assert.ok(logsArgs.expression.search.includes('cpu'), 'Search should include cpu');
    });

    await t.test('should suggest deployments for http_request_duration metrics', async () => {
        const result: ToolResult = {
            name: 'query-metrics',
            result: [{
                name: 'http_request_duration_seconds',
                service: 'svc-api',
                points: []
            }],
        };

        const suggestions = await metricFollowUpHandler(baseContext, result);

        const deploymentsSuggestion = suggestions.find(s => s.name === 'query-deployments');
        assert.ok(deploymentsSuggestion, 'should suggest query-deployments for http_request metrics');
        const args = deploymentsSuggestion.arguments as { scope: { service: string }, limit: number };
        assert.equal(args.scope.service, 'svc-api');
        assert.equal(args.limit, 5);
    });

    await t.test('should suggest deployments for p95/p99 latency metrics', async () => {
        const result: ToolResult = {
            name: 'query-metrics',
            result: [{
                name: 'api_latency_p95',
                service: 'svc-gateway',
                points: []
            }],
        };

        const suggestions = await metricFollowUpHandler(baseContext, result);

        const deploymentsSuggestion = suggestions.find(s => s.name === 'query-deployments');
        assert.ok(deploymentsSuggestion, 'should suggest query-deployments for p95 metrics');
    });

    await t.test('should suggest deployments for response_time metrics', async () => {
        const result: ToolResult = {
            name: 'query-metrics',
            result: [{
                name: 'response_time_seconds',
                service: 'svc-web',
                points: []
            }],
        };

        const suggestions = await metricFollowUpHandler(baseContext, result);

        const deploymentsSuggestion = suggestions.find(s => s.name === 'query-deployments');
        assert.ok(deploymentsSuggestion, 'should suggest query-deployments for response_time metrics');
    });

    await t.test('should suggest deployments for grpc latency metrics', async () => {
        const result: ToolResult = {
            name: 'query-metrics',
            result: [{
                name: 'grpc_server_handling_seconds',
                service: 'svc-grpc',
                points: []
            }],
        };

        const suggestions = await metricFollowUpHandler(baseContext, result);

        const deploymentsSuggestion = suggestions.find(s => s.name === 'query-deployments');
        assert.ok(deploymentsSuggestion, 'should suggest query-deployments for grpc metrics');
    });

    await t.test('should NOT suggest deployments for non-latency metrics', async () => {
        const result: ToolResult = {
            name: 'query-metrics',
            result: [{
                name: 'memory_usage_bytes',
                service: 'svc-node',
                points: []
            }],
        };

        const suggestions = await metricFollowUpHandler(baseContext, result);

        const deploymentsSuggestion = suggestions.find(s => s.name === 'query-deployments');
        assert.ok(!deploymentsSuggestion, 'should NOT suggest query-deployments for non-latency metrics');
    });

    await t.test('should NOT duplicate deployment suggestions for same service', async () => {
        const contextWithExisting: HandlerContext = {
            ...baseContext,
            toolResults: [{
                name: 'query-deployments',
                result: [],
                arguments: { scope: { service: 'svc-dup' } }
            }]
        };
        const result: ToolResult = {
            name: 'query-metrics',
            result: [{
                name: 'http_request_duration_seconds',
                service: 'svc-dup',
                points: []
            }],
        };

        const suggestions = await metricFollowUpHandler(contextWithExisting, result);

        const deploymentsSuggestion = suggestions.find(s => s.name === 'query-deployments');
        assert.ok(!deploymentsSuggestion, 'should NOT duplicate query-deployments');
    });

    await t.test('should turn describe-metrics into query-metrics for investigative requests', async () => {
        const context: HandlerContext = {
            ...baseContext,
            userQuestion: 'find the root cause and check cpu metrics',
            toolResults: [{
                name: 'query-incidents',
                arguments: { limit: 1 },
                result: [{
                    id: 'INC-200',
                    service: 'svc-api',
                    startTime: '2024-01-01T00:00:00Z',
                    endTime: '2024-01-01T00:30:00Z',
                }],
            }],
        };
        const result: ToolResult = {
            name: 'describe-metrics',
            arguments: { scope: { service: 'svc-api' } },
            result: ['cpu_usage', 'memory_usage'],
        };

        const suggestions = await metricFollowUpHandler(context, result);
        const metricsSuggestion = suggestions.find(s => s.name === 'query-metrics');

        assert.ok(metricsSuggestion, 'should suggest query-metrics after metric discovery');
        const args = metricsSuggestion!.arguments as {
            scope: { service: string };
            expression: { metricName: string };
            start: string;
            end: string;
            step: number;
        };
        assert.equal(args.scope.service, 'svc-api');
        assert.equal(args.expression.metricName, 'cpu_usage');
        assert.equal(args.step, 60);
        assert.ok(Number.isFinite(Date.parse(args.start)));
        assert.ok(Number.isFinite(Date.parse(args.end)));
    });

    await t.test('should not query metrics for discovery-only requests', async () => {
        const context: HandlerContext = {
            ...baseContext,
            userQuestion: 'what metrics are available for svc-api',
        };
        const result: ToolResult = {
            name: 'describe-metrics',
            arguments: { scope: { service: 'svc-api' } },
            result: ['cpu_usage', 'memory_usage'],
        };

        const suggestions = await metricFollowUpHandler(context, result);
        assert.equal(suggestions.some(s => s.name === 'query-metrics'), false);
    });
});
