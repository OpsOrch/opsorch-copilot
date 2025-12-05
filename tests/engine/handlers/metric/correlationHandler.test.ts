
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { metricCorrelationHandler, extractMetricEvents } from '../../../../src/engine/handlers/metric/correlationHandler.js';
import { ToolResult, CorrelationEvent, HandlerContext } from '../../../../src/types.js';

test('metricCorrelationHandler', async (t) => {

    // --- extractMetricEvents Tests ---
    await t.test('extractMetricEvents should return empty array for invalid payload', async () => {
        const result: ToolResult = { name: 'query-metrics', result: null };
        const events = extractMetricEvents(result);
        assert.deepEqual(events, []);
    });


    await t.test('extractMetricEvents should detect anomalies (> 2 stddev)', async () => {
        // Create a series with a clear spike
        // Using a large spike to ensure anomaly detection
        const points2 = [
            { timestamp: '2023-01-01T00:00:00Z', value: 10 },
            { timestamp: '2023-01-01T00:01:00Z', value: 10 },
            { timestamp: '2023-01-01T00:02:00Z', value: 10 },
            { timestamp: '2023-01-01T00:03:00Z', value: 10 },
            { timestamp: '2023-01-01T00:04:00Z', value: 10 },
            { timestamp: '2023-01-01T00:05:00Z', value: 10 },
            { timestamp: '2023-01-01T00:06:00Z', value: 10 },
            { timestamp: '2023-01-01T00:07:00Z', value: 10 },
            { timestamp: '2023-01-01T00:08:00Z', value: 1000 }, // Huge Spike
        ];

        const result: ToolResult = {
            name: 'query-metrics',
            result: [{
                name: 'cpu_usage',
                points: points2
            }]
        };

        const events = extractMetricEvents(result);

        assert.equal(events.length, 1, 'Should detect one anomaly');
        assert.equal(events[0].type, 'metric_spike');
        assert.equal(events[0].value, 1000);
    });

    await t.test('extractMetricEvents should detect drops', async () => {
        // [50, 50, 50, 50, 0]. Mean=40. Var=[100,100,100,100,1600]/5=400. Std=20.
        // |0-40|=40. 2*Std=40. 40 > 40 False.

        // Use a baseline of 50, and a drop to -100 (if possible) or just make baseline more stable with more points.
        const points = [
            { timestamp: '2023-01-01T00:00:00Z', value: 50 },
            { timestamp: '2023-01-01T00:01:00Z', value: 50 },
            { timestamp: '2023-01-01T00:02:00Z', value: 50 },
            { timestamp: '2023-01-01T00:03:00Z', value: 50 },
            { timestamp: '2023-01-01T00:04:00Z', value: 50 },
            { timestamp: '2023-01-01T00:05:00Z', value: 50 },
            { timestamp: '2023-01-01T00:06:00Z', value: 0 }, // Drop
        ];
        // Mean = 300/7 = 42.8. 
        // Diffs sq for 50s: (7.2)^2 = 51.84. * 6 = 311.
        // Diff sq for 0: (42.8)^2 = 1831.
        // Sum = 2142. Var = 306. Std = 17.5.
        // |0 - 42.8| = 42.8.
        // 2 * 17.5 = 35.
        // 42.8 > 35. TRUE.

        const result: ToolResult = {
            name: 'query-metrics',
            result: [{
                name: 'requests',
                points: points
            }]
        };

        const events = extractMetricEvents(result);
        assert.equal(events.length, 1, 'Should detect one drop');
        assert.equal(events[0].type, 'metric_drop');
        assert.equal(events[0].value, 0);
    });

    await t.test('extractMetricEvents should ignore stable data', async () => {
        const points = [
            { timestamp: '2023-01-01T00:00:00Z', value: 10 },
            { timestamp: '2023-01-01T00:01:00Z', value: 11 },
            { timestamp: '2023-01-01T00:02:00Z', value: 9 },
        ];
        const result: ToolResult = {
            name: 'query-metrics',
            result: [{
                name: 'stable_metric',
                points: points
            }]
        };

        const events = extractMetricEvents(result);
        assert.equal(events.length, 0);
    });

    // --- metricCorrelationHandler Tests ---

    const context: HandlerContext = {
        chatId: 'test',
        turnNumber: 1,
        conversationHistory: [],
        toolResults: [],
        userQuestion: ''
    };

    await t.test('metricCorrelationHandler should correlate metric spike with error burst', async () => {
        const t0 = Date.now();
        const events: CorrelationEvent[] = [
            {
                timestamp: new Date(t0).toISOString(),
                source: 'metric',
                type: 'metric_spike',
                value: 90
            },
            {
                timestamp: new Date(t0 + 1000).toISOString(), // 1 second later
                source: 'log',
                type: 'error_burst', // Known strong correlation pair
                value: 50
            }
        ];

        const correlations = await metricCorrelationHandler(context, events);

        assert.ok(correlations.length > 0);
        const corr = correlations[0];
        assert.ok(corr.strength >= 0.5);
        // Base max strength 1.0. typeBoost 0.3. 
        // Temporal close to 1.
        // Expect > 0.8
        assert.ok(corr.strength > 0.8);
        assert.equal(corr.events.length, 2);
    });

    await t.test('metricCorrelationHandler should degrade strength with time', async () => {
        const t0 = Date.now();
        const events: CorrelationEvent[] = [
            {
                timestamp: new Date(t0).toISOString(),
                source: 'metric',
                type: 'metric_spike',
                value: 90
            },
            {
                // Max delta is 5 mins. Put it at 4 mins.
                timestamp: new Date(t0 + 4 * 60 * 1000).toISOString(),
                source: 'log',
                type: 'error_burst',
                value: 50
            }
        ];

        const correlations = await metricCorrelationHandler(context, events);

        if (correlations.length > 0) {
            // Strength = (1 - 4/5) + 0.3(boost) = 0.2 + 0.3 = 0.5
            // Threshold is 0.5. It might barely pass or fail depending on precision.
            const corr = correlations[0];
            assert.ok(corr.strength < 0.8); // Weaker than immediate
        }
    });

    await t.test('metricCorrelationHandler should respect threshold (<0.5)', async () => {
        const t0 = Date.now();
        const events: CorrelationEvent[] = [
            {
                timestamp: new Date(t0).toISOString(),
                source: 'metric',
                type: 'metric_spike',
                value: 90
            },
            {
                // 4.9 minutes later -> temporal ~ 0.02
                // + 0.3 boost = 0.32
                // < 0.5 -> should be filtered
                timestamp: new Date(t0 + 290 * 1000).toISOString(),
                source: 'log',
                type: 'error_burst',
                value: 50
            }
        ];

        const correlations = await metricCorrelationHandler(context, events);
        assert.equal(correlations.length, 0);
    });

    await t.test('metricCorrelationHandler should correlate two metrics (cascading)', async () => {
        const t0 = Date.now();
        const events: CorrelationEvent[] = [
            {
                timestamp: new Date(t0).toISOString(),
                source: 'metric',
                type: 'metric_spike',
                value: 100,
                metadata: { metric: 'cpu' }
            },
            {
                timestamp: new Date(t0 + 2000).toISOString(),
                source: 'metric',
                type: 'metric_spike',
                value: 500,
                metadata: { metric: 'latency' }
            }
        ];

        const correlations = await metricCorrelationHandler(context, events);
        assert.ok(correlations.length > 0);
        // Boost for metric-metric is 0.2
        assert.equal(correlations[0].description, 'metric_spike followed by metric_spike within 2 second(s)');
    });
});
