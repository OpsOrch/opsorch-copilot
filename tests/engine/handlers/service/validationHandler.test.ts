import assert from 'node:assert/strict';
import { test } from 'node:test';
import { serviceValidationHandler } from '../../../../src/engine/handlers/service/validationHandler.js';
import { HandlerContext, ValidationError } from '../../../../src/types.js';

test('serviceValidationHandler', async (t) => {
    const context: HandlerContext = {
        chatId: 'test',
        turnNumber: 1,
        conversationHistory: [],
        toolResults: [],
        userQuestion: 'test'
    };

    await t.test('validates valid query arguments', async () => {
        const result = await serviceValidationHandler(
            context,
            'query-services',
            {
                ids: ['srv-1'],
                name: 'payment',
                tags: { env: 'prod' }
            }
        );
        assert.equal(result.valid, true);
    });

    await t.test('validates valid get arguments', async () => {
        const result = await serviceValidationHandler(
            context,
            'get-service',
            { name: 'payment-api' }
        );
        assert.equal(result.valid, true);
    });

    await t.test('rejects non-string name', async () => {
        const result = await serviceValidationHandler(
            context,
            'get-service',
            { name: 123 }
        );
        assert.equal(result.valid, false);
        assert.ok(result.errors?.some((e: ValidationError) => e.field === 'name'));
    });

    await t.test('rejects non-array ids', async () => {
        const result = await serviceValidationHandler(
            context,
            'query-services',
            { ids: 'srv-1' }
        );
        assert.equal(result.valid, false);
        assert.ok(result.errors?.some((e: ValidationError) => e.field === 'ids'));
    });
});
