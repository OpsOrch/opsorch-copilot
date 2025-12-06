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

    await t.test("skips query-alerts when alert context exists in history", async () => {
        // Reuse context structure but inject history
        const testContext: HandlerContext = {
            ...context,
            turnNumber: 1,
            conversationHistory: [{
                userMessage: 'check monitor-123',
                timestamp: Date.now(),
                entities: [{ type: 'alert', value: 'monitor-123', extractedAt: Date.now(), source: 'test' }]
            }],
            userQuestion: 'check monitor status'
        };

        const result = await alertIntentHandler(testContext);
        assert.ok(!result.suggestedTools.includes('query-alerts'),
            'should NOT suggest query-alerts when context exists');
        assert.ok(result.reasoning.includes('alert context found'),
            'reasoning should mention context');
    });
});
