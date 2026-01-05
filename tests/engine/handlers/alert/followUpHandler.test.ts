
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { alertFollowUpHandler } from '../../../../src/engine/handlers/alert/followUpHandler.js';
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


test('alertFollowUpHandler', async (t) => {
    // Mock context
    const context: HandlerContext = {
        chatId: 'test',
        turnNumber: 1,
        conversationHistory: [],
        toolResults: [],
        userQuestion: 'test question'
    };

    await t.test('should return empty suggestions for invalid result', async () => {
        const result: ToolResult = {
            name: 'query-alerts',
            result: null,
        };
        const suggestions = await alertFollowUpHandler(context, result);
        assert.deepEqual(suggestions, []);
    });

    await t.test('should return empty suggestions for non-array result', async () => {
        const result: ToolResult = {
            name: 'query-alerts',
            result: { error: 'some error' },
        };
        const suggestions = await alertFollowUpHandler(context, result);
        assert.deepEqual(suggestions, []);
    });

    await t.test('should return empty suggestions when no active alerts', async () => {
        const result: ToolResult = {
            name: 'query-alerts',
            result: [
                { id: '1', status: 'closed', service: 'service-a' },
                { id: '2', status: 'resolved', service: 'service-b' },
            ],
        };
        const suggestions = await alertFollowUpHandler(context, result);
        assert.deepEqual(suggestions, []);
    });

    await t.test('should suggest follow-ups for active alerts', async () => {
        const result: ToolResult = {
            name: 'query-alerts',
            result: [
                { id: '1', status: 'active', service: 'service-a' },
            ],
        };
        const suggestions = await alertFollowUpHandler(context, result);

        // Should have 3 suggestions: logs, metrics, incidents
        assert.equal(suggestions.length, 3);

        // content of suggestions
        const logSuggestion = suggestions.find(s => s.name === 'query-logs');
        assert.ok(logSuggestion);
        assert.deepEqual(logSuggestion.arguments, {
            scope: { service: 'service-a' },
            expression: { severityIn: ['error'] },
            limit: 30,
        });

        const metricSuggestion = suggestions.find(s => s.name === 'describe-metrics');
        assert.ok(metricSuggestion);
        assert.deepEqual(metricSuggestion.arguments, {
            scope: { service: 'service-a' },
        });

        const incidentSuggestion = suggestions.find(s => s.name === 'query-incidents');
        assert.ok(incidentSuggestion);
        assert.deepEqual(incidentSuggestion.arguments, {
            scope: { service: 'service-a' },
            statuses: ['active'],
        });
    });

    await t.test('should suggest follow-ups for limit of 3 active alerts', async () => {
        const result: ToolResult = {
            name: 'query-alerts',
            result: [
                { id: '1', status: 'active', service: 'service-a' },
                { id: '2', status: 'firing', service: 'service-b' },
                { id: '3', status: 'active', service: 'service-c' },
                { id: '4', status: 'active', service: 'service-d' },
            ],
        };
        const suggestions = await alertFollowUpHandler(context, result);

        // 3 suggestions per alert * 3 alerts = 9 suggestions
        assert.equal(suggestions.length, 9);

        const services = new Set(suggestions.map(s => (s.arguments as unknown as { scope: { service: string } }).scope.service));
        assert.ok(services.has('service-a'));
        assert.ok(services.has('service-b'));
        assert.ok(services.has('service-c'));
        assert.ok(!services.has('service-d'));
    });

    await t.test('should suggest global health check when many alerts present', async () => {
        const result: ToolResult = {
            name: 'query-alerts',
            result: [
                { id: '1', status: 'active', service: 's1' },
                { id: '2', status: 'active', service: 's2' },
                { id: '3', status: 'active', service: 's3' },
                { id: '4', status: 'active', service: 's4' },
                { id: '5', status: 'active', service: 's5' },
                { id: '6', status: 'active', service: 's6' },
            ],
        };
        const suggestions = await alertFollowUpHandler(context, result);

        // 3 suggestions * 3 capped alerts + 1 global suggestion = 10
        assert.equal(suggestions.length, 10);

        const globalMetricSuggestion = suggestions.find(s => s.name === 'describe-metrics' && Object.keys(s.arguments || {}).length === 0);
        assert.ok(globalMetricSuggestion);
    });

    await t.test('should propagate query to related incident queries', async () => {
        const result: ToolResult = {
            name: 'query-alerts',
            result: [
                { id: '1', status: 'active', service: 'kafka-consumer' },
            ],
            arguments: { query: 'kafka problems' },
        };
        const suggestions = await alertFollowUpHandler(context, result);

        const incidentSuggestion = suggestions.find(s => s.name === 'query-incidents');
        assert.ok(incidentSuggestion);
        assert.equal(
            (incidentSuggestion.arguments as { query?: string }).query,
            'kafka problems',
            'should propagate query to query-incidents'
        );
    });
    await t.test('should NOT suggest describe-metrics if already called in current turn results', async () => {
        const result: ToolResult = {
            name: 'query-alerts',
            result: [
                { id: '10', status: 'active', service: 'svc-dup-alert' },
            ],
        };

        const contextWithExisting: HandlerContext = {
            ...context,
            toolResults: [
                {
                    name: 'describe-metrics', // Simulate it happened in this turn
                    result: {},
                    arguments: { scope: { service: 'svc-dup-alert' } }
                }
            ]
        };

        const suggestions = await alertFollowUpHandler(contextWithExisting, result);
        const hasMetrics = suggestions.some(s => s.name === 'describe-metrics');
        assert.equal(hasMetrics, false, 'Should deduplicate describe-metrics against current results');
    });

    await t.test('should NOT suggest describe-metrics if already called in history', async () => {
        const result: ToolResult = {
            name: 'query-alerts',
            result: [
                { id: '11', status: 'active', service: 'svc-hist-alert' },
            ],
        };

        const contextWithHistory: HandlerContext = {
            ...context,
            conversationHistory: [createTurnWithTools([
                {
                    name: 'describe-metrics',
                    result: {},
                    arguments: { scope: { service: 'svc-hist-alert' } }
                }
            ])]
        };

        const suggestions = await alertFollowUpHandler(contextWithHistory, result);
        const hasMetrics = suggestions.some(s => s.name === 'describe-metrics');
        assert.equal(hasMetrics, false, 'Should deduplicate describe-metrics against history');
    });


    await t.test('should NOT suggest query-logs if already called in history', async () => {
        const result: ToolResult = {
            name: 'query-alerts',
            result: [
                { id: '12', status: 'active', service: 'svc-logs-dup' },
            ],
        };

        const contextWithHistory: HandlerContext = {
            ...context,
            conversationHistory: [createTurnWithTools([
                {
                    name: 'query-logs',
                    result: [],
                    arguments: { scope: { service: 'svc-logs-dup' } }
                }
            ])]
        };

        const suggestions = await alertFollowUpHandler(contextWithHistory, result);
        const hasLogs = suggestions.some(s => s.name === 'query-logs');
        assert.equal(hasLogs, false, 'Should deduplicate query-logs against history');
    });

    await t.test('should suggest deployments for high-severity alerts (critical)', async () => {
        const result: ToolResult = {
            name: 'query-alerts',
            result: [
                { id: '20', status: 'firing', service: 'svc-critical', severity: 'critical' },
            ],
        };
        const suggestions = await alertFollowUpHandler(context, result);

        const deploymentsSuggestion = suggestions.find(s => s.name === 'query-deployments');
        assert.ok(deploymentsSuggestion, 'should suggest query-deployments for critical alerts');
        const args = deploymentsSuggestion.arguments as { scope: { service: string }, limit: number };
        assert.equal(args.scope.service, 'svc-critical');
        assert.equal(args.limit, 5);
    });

    await t.test('should suggest deployments for high-severity alerts (sev1)', async () => {
        const result: ToolResult = {
            name: 'query-alerts',
            result: [
                { id: '21', status: 'active', service: 'svc-prod', severity: 'sev1' },
            ],
        };
        const suggestions = await alertFollowUpHandler(context, result);

        const deploymentsSuggestion = suggestions.find(s => s.name === 'query-deployments');
        assert.ok(deploymentsSuggestion, 'should suggest query-deployments for sev1 alerts');
    });

    await t.test('should suggest deployments for latency-related alert names', async () => {
        const result: ToolResult = {
            name: 'query-alerts',
            result: [
                { id: '22', status: 'firing', service: 'svc-api', severity: 'warning', name: 'High Latency Alert' },
            ],
        };
        const suggestions = await alertFollowUpHandler(context, result);

        const deploymentsSuggestion = suggestions.find(s => s.name === 'query-deployments');
        assert.ok(deploymentsSuggestion, 'should suggest query-deployments for latency alerts');
        const args = deploymentsSuggestion.arguments as { scope: { service: string } };
        assert.equal(args.scope.service, 'svc-api');
    });

    await t.test('should suggest deployments for timeout-related alert names', async () => {
        const result: ToolResult = {
            name: 'query-alerts',
            result: [
                { id: '23', status: 'active', service: 'svc-gateway', severity: 'warning', name: 'Request Timeout Rate' },
            ],
        };
        const suggestions = await alertFollowUpHandler(context, result);

        const deploymentsSuggestion = suggestions.find(s => s.name === 'query-deployments');
        assert.ok(deploymentsSuggestion, 'should suggest query-deployments for timeout alerts');
    });

    await t.test('should suggest deployments when query contains latency context', async () => {
        const contextWithLatency: HandlerContext = {
            ...context,
            userQuestion: 'check alerts for slow response times'
        };
        const result: ToolResult = {
            name: 'query-alerts',
            result: [
                { id: '24', status: 'active', service: 'svc-web', severity: 'warning' },
            ],
            arguments: { query: 'slow' }
        };
        const suggestions = await alertFollowUpHandler(contextWithLatency, result);

        const deploymentsSuggestion = suggestions.find(s => s.name === 'query-deployments');
        assert.ok(deploymentsSuggestion, 'should suggest query-deployments when query has latency context');
    });

    await t.test('should NOT suggest deployments for low-severity non-latency alerts', async () => {
        const result: ToolResult = {
            name: 'query-alerts',
            result: [
                { id: '25', status: 'active', service: 'svc-misc', severity: 'info', name: 'Disk Usage Alert' },
            ],
        };
        const suggestions = await alertFollowUpHandler(context, result);

        const deploymentsSuggestion = suggestions.find(s => s.name === 'query-deployments');
        assert.ok(!deploymentsSuggestion, 'should NOT suggest query-deployments for low-severity non-latency alerts');
    });

    await t.test('should NOT duplicate deployment suggestions if already called', async () => {
        const contextWithExisting: HandlerContext = {
            ...context,
            toolResults: [{
                name: 'query-deployments',
                result: [],
                arguments: { scope: { service: 'svc-dup' } }
            }]
        };
        const result: ToolResult = {
            name: 'query-alerts',
            result: [
                { id: '26', status: 'firing', service: 'svc-dup', severity: 'critical' },
            ],
        };
        const suggestions = await alertFollowUpHandler(contextWithExisting, result);

        const deploymentsSuggestion = suggestions.find(s => s.name === 'query-deployments');
        assert.ok(!deploymentsSuggestion, 'should NOT duplicate query-deployments');
    });
});

