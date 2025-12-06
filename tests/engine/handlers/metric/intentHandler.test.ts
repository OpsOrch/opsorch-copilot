import assert from 'node:assert/strict';
import { test } from 'node:test';
import { metricIntentHandler } from '../../../../src/engine/handlers/metric/intentHandler.js';
import { HandlerContext } from '../../../../src/types.js';

test('metricIntentHandler', async (t) => {
    const context: HandlerContext = {
        chatId: 'test',
        turnNumber: 1,
        conversationHistory: [],
        toolResults: [],
        userQuestion: ''
    };

    await t.test('detects metric keywords', async () => {
        const testContext = { ...context, userQuestion: 'show me metrics' };
        const result = await metricIntentHandler(testContext);
        assert.equal(result.intent, 'observability');
        assert.ok(result.suggestedTools.includes('query-metrics'));
    });

    await t.test('suggests describe-metrics for discovery queries', async () => {
        const testContext = { ...context, userQuestion: 'what metrics are available?' };
        const result = await metricIntentHandler(testContext);
        assert.ok(result.suggestedTools.includes('describe-metrics'),
            'should suggest describe-metrics for "available" query');
        assert.ok(result.suggestedTools.includes('query-metrics'));
    });

    await t.test('detects latency and percentile keywords', async () => {
        const testContext = { ...context, userQuestion: 'check p99 latency' };
        const result = await metricIntentHandler(testContext);
        assert.equal(result.intent, 'observability');
        assert.ok(result.suggestedTools.includes('query-metrics'));
    });

    await t.test('detects continuation pattern', async () => {
        const testContext = { ...context, userQuestion: 'also show me cpu metrics' };
        const result = await metricIntentHandler(testContext);
        assert.equal(result.intent, 'navigation');
    });

    await t.test('returns unknown for unrelated query', async () => {
        const testContext = { ...context, userQuestion: 'hello world' };
        const result = await metricIntentHandler(testContext);
        assert.equal(result.intent, 'unknown');
        assert.equal(result.confidence, 0.0);
    });
});
