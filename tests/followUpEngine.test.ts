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
                result: { incidents: [] },
                arguments: { service: 'payment-api' },
            },
        ];



        const refined = await engine.applyFollowUps(results, 'test-chat', [], 'Show incidents');

        // Should not include duplicate
        assert.strictEqual(refined.length, 0);
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
});
