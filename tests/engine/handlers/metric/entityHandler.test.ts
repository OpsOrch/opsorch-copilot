import assert from 'node:assert/strict';
import { test } from 'node:test';
import { metricEntityHandler } from '../../../../src/engine/handlers/metric/entityHandler.js';
import { ToolResult, HandlerContext } from '../../../../src/types.js';

test('metricEntityHandler', async (t) => {
    const context: HandlerContext = {
        chatId: 'test',
        turnNumber: 1,
        conversationHistory: [],
        toolResults: [],
        userQuestion: 'test'
    };

    await t.test('extracts entities from query-metrics', async () => {
        const result: ToolResult = {
            name: 'query-metrics',
            result: [
                {
                    name: 'cpu_usage',
                    points: [
                        { timestamp: '2024-01-01T10:00:00Z', value: 50 },
                        { timestamp: '2024-01-01T10:01:00Z', value: 55 }
                    ]
                }
            ],
            arguments: {}
        };

        const entities = await metricEntityHandler(context, result);

        // Should find 1 metric entity ('cpu_usage') and maybe timestamps?
        // Let's assume entityHandler extracts metric name.

        const metrics = entities.filter(e => e.type === 'metric');
        assert.equal(metrics.length, 1);
        assert.equal(metrics[0].value, 'cpu_usage');
        assert.equal(metrics[0].prominence, 1.0);
    });
});
