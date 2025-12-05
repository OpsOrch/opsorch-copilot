import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AnomalyDetector } from '../../src/engine/anomalyDetector.js';
import { ToolResult, MetricSeries } from '../../src/types.js';

test('AnomalyDetector', async (t) => {
    const detector = new AnomalyDetector();

    await t.test('extractMetricSeries', async (st) => {
        await st.test('extracts series from metric tool results', () => {
            const results: ToolResult[] = [
                {
                    name: 'query-metrics',
                    result: [
                        {
                            name: 'cpu_usage',
                            points: [
                                { timestamp: '2024-01-01T10:00:00Z', value: 50 },
                                { timestamp: '2024-01-01T10:01:00Z', value: 60 },
                            ],
                        },
                    ],
                    arguments: { expression: { metricName: 'cpu_usage' } },
                },
            ];

            const series = detector.extractMetricSeries(results);
            assert.strictEqual(series.length, 1);
            assert.strictEqual(series[0].expression, 'cpu_usage');
            assert.strictEqual(series[0].values.length, 2);
            assert.strictEqual(series[0].values[0], 50);
            assert.strictEqual(series[0].values[1], 60);
        });

        await st.test('returns empty array for non-metric results', () => {
            const results: ToolResult[] = [
                {
                    name: 'query-logs',
                    result: { logs: [] },
                    arguments: {},
                },
            ];

            const series = detector.extractMetricSeries(results);
            assert.strictEqual(series.length, 0);
        });

        await st.test('handles multiple series', () => {
            const results: ToolResult[] = [
                {
                    name: 'query-metrics',
                    result: [
                        {
                            name: 'cpu_usage',
                            points: [{ timestamp: '2024-01-01T10:00:00Z', value: 50 }],
                        },
                        {
                            name: 'memory_usage',
                            points: [{ timestamp: '2024-01-01T10:00:00Z', value: 70 }],
                        },
                    ],
                    arguments: {},
                },
            ];

            const series = detector.extractMetricSeries(results);
            assert.strictEqual(series.length, 2);
            assert.strictEqual(series[0].expression, 'cpu_usage');
            assert.strictEqual(series[1].expression, 'memory_usage');
        });
    });

    await t.test('detectAnomalies', async (st) => {
        await st.test('detects spike anomalies', async () => {
            const series: MetricSeries = {
                timestamps: [
                    '2024-01-01T10:00:00Z',
                    '2024-01-01T10:01:00Z',
                    '2024-01-01T10:02:00Z',
                ],
                values: [50, 50, 100], // 100% spike
                expression: 'cpu_usage',
            };

            const anomalies = await detector.detectAnomalies(series);
            const spikes = anomalies.filter(a => a.type === 'spike');
            assert.ok(spikes.length > 0);
            assert.strictEqual(spikes[0].value, 100);
        });

        await st.test('detects drop anomalies', async () => {
            const series: MetricSeries = {
                timestamps: [
                    '2024-01-01T10:00:00Z',
                    '2024-01-01T10:01:00Z',
                    '2024-01-01T10:02:00Z',
                ],
                values: [100, 100, 20], // 80% drop
                expression: 'rps',
            };

            const anomalies = await detector.detectAnomalies(series);
            const drops = anomalies.filter(a => a.type === 'drop');
            assert.ok(drops.length > 0);
        });

        await st.test('returns empty for insufficient data', async () => {
            const series: MetricSeries = {
                timestamps: ['2024-01-01T10:00:00Z'],
                values: [50],
                expression: 'cpu_usage',
            };

            const anomalies = await detector.detectAnomalies(series);
            assert.strictEqual(anomalies.length, 0);
        });
    });

    await t.test('detectTrends', async (st) => {
        await st.test('detects increasing trend', () => {
            const series: MetricSeries = {
                timestamps: [
                    '2024-01-01T10:00:00Z',
                    '2024-01-01T10:01:00Z',
                    '2024-01-01T10:02:00Z',
                    '2024-01-01T10:03:00Z',
                ],
                values: [10, 20, 30, 40],
                expression: 'cpu_usage',
            };

            const trends = detector.detectTrends(series);
            assert.strictEqual(trends.length, 1);
            assert.strictEqual(trends[0].direction, 'increasing');
            assert.ok(trends[0].confidence > 0.6);
        });
    });

    await t.test('compareServices', async (st) => {
        await st.test('ranks services by anomaly severity', () => {
            const seriesList: MetricSeries[] = [
                {
                    timestamps: ['2024-01-01T10:00:00Z', '2024-01-01T10:01:00Z'],
                    values: [50, 100], // High spike
                    expression: 'cpu_usage',
                    service: 'service-a',
                },
                {
                    timestamps: ['2024-01-01T10:00:00Z', '2024-01-01T10:01:00Z'],
                    values: [50, 55], // Small change
                    expression: 'cpu_usage',
                    service: 'service-b',
                },
            ];

            const comparison = detector.compareServices(seriesList);
            assert.ok(comparison.length > 0);
            // Service with more severe anomalies should rank higher
            assert.ok(comparison[0].severity >= comparison[comparison.length - 1].severity);
        });
    });
});

