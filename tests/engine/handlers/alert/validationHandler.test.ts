import assert from 'node:assert/strict';
import { test } from 'node:test';
import { alertValidationHandler } from '../../../../src/engine/handlers/alert/validationHandler.js';
import { HandlerContext, ValidationError } from '../../../../src/types.js';

test('alertValidationHandler', async (t) => {
    const context: HandlerContext = {
        chatId: 'test',
        turnNumber: 1,
        conversationHistory: [],
        toolResults: [],
        userQuestion: 'test'
    };

    await t.test('validates valid query arguments', async () => {
        const result = await alertValidationHandler(
            context,
            'query-alerts',
            {
                statuses: ['firing'],
                severities: ['critical'],
                limit: 10,
                scope: { service: 'api' }
            }
        );
        assert.equal(result.valid, true);
    });

    await t.test('validates valid get arguments', async () => {
        const result = await alertValidationHandler(
            context,
            'get-alert',
            { id: 'AL-123' }
        );
        assert.equal(result.valid, true);
    });

    await t.test('rejects non-string ID', async () => {
        const result = await alertValidationHandler(
            context,
            'get-alert',
            { id: 123 }
        );
        assert.equal(result.valid, false);
        assert.ok(result.errors?.some((e: ValidationError) => e.field === 'id'));
    });

    await t.test('rejects invalid statuses type', async () => {
        const result = await alertValidationHandler(
            context,
            'query-alerts',
            { statuses: 'open' }
        );
        assert.equal(result.valid, false);
        assert.ok(result.errors?.some((e: ValidationError) => e.field === 'statuses'));
    });
});
