import assert from 'node:assert/strict';
import { test } from 'node:test';
import { logIntentHandler } from '../../../../src/engine/handlers/log/intentHandler.js';
import { HandlerContext } from '../../../../src/types.js';

test('logIntentHandler', async (t) => {
    const context: HandlerContext = {
        chatId: 'test',
        turnNumber: 1,
        conversationHistory: [],
        toolResults: [],
        userQuestion: ''
    };

    await t.test('detects log keywords', async () => {
        const testContext = { ...context, userQuestion: 'show me logs' };
        const result = await logIntentHandler(testContext);
        assert.equal(result.intent, 'observability');
        assert.ok(result.suggestedTools.includes('query-logs'));
        assert.equal(result.confidence, 0.9);
    });

    await t.test('detects error codes', async () => {
        const testContext = { ...context, userQuestion: 'any 500s?' };
        const result = await logIntentHandler(testContext);
        assert.equal(result.intent, 'observability');
        assert.equal(result.confidence, 0.9);
        assert.ok(result.reasoning?.includes('error code'));
    });
});
