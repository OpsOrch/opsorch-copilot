import assert from 'node:assert/strict';
import { test } from 'node:test';
import { incidentFollowUpHandler } from '../../../../src/engine/handlers/incident/followUpHandler.js';
import { ToolResult, HandlerContext } from '../../../../src/types.js';

test('incidentFollowUpHandler', async (t) => {
    const baseContext: HandlerContext = {
        userQuestion: 'show incidents',
        chatId: 'test-chat',
        turnNumber: 1,
        conversationHistory: [],
        toolResults: [],
    };

    await t.test('should return empty for invalid input', async () => {
        const result: ToolResult = {
            name: 'query-incidents',
            result: null,
        };
        const suggestions = await incidentFollowUpHandler(baseContext, result);
        assert.equal(suggestions.length, 0);
    });

    await t.test('should suggest timeline, logs, metrics, and alerts for root cause analysis', async () => {
        const context: HandlerContext = {
            ...baseContext,
            userQuestion: 'what is the root cause of this incident?',
        };
        const result: ToolResult = {
            name: 'query-incidents',
            result: [{
                id: 'inc-001',
                title: 'Payment failures',
                status: 'open',
                severity: 'sev1',
                service: 'svc-payments',
                createdAt: '2025-01-01T10:00:00Z',
                updatedAt: '2025-01-01T11:00:00Z',
            }],
        };

        const suggestions = await incidentFollowUpHandler(context, result);

        // Should have: timeline, describe-metrics, query-logs, query-alerts
        assert.equal(suggestions.length, 4);

        const timelineSuggestion = suggestions.find(s => s.name === 'get-incident-timeline');
        assert.ok(timelineSuggestion);
        assert.deepEqual(timelineSuggestion.arguments, { id: 'inc-001' });

        const metricsSuggestion = suggestions.find(s => s.name === 'describe-metrics');
        assert.ok(metricsSuggestion);
        assert.deepEqual(metricsSuggestion.arguments, { scope: { service: 'svc-payments' } });

        const logsSuggestion = suggestions.find(s => s.name === 'query-logs');
        assert.ok(logsSuggestion);
        const logsArgs = logsSuggestion.arguments as { scope: { service: string }, expression: { search: string } };
        assert.equal(logsArgs.scope.service, 'svc-payments');
        // 'Payment failures' title contains 'fail' -> expanded. 'Payment' -> preserved.
        const search = logsArgs.expression.search;
        assert.match(search, /payment/i, 'Should include payment (case insensitive)');
        assert.ok(search.includes('fail OR error'), 'Should include failure expansion');

        // New: should suggest query-alerts for the service
        const alertsSuggestion = suggestions.find(s => s.name === 'query-alerts');
        assert.ok(alertsSuggestion, 'should suggest query-alerts for root cause analysis');
        const alertsArgs = alertsSuggestion.arguments as { scope: { service: string }, statuses: string[] };
        assert.equal(alertsArgs.scope.service, 'svc-payments');
        assert.deepEqual(alertsArgs.statuses, ['firing', 'acknowledged']);
    });

    await t.test('should suggest timeline for drill-down patterns', async () => {
        const context: HandlerContext = {
            ...baseContext,
            userQuestion: 'show me the timeline of the incident',
        };
        const result: ToolResult = {
            name: 'query-incidents',
            result: [{
                id: 'inc-002',
                title: 'Service degradation',
                status: 'resolved',
                severity: 'sev2',
                service: 'svc-checkout',
            }],
        };

        const suggestions = await incidentFollowUpHandler(context, result);

        // Should suggest timeline
        const timelineSuggestion = suggestions.find(s => s.name === 'get-incident-timeline');
        assert.ok(timelineSuggestion);
        assert.deepEqual(timelineSuggestion.arguments, { id: 'inc-002' });
    });

    await t.test('should suggest logs, metrics, and alerts for general incident queries', async () => {
        const context: HandlerContext = {
            ...baseContext,
            userQuestion: 'summarize the last incident',
        };
        const result: ToolResult = {
            name: 'query-incidents',
            result: [{
                id: 'inc-003',
                title: 'API errors',
                status: 'open',
                severity: 'sev1',
                service: 'svc-api',
            }],
        };

        const suggestions = await incidentFollowUpHandler(context, result);

        // Should suggest logs, metrics, and alerts for broader investigation
        const logsSuggestion = suggestions.find(s => s.name === 'query-logs');
        assert.ok(logsSuggestion);

        const metricsSuggestion = suggestions.find(s => s.name === 'describe-metrics');
        assert.ok(metricsSuggestion);

        const alertsSuggestion = suggestions.find(s => s.name === 'query-alerts');
        assert.ok(alertsSuggestion, 'should suggest query-alerts for general incident queries');
        const alertsArgs = alertsSuggestion.arguments as { scope: { service: string }, statuses: string[] };
        assert.equal(alertsArgs.scope.service, 'svc-api');
    });

    await t.test('should always suggest timeline when incident is found, even without explicit keywords', async () => {
        const context: HandlerContext = {
            ...baseContext,
            userQuestion: 'list recent incidents',
        };
        const result: ToolResult = {
            name: 'query-incidents',
            result: [{
                id: 'inc-005b',
                title: 'Minor glitch',
                status: 'resolved',
                severity: 'sev3',
                service: 'svc-misc',
            }],
        };

        const suggestions = await incidentFollowUpHandler(context, result);

        // Should suggest timeline because an incident was found
        const timelineSuggestion = suggestions.find(s => s.name === 'get-incident-timeline');
        assert.ok(timelineSuggestion, 'Should suggest timeline for any found incident');
        assert.deepEqual(timelineSuggestion.arguments, { id: 'inc-005b' });
    });

    await t.test('should handle incidents without service', async () => {
        const context: HandlerContext = {
            ...baseContext,
            userQuestion: 'what is the root cause?',
        };
        const result: ToolResult = {
            name: 'query-incidents',
            result: [{
                id: 'inc-004',
                title: 'Unknown issue',
                status: 'open',
                severity: 'sev2',
            }],
        };

        const suggestions = await incidentFollowUpHandler(context, result);

        // Should still suggest timeline
        const timelineSuggestion = suggestions.find(s => s.name === 'get-incident-timeline');
        assert.ok(timelineSuggestion);

        // Should NOT suggest service-scoped queries without service
        const alertsSuggestion = suggestions.find(s => s.name === 'query-alerts');
        assert.ok(!alertsSuggestion || !alertsSuggestion.arguments,
            'should not suggest scoped alerts without service info');
    });

    await t.test('SuggestionTracker should deduplicate same tool+service combinations', async () => {
        // This test verifies the SuggestionTracker deduplication
        // by checking that multiple code paths don't produce duplicate suggestions
        const context: HandlerContext = {
            ...baseContext,
            userQuestion: 'root cause timeout latency', // Multiple trigger patterns
        };
        const result: ToolResult = {
            name: 'query-incidents',
            result: [{
                id: 'inc-005',
                title: 'API latency spike',
                status: 'open',
                severity: 'sev1',
                service: 'svc-api',
                createdAt: '2025-01-01T10:00:00Z',
                updatedAt: '2025-01-01T11:00:00Z',
            }],
        };

        const suggestions = await incidentFollowUpHandler(context, result);

        // Create keys for tool+service combinations
        const keys = suggestions.map(s => {
            const scope = s.arguments?.scope as { service?: string } | undefined;
            return `${s.name}:${scope?.service ?? 'none'}`;
        });

        // All keys should be unique (no duplicates)
        const uniqueKeys = new Set(keys);
        assert.strictEqual(keys.length, uniqueKeys.size,
            'SuggestionTracker should prevent duplicate tool+service combinations');

        // Specifically check describe-metrics is only suggested once per service
        const metricsForApi = keys.filter(k => k === 'describe-metrics:svc-api');
        assert.strictEqual(metricsForApi.length, 1,
            'describe-metrics should appear only once per service');
    });

    await t.test('should propagate query to related alert queries', async () => {
        const context: HandlerContext = {
            ...baseContext,
            userQuestion: 'tell me about kafka problems',
        };
        const result: ToolResult = {
            name: 'query-incidents',
            result: [{
                id: 'inc-kafka-001',
                title: 'Kafka consumer lag',
                status: 'open',
                severity: 'sev2',
                service: 'kafka-consumer',
            }],
            arguments: { query: 'kafka' },
        };

        const suggestions = await incidentFollowUpHandler(context, result);

        const alertsSuggestion = suggestions.find(s => s.name === 'query-alerts');
        assert.ok(alertsSuggestion, 'should suggest query-alerts');
        assert.equal(
            (alertsSuggestion.arguments as { query?: string }).query,
            'kafka',
            'should propagate query to query-alerts'
        );
    });
    await t.test('should NOT suggest describe-metrics if already called in current turn results', async () => {
        const result: ToolResult = {
            name: 'query-incidents',
            result: [{
                id: 'inc-006',
                title: 'Another issue',
                status: 'open',
                severity: 'sev2',
                service: 'svc-dup-check',
            }],
        };

        const contextWithExisting: HandlerContext = {
            ...baseContext,
            toolResults: [
                {
                    name: 'describe-metrics', // Simulate it happened in this turn
                    result: {},
                    arguments: { scope: { service: 'svc-dup-check' } }
                }
            ]
        };

        const suggestions = await incidentFollowUpHandler(contextWithExisting, result);
        const hasMetrics = suggestions.some(s => s.name === 'describe-metrics');
        assert.equal(hasMetrics, false, 'Should deduplicate describe-metrics against current results');
    });

    await t.test('should NOT suggest describe-metrics if already called in history', async () => {
        const result: ToolResult = {
            name: 'query-incidents',
            result: [{
                id: 'inc-007',
                title: 'Historical issue',
                status: 'open',
                severity: 'sev2',
                service: 'svc-hist-check',
            }],
        };

        const contextWithHistory: HandlerContext = {
            ...baseContext,
            conversationHistory: [{
                userMessage: 'previous check',
                assistantResponse: 'checked',
                timestamp: Date.now(),
                toolResults: [
                    {
                        name: 'describe-metrics',
                        result: {},
                        arguments: { scope: { service: 'svc-hist-check' } }
                    }
                ]
            }]
        };

        const suggestions = await incidentFollowUpHandler(contextWithHistory, result);
        const hasMetrics = suggestions.some(s => s.name === 'describe-metrics');
        assert.equal(hasMetrics, false, 'Should deduplicate describe-metrics against history');
    });
});


