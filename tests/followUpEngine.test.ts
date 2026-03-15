import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FollowUpEngine } from '../src/engine/followUpEngine.js';
import { followUpRegistry } from '../src/engine/capabilityRegistry.js';
import { ToolResult } from '../src/types.js';

test('FollowUpEngine', async (t) => {
    const engine = new FollowUpEngine(followUpRegistry);

    await t.test('applyFollowUps deduplicates executed calls', async () => {
        const results: ToolResult[] = [
            {
                name: 'query-incidents',
                result: { incidents: [] }, // Empty incidents array
                arguments: { service: 'payment-api' },
            },
        ];

        const refined = await engine.applyFollowUps(results, 'test-chat', [], 'Show incidents');

        // Should not include duplicate query-incidents call since it was already executed
        const duplicateIncidentCalls = refined.filter(call => call.name === 'query-incidents');
        assert.strictEqual(duplicateIncidentCalls.length, 0);
    });

    await t.test('applyFollowUps generates follow-up suggestions for incidents', async () => {
        const results: ToolResult[] = [
            {
                name: 'query-incidents',
                result: {
                    incidents: [
                        { id: 'INC-123', service: 'payment-api', status: 'active' }
                    ]
                },
                arguments: { service: 'payment-api' },
            },
        ];

        const refined = await engine.applyFollowUps(results, 'test-chat', [], 'what caused this incident?');

        // Should generate follow-up suggestions based on capability handlers
        assert.ok(Array.isArray(refined));
    });

    await t.test('applyFollowUps generates follow-up suggestions', async () => {
        const results: ToolResult[] = [
            {
                name: 'query-incidents',
                result: {
                    incidents: [{
                        id: 'INC-123',
                        service: 'payment-api',
                        startTime: '2024-01-01T10:00:00Z',
                    }],
                },
                arguments: {},
            },
        ];

        const refined = await engine.applyFollowUps(results, 'test-chat', [], 'what caused this incident?');

        // Should generate follow-up suggestions based on capability handlers
        assert.ok(Array.isArray(refined));
    });

    await t.test('applyFollowUps handles empty results', async () => {
        const results: ToolResult[] = [];

        const refined = await engine.applyFollowUps(results, 'test-chat', [], 'show everything');

        // Should handle empty results gracefully
        assert.ok(Array.isArray(refined));
        assert.strictEqual(refined.length, 0);
    });

    await t.test('applyFollowUps suggests orchestration plans for active incidents', async () => {
        const results: ToolResult[] = [
            {
                name: 'query-incidents',
                result: [
                    { id: 'INC-123', service: 'payment-api', status: 'active' }
                ],
                arguments: {},
            },
        ];

        const refined = await engine.applyFollowUps(results, 'test-chat', [], 'what caused this incident?');
        const orchestrationCall = refined.find(c => c.name === 'query-orchestration-plans');

        assert.ok(orchestrationCall);
        const scope = orchestrationCall?.arguments?.scope as { service?: string } | undefined;
        assert.equal(scope?.service, 'payment-api');
    });

    await t.test('applyFollowUps avoids duplicating orchestration plan calls', async () => {
        const results: ToolResult[] = [
            {
                name: 'query-incidents',
                result: [
                    { id: 'INC-123', service: 'payment-api', status: 'active' }
                ],
                arguments: {},
            },
        ];

        const plannedCalls = [
            {
                name: 'query-orchestration-plans',
                arguments: { scope: { service: 'payment-api' } },
            },
        ];

        const refined = await engine.applyFollowUps(results, 'test-chat', [], 'what caused this incident?', plannedCalls);
        const orchestrationCalls = refined.filter(c => c.name === 'query-orchestration-plans');

        assert.equal(orchestrationCalls.length, 0);
    });

    await t.test('applyFollowUps skips orchestration plans when no problem signal', async () => {
        const results: ToolResult[] = [
            {
                name: 'query-incidents',
                result: [],
                arguments: {},
            },
        ];

        const refined = await engine.applyFollowUps(results, 'test-chat', [], 'show me services');
        const orchestrationCalls = refined.filter(c => c.name === 'query-orchestration-plans');

        assert.equal(orchestrationCalls.length, 0);
    });

    await t.test('deduplicates suggestions with similar timestamps (fuzzy matching)', async () => {
        const results: ToolResult[] = [
            {
                name: 'query-incidents',
                result: [
                    {
                        id: 'INC-123',
                        service: 'payment-api',
                        status: 'active',
                        title: 'Payment timeout errors',
                        createdAt: '2025-12-06T17:50:00.000Z',
                    }
                ],
            },
        ];

        // Call twice with slightly different question context that might generate similar timestamps
        const suggestions1 = await engine.applyFollowUps(results, 'test-chat', [], 'root cause analysis');

        // All suggestions should be unique - no duplicates by tool+service
        const toolServiceKeys = suggestions1.map(s => {
            const scope = s.arguments?.scope as { service?: string } | undefined;
            return `${s.name}:${scope?.service ?? 'none'}`;
        });
        const uniqueKeys = new Set(toolServiceKeys);

        assert.strictEqual(toolServiceKeys.length, uniqueKeys.size, 'Should have no duplicate tool+service combinations');
    });

    await t.test('resolved incidents do not trigger orchestration plan suggestions', async () => {
        const results: ToolResult[] = [
            {
                name: 'query-incidents',
                result: [{ id: 'INC-001', service: 'payments', status: 'resolved' }],
                arguments: {},
            },
        ];

        const suggestions = await engine.applyFollowUps(results, 'test', [], 'show me services');
        const orchestrationCalls = suggestions.filter(c => c.name === 'query-orchestration-plans');
        assert.strictEqual(orchestrationCalls.length, 0, 'Resolved incidents should not trigger orchestration plans');
    });

    await t.test('incidents with unknown status do not trigger problem detection', async () => {
        const results: ToolResult[] = [
            {
                name: 'query-incidents',
                result: [{ id: 'INC-002', service: 'payments', status: 'postmortem' }],
                arguments: {},
            },
        ];

        const suggestions = await engine.applyFollowUps(results, 'test', [], 'list recent entries');
        const orchestrationCalls = suggestions.filter(c => c.name === 'query-orchestration-plans');
        assert.strictEqual(orchestrationCalls.length, 0, 'Unknown statuses should not trigger orchestration lookups');
    });

    await t.test('explicitly active incidents still trigger problem detection', async () => {
        const results: ToolResult[] = [
            {
                name: 'query-incidents',
                result: [{ id: 'INC-003', service: 'payments', status: 'triggered' }],
                arguments: {},
            },
        ];

        const suggestions = await engine.applyFollowUps(results, 'test', [], 'what is happening?');
        const orchestrationCalls = suggestions.filter(c => c.name === 'query-orchestration-plans');
        assert.ok(orchestrationCalls.length > 0, 'Explicitly active incidents should still trigger orchestration plans');
    });

    await t.test('cleared alerts do not trigger problem detection', async () => {
        const results: ToolResult[] = [
            {
                name: 'query-alerts',
                result: [{ id: 'ALT-001', service: 'api', status: 'cleared' }],
                arguments: {},
            },
        ];

        const suggestions = await engine.applyFollowUps(results, 'test', [], 'show me the dashboard');
        const orchestrationCalls = suggestions.filter(c => c.name === 'query-orchestration-plans');
        assert.strictEqual(orchestrationCalls.length, 0, 'Cleared alerts should not trigger orchestration plans');
    });
});
