
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { alertFollowUpHandler } from '../../../../src/engine/handlers/alert/followUpHandler.js';
import { ToolResult, HandlerContext } from '../../../../src/types.js';


test('alertFollowUpHandler', async (t) => {
    // Mock context
    const context = { chatId: 'test' } as HandlerContext;

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
});
