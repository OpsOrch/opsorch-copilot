import assert from 'node:assert/strict';
import { test } from 'node:test';
import { orchestrationValidationHandler } from '../../../../src/engine/handlers/orchestration/validationHandler.js';
import type { HandlerContext } from '../../../../src/types.js';

test('orchestrationValidationHandler', async (t) => {
    const context: HandlerContext = {
        chatId: 'test',
        turnNumber: 1,
        conversationHistory: [],
        toolResults: [],
        userQuestion: ''
    };

    await t.test('validates query-orchestration-plans limit', async () => {
        const result = await orchestrationValidationHandler(context, 'query-orchestration-plans', { limit: 100 });
        assert.equal(result.valid, false);
        assert.ok(result.errors?.some((e) => e.code === 'INVALID_LIMIT'));

        const validResult = await orchestrationValidationHandler(context, 'query-orchestration-plans', { limit: 10 });
        assert.equal(validResult.valid, true);
    });

    await t.test('validates get-orchestration-plan id requirement', async () => {
        const result = await orchestrationValidationHandler(context, 'get-orchestration-plan', {});
        assert.equal(result.valid, false);
        assert.ok(result.errors?.some((e) => e.code === 'MISSING_ID'));

        const validResult = await orchestrationValidationHandler(context, 'get-orchestration-plan', { id: '123' });
        assert.equal(validResult.valid, true);
    });

    await t.test('allows other tools', async () => {
        const result = await orchestrationValidationHandler(context, 'other-tool', {});
        assert.equal(result.valid, true);
    });
});
