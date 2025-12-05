import assert from 'node:assert/strict';
import { test } from 'node:test';
import { logValidationHandler } from '../../../../src/engine/handlers/log/validationHandler.js';
import { HandlerContext, ValidationError } from '../../../../src/types.js';

test('logValidationHandler', async (t) => {
    const context: HandlerContext = {
        chatId: 'test',
        turnNumber: 1,
        conversationHistory: [],
        toolResults: [],
        userQuestion: 'test'
    };

    await t.test('validates valid query arguments', async () => {
        const result = await logValidationHandler(
            context,
            'query-logs',
            {
                start: '2024-01-01T10:00:00Z',
                end: '2024-01-01T11:00:00Z',
                expression: {
                    search: 'error',
                    severityIn: ['error']
                },
                limit: 100
            }
        );
        assert.equal(result.valid, true);
    });

    await t.test('defaults logic for missing start/end', async () => {
        const result = await logValidationHandler(
            context,
            'query-logs',
            { expression: { search: 'test' } }
        );
        assert.equal(result.valid, true);
        assert.ok(result.normalizedArgs?.start);
        assert.ok(result.normalizedArgs?.end);
    });

    await t.test('rejects invalid timestamps', async () => {
        const result = await logValidationHandler(
            context,
            'query-logs',
            {
                start: 'invalid',
                end: '2024-01-01T11:00:00Z'
            }
        );
        assert.equal(result.valid, false);
        assert.ok(result.errors?.some((e: ValidationError) => e.field === 'start'));
    });

    await t.test('rejects start > end', async () => {
        const result = await logValidationHandler(
            context,
            'query-logs',
            {
                start: '2024-01-01T12:00:00Z',
                end: '2024-01-01T11:00:00Z'
            }
        );
        assert.equal(result.valid, false);
        assert.ok(result.errors?.some((e: ValidationError) => e.field === 'start')); // Or code=INVALID_TIME_RANGE
    });

    await t.test('validates severity levels', async () => {
        const result = await logValidationHandler(
            context,
            'query-logs',
            {
                start: '2024-01-01T10:00:00Z',
                end: '2024-01-01T11:00:00Z',
                expression: {
                    severityIn: ['fun'] // invalid
                }
            }
        );
        assert.equal(result.valid, false);
        assert.ok(result.errors?.some((e: ValidationError) => e.field === 'expression.severityIn'));
    });
});
