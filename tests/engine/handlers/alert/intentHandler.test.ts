import assert from 'node:assert/strict';
import { test } from 'node:test';
import { alertIntentHandler } from '../../../../src/engine/handlers/alert/intentHandler.js';
import { HandlerContext } from '../../../../src/types.js';

test('alertIntentHandler', async (t) => {
    const context: HandlerContext = {
        chatId: 'test',
        turnNumber: 1,
        conversationHistory: [],
        toolResults: [],
        userQuestion: ''
    };

    await t.test('detects alert keywords', async () => {
        const testContext = { ...context, userQuestion: 'show me alerts' };
        const result = await alertIntentHandler(testContext);
        assert.equal(result.intent, 'observability');
        assert.ok(result.suggestedTools.includes('query-alerts'));
        assert.equal(result.confidence, 1.0);
    });

    await t.test('detects detector keyword', async () => {
        const testContext = { ...context, userQuestion: 'any detectors firing?' };
        const result = await alertIntentHandler(testContext);
        assert.equal(result.intent, 'observability');
        assert.equal(result.confidence, 1.0);
    });

    await t.test('returns unknown for unrelated query', async () => {
        const testContext = { ...context, userQuestion: 'hello world' };
        const result = await alertIntentHandler(testContext);
        assert.equal(result.intent, 'unknown');
        assert.equal(result.confidence, 0.0);
    });
});
