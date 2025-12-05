import assert from 'node:assert/strict';
import { test } from 'node:test';
import { incidentValidationHandler } from '../../../../src/engine/handlers/incident/validationHandler.js';
import { HandlerContext, ValidationError } from '../../../../src/types.js';

test('incidentValidationHandler', async (t) => {
    const context: HandlerContext = {
        chatId: 'test',
        turnNumber: 1,
        conversationHistory: [],
        toolResults: [],
        userQuestion: 'test'
    };

    await t.test('validates valid query arguments', async () => {
        const result = await incidentValidationHandler(
            context,
            'query-incidents',
            {
                statuses: ['open', 'resolved'],
                limit: 10,
                scope: { service: 'payment-api' }
            }
        );
        assert.equal(result.valid, true);
    });

    await t.test('validates valid get arguments', async () => {
        const result = await incidentValidationHandler(
            context,
            'get-incident',
            { id: 'INC-123' }
        );
        assert.equal(result.valid, true);
    });

    await t.test('rejects non-string ID', async () => {
        const result = await incidentValidationHandler(
            context,
            'get-incident',
            { id: 123 }
        );
        assert.equal(result.valid, false);
        assert.ok(result.errors?.some((e: ValidationError) => e.field === 'id'));
    });

    await t.test('rejects non-array statuses', async () => {
        const result = await incidentValidationHandler(
            context,
            'query-incidents',
            { statuses: 'open' } // should be array
        );
        assert.equal(result.valid, false);
        assert.ok(result.errors?.some((e: ValidationError) => e.field === 'statuses'));
    });

    await t.test('rejects non-string values in statuses array', async () => {
        const result = await incidentValidationHandler(
            context,
            'query-incidents',
            { statuses: ['open', 123] }
        );
        assert.equal(result.valid, false);
        assert.ok(result.errors?.some((e: ValidationError) => e.field === 'statuses'));
    });

    await t.test('rejects negative limit', async () => {
        const result = await incidentValidationHandler(
            context,
            'query-incidents',
            { limit: -5 }
        );
        assert.equal(result.valid, false);
        assert.ok(result.errors?.some((e: ValidationError) => e.field === 'limit'));
    });

    await t.test('rejects excessive limit', async () => {
        const result = await incidentValidationHandler(
            context,
            'query-incidents',
            { limit: 5000 }
        );
        assert.equal(result.valid, false);
        assert.ok(result.errors?.some((e: ValidationError) => e.code === 'LIMIT_EXCEEDED'));
    });

    await t.test('validates scope object fields', async () => {
        const result = await incidentValidationHandler(
            context,
            'query-incidents',
            { scope: { service: 123 } } // should be string
        );
        assert.equal(result.valid, false);
        assert.ok(result.errors?.some((e: ValidationError) => e.field === 'scope.service'));
    });
});
