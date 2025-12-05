import assert from 'node:assert/strict';
import { test } from 'node:test';
import { metricQueryBuilder } from '../../../../src/engine/handlers/metric/queryBuilder.js';
import { HandlerContext, JsonObject } from '../../../../src/types.js';

test('metricQueryBuilder', async (t) => {
    const context: HandlerContext = {
        chatId: 'test',
        turnNumber: 1,
        conversationHistory: [],
        toolResults: [],
        userQuestion: 'test'
    };

    await t.test('builds query for cpu', async () => {
        const result = await metricQueryBuilder(context, 'query-metrics', 'check cpu usage');
        const expr = result.expression as JsonObject;
        assert.equal(expr?.metricName, 'cpu');
    });

    await t.test('builds query for memory', async () => {
        const result = await metricQueryBuilder(context, 'query-metrics', 'how is memory?');
        const expr = result.expression as JsonObject;
        assert.equal(expr?.metricName, 'memory');
    });

    await t.test('skips expression if no metric identified', async () => {
        const result = await metricQueryBuilder(context, 'query-metrics', 'check metrics');
        assert.equal(result.expression, undefined);
    });

    await t.test('sets default time window', async () => {
        const result = await metricQueryBuilder(context, 'query-metrics', 'check cpu');
        assert.ok(result.start);
        assert.ok(result.end);
        assert.equal(result.step, 60);
    });
});
