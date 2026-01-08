import assert from 'node:assert/strict';
import { test } from 'node:test';
import { metricValidationHandler } from '../../../../src/engine/handlers/metric/validationHandler.js';
import { HandlerContext, ValidationError, TurnExecutionTrace } from '../../../../src/types.js';

// Helper to create context with describe-metrics already called
function createContextWithDescribeMetrics(service?: string): HandlerContext {
    return {
        chatId: 'test',
        turnNumber: 1,
        conversationHistory: [{
            userMessage: 'show metrics',
            timestamp: Date.now(),
            executionTrace: {
                traceId: 'trace-1',
                startTime: Date.now(),
                endTime: Date.now(),
                totalDurationMs: 100,
                iterations: [{
                    iterationNumber: 1,
                    plannedTools: [],
                    heuristicModifications: [],
                    toolExecutions: [{
                        toolName: 'describe-metrics',
                        arguments: { scope: service ? { service } : null },
                        cacheHit: false,
                        executionTimeMs: 50,
                        success: true,
                    }],
                    durationMs: 100,
                }],
            } as TurnExecutionTrace,
        }],
        toolResults: [],
        userQuestion: 'test'
    };
}

test('metricValidationHandler', async (t) => {
    await t.test('rejects query-metrics when describe-metrics not called', async () => {
        const context: HandlerContext = {
            chatId: 'test',
            turnNumber: 1,
            conversationHistory: [],
            toolResults: [],
            userQuestion: 'test'
        };

        const result = await metricValidationHandler(
            context,
            'query-metrics',
            {
                start: '2024-01-01T10:00:00Z',
                end: '2024-01-01T11:00:00Z',
                step: 60,
                expression: { metricName: 'cpu_usage' }
            }
        );

        assert.equal(result.valid, false);
        assert.ok(result.errors?.some((e: ValidationError) => e.code === 'PREREQUISITE_NOT_MET'));
        assert.ok(result.replacementCall, 'should suggest describe-metrics as replacement');
        assert.equal(result.replacementCall?.name, 'describe-metrics');
    });

    await t.test('provides replacementCall with correct scope', async () => {
        const context: HandlerContext = {
            chatId: 'test',
            turnNumber: 1,
            conversationHistory: [],
            toolResults: [],
            userQuestion: 'test'
        };

        const result = await metricValidationHandler(
            context,
            'query-metrics',
            {
                scope: { service: 'svc-cache' },
                expression: { metricName: 'error_rate' }
            }
        );

        assert.equal(result.valid, false);
        assert.ok(result.replacementCall);
        assert.equal(result.replacementCall?.name, 'describe-metrics');
        const scope = result.replacementCall?.arguments?.scope as { service?: string } | null;
        assert.equal(scope?.service, 'svc-cache');
    });

    await t.test('allows query-metrics when describe-metrics was called in history', async () => {
        const context = createContextWithDescribeMetrics();

        const result = await metricValidationHandler(
            context,
            'query-metrics',
            {
                start: '2024-01-01T10:00:00Z',
                end: '2024-01-01T11:00:00Z',
                step: 60,
                expression: { metricName: 'cpu_usage' }
            }
        );

        assert.equal(result.valid, true);
    });

    await t.test('allows query-metrics when describe-metrics in current toolResults', async () => {
        const context: HandlerContext = {
            chatId: 'test',
            turnNumber: 1,
            conversationHistory: [],
            toolResults: [{
                name: 'describe-metrics',
                arguments: { scope: null },
                result: [{ name: 'cpu_usage' }]
            }],
            userQuestion: 'test'
        };

        const result = await metricValidationHandler(
            context,
            'query-metrics',
            {
                start: '2024-01-01T10:00:00Z',
                end: '2024-01-01T11:00:00Z',
                step: 60,
                expression: { metricName: 'cpu_usage' }
            }
        );

        assert.equal(result.valid, true);
    });

    await t.test('validates valid query arguments after describe-metrics', async () => {
        const context = createContextWithDescribeMetrics();

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
        const context = createContextWithDescribeMetrics();

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
        const context = createContextWithDescribeMetrics();

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
    await t.test('rejects hallucinated metric name not in discovered list', async () => {
        const context: HandlerContext = {
            chatId: 'test',
            turnNumber: 1,
            conversationHistory: [],
            toolResults: [{
                name: 'describe-metrics',
                arguments: { scope: null },
                result: [{ name: 'cpu_usage' }, { name: 'memory_usage' }]
            }],
            userQuestion: 'test'
        };

        const result = await metricValidationHandler(
            context,
            'query-metrics',
            {
                start: '2024-01-01T10:00:00Z',
                end: '2024-01-01T11:00:00Z',
                step: 60,
                expression: { metricName: 'correlation_lag_seconds' }
            }
        );

        assert.equal(result.valid, false);
        assert.ok(result.errors?.some((e: ValidationError) => e.code === 'INVALID_METRIC_NAME'));
        // Since describe-metrics is in toolResults (fresh), we should NOT suggest it again to avoid loops
        assert.strictEqual(result.replacementCall, undefined, 'should NOT suggest describe-metrics if it was already called in this turn');
    });

    await t.test('allows unknown metric name if describe-metrics was only in history (blind trust)', async () => {
        const context = createContextWithDescribeMetrics(); // details in history, unknown result content

        const result = await metricValidationHandler(
            context,
            'query-metrics',
            {
                start: '2024-01-01T10:00:00Z',
                end: '2024-01-01T11:00:00Z',
                step: 60,
                expression: { metricName: 'potentially_hallucinated_but_we_cant_know' }
            }
        );

        assert.equal(result.valid, true, 'should pass validation because we cannot verify history results');
    });

    await t.test('handles string array output from describe-metrics', async () => {
        const context: HandlerContext = {
            chatId: 'test',
            turnNumber: 1,
            conversationHistory: [],
            toolResults: [{
                name: 'describe-metrics',
                arguments: { scope: null },
                result: ['cpu_usage', 'memory_usage']
            }],
            userQuestion: 'test'
        };

        const result = await metricValidationHandler(
            context,
            'query-metrics',
            {
                start: '2024-01-01T10:00:00Z',
                end: '2024-01-01T11:00:00Z',
                step: 60,
                expression: { metricName: 'cpu_usage' }
            }
        );
        assert.equal(result.valid, true, 'should accept metric present in string array');
    });


    await t.test('handles wrapped metrics object result from describe-metrics', async () => {
        const context: HandlerContext = {
            chatId: 'test',
            turnNumber: 1,
            conversationHistory: [],
            toolResults: [{
                name: 'describe-metrics',
                arguments: { scope: null },
                result: { metrics: ['cpu_usage', 'memory_usage'] }
            }],
            userQuestion: 'test'
        };

        const result = await metricValidationHandler(
            context,
            'query-metrics',
            {
                start: '2024-01-01T10:00:00Z',
                end: '2024-01-01T11:00:00Z',
                step: 60,
                expression: { metricName: 'cpu_usage' }
            }
        );
        assert.equal(result.valid, true, 'should accept metric present in wrapped metrics object');
    });
});


