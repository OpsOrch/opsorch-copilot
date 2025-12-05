import assert from 'node:assert/strict';
import { test } from 'node:test';
import { metricValidationHandler } from '../../../../src/engine/handlers/metric/validationHandler.js';
import { HandlerContext, ValidationError } from '../../../../src/types.js';

test('metricValidationHandler', async (t) => {
    const context: HandlerContext = {
        chatId: 'test',
        turnNumber: 1,
        conversationHistory: [],
        toolResults: [],
        userQuestion: 'test'
    };

    await t.test('validates valid query arguments', async () => {
        const result = await metricValidationHandler(
            context,
            'query-metrics',
            {
                start: '2024-01-01T10:00:00Z',
                end: '2024-01-01T11:00:00Z',
                step: 60,
                expression: {
                    metricName: 'cpu_usage',
                    filters: { host: 'server-1' }
                }
            }
        );
        assert.equal(result.valid, true);
    });

    await t.test('rejects missing metric name', async () => {
        const result = await metricValidationHandler(
            context,
            'query-metrics',
            {
                start: '2024-01-01T10:00:00Z',
                end: '2024-01-01T11:00:00Z',
                step: 60,
                expression: {} // Missing metricName
            }
        );
        assert.equal(result.valid, false);
        assert.ok(result.errors?.some((e: ValidationError) => e.field === 'expression.metricName' || e.code === 'MISSING_REQUIRED'));
    });

    await t.test('rejects non-positive step', async () => {
        const result = await metricValidationHandler(
            context,
            'query-metrics',
            {
                start: '2024-01-01T10:00:00Z',
                end: '2024-01-01T11:00:00Z',
                step: -1,
                expression: { metricName: 'cpu' }
            }
        );
        assert.equal(result.valid, false);
        assert.ok(result.errors?.some((e: ValidationError) => e.field === 'step'));
    });
});
