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
        assert.equal(logsArgs.expression.search, 'error OR exception');

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
});
