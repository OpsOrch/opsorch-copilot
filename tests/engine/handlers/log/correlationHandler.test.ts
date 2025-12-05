
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { logCorrelationHandler, extractLogEvents } from '../../../../src/engine/handlers/log/correlationHandler.js';
import { ToolResult, CorrelationEvent, HandlerContext } from '../../../../src/types.js';

test('logCorrelationHandler', async (t) => {

    // --- extractLogEvents Tests ---
    await t.test('extractLogEvents should return empty array for invalid payload', async () => {
        const result: ToolResult = { name: 'query-logs', result: null };
        const events = extractLogEvents(result);
        assert.deepEqual(events, []);
    });

    await t.test('extractLogEvents should detect error bursts (>5 errors/min)', async () => {
        // Create 6 error logs in the same minute
        const timestamp = '2023-01-01T10:00:30.000Z'; // 10:00 window
        const logs = Array(6).fill({
            timestamp,
            severity: 'error',
            message: 'Checking for error burst'
        });

        const result: ToolResult = {
            name: 'query-logs',
            result: logs
        };

        const events = extractLogEvents(result);

        // Should produce 1 error_burst event
        // Note: It might also produce individual critical_error events if severity was critical, 
        // but here severity is 'error', which isn't 'critical' or 'fatal'.

        assert.equal(events.length, 1);
        assert.equal(events[0].type, 'error_burst');
        assert.equal(events[0].value, 6);
        assert.equal(events[0].timestamp, '2023-01-01T10:00:00.000Z'); // Window start
    });

    await t.test('extractLogEvents should detect critical errors', async () => {
        const logs = [{
            timestamp: '2023-01-01T10:00:10.000Z',
            severity: 'critical',
            message: 'System crash'
        }];

        const result: ToolResult = {
            name: 'query-logs',
            result: logs
        };

        const events = extractLogEvents(result);

        // 1 log is not enough for burst (<5), but severity is critical so -> critical_error event
        assert.equal(events.length, 1);
        assert.equal(events[0].type, 'critical_error');
        assert.ok((events[0].metadata as Record<string, unknown>)?.message && 
                  typeof events[0].metadata.message === 'string' && 
                  events[0].metadata.message.includes('System crash'));
    });

    // --- logCorrelationHandler Tests ---

    const context: HandlerContext = {
        chatId: 'test',
        turnNumber: 1,
        conversationHistory: [],
        toolResults: [],
        userQuestion: ''
    };

    await t.test('logCorrelationHandler should correlate error burst with metric spike', async () => {
        const t0 = Date.now();
        const events: CorrelationEvent[] = [
            {
                timestamp: new Date(t0).toISOString(),
                source: 'log',
                type: 'error_burst',
                value: 10
            },
            {
                timestamp: new Date(t0 + 1000).toISOString(),
                source: 'metric',
                type: 'metric_spike',
                value: 90
            }
        ];

        const correlations = await logCorrelationHandler(context, events);

        assert.ok(correlations.length > 0);
        const corr = correlations[0];
        assert.ok(corr.strength > 0.5);
        // Boost for log-metric is 0.3.
    });

    await t.test('logCorrelationHandler should correlate critical error with incident created', async () => {
        const t0 = Date.now();
        const events: CorrelationEvent[] = [
            {
                timestamp: new Date(t0).toISOString(),
                source: 'log',
                type: 'critical_error',
                metadata: { level: 'fatal' }
            },
            {
                timestamp: new Date(t0 + 2000).toISOString(),
                source: 'incident',
                type: 'incident_created',
                metadata: { id: 'INC-1' }
            }
        ];

        const correlations = await logCorrelationHandler(context, events);

        assert.ok(correlations.length > 0);
        const corr = correlations[0];
        // Boost 0.35
        assert.ok(corr.strength > 0.5);
    });

    await t.test('logCorrelationHandler should discard weak correlations', async () => {
        const t0 = Date.now();
        const events: CorrelationEvent[] = [
            {
                timestamp: new Date(t0).toISOString(),
                source: 'log',
                type: 'error_burst',
                value: 10
            },
            {
                // 4.9 mins later -> temporal very low
                timestamp: new Date(t0 + 290 * 1000).toISOString(),
                source: 'unknown' as 'metric' | 'log' | 'incident',
                type: 'random_event'
            }
        ];
        // No specific type boost for 'random_event'.
        // Temporal ~ 0.03. + 0.15 general boost source mismatch? (log vs unknown) -> 0.18 << 0.5.

        const correlations = await logCorrelationHandler(context, events);
        assert.equal(correlations.length, 0);
    });
});
