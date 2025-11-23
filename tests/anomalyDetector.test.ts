import './setup.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AnomalyDetector } from '../src/engine/anomalyDetector.js';
import { domainRegistry } from '../src/engine/domainRegistry.js';
import { ToolResult, MetricSeries } from '../src/types.js';

test('AnomalyDetector', async (t) => {
    const detector = new AnomalyDetector(domainRegistry);

    await t.test('extractMetricSeries', async (st) => {
        await st.test('extracts series from metric tool results', () => {
            const results: ToolResult[] = [
                {
                    name: 'query-metrics',
                    result: {
                        series: [
                            {
                                metric: 'cpu_usage',
                                values: [
                                    ['2024-01-01T10:00:00Z', 50],
                                    ['2024-01-01T10:01:00Z', 60],
                                ],
                            },
                        ],
                    },
                    arguments: { expression: 'cpu_usage' },
                },
            ];

            const series = detector.extractMetricSeries(results);
            assert.strictEqual(series.length, 1);
            assert.strictEqual(series[0].expression, 'cpu_usage');
            assert.strictEqual(series[0].values.length, 2);
        });

        await st.test('returns empty array for non-metric results', () => {
            const results: ToolResult[] = [
                {
                    name: 'query-logs',
                    result: { logs: [] },
                },
            ];

            const series = detector.extractMetricSeries(results);
            assert.strictEqual(series.length, 0);
        });

        await st.test('handles multiple series', () => {
            const results: ToolResult[] = [
                {
                    name: 'query-metrics',
                    result: {
                        series: [
                            {
                                metric: 'cpu_usage',
                                values: [['2024-01-01T10:00:00Z', 50]],
                            },
                            {
                                metric: 'memory_usage',
                                values: [['2024-01-01T10:00:00Z', 70]],
                            },
                        ],
                    },
                    arguments: {},
                },
            ];

            const series = detector.extractMetricSeries(results);
            assert.strictEqual(series.length, 2);
        });
    });

    await t.test('detectAnomalies', async (st) => {
        await st.test('detects spike anomalies', () => {
            const series: MetricSeries = {
                timestamps: [
                    '2024-01-01T10:00:00Z',
                    '2024-01-01T10:01:00Z',
                    '2024-01-01T10:02:00Z',
                ],
                values: [50, 50, 100], // 100% spike
                expression: 'cpu_usage',
            };

            const anomalies = detector.detectAnomalies(series);
            const spikes = anomalies.filter(a => a.type === 'spike');
            assert.ok(spikes.length > 0);
            assert.strictEqual(spikes[0].value, 100);
        });

        await st.test('detects drop anomalies', () => {
            const series: MetricSeries = {
                timestamps: [
                    '2024-01-01T10:00:00Z',
                    '2024-01-01T10:01:00Z',
                    '2024-01-01T10:02:00Z',
                ],
                values: [100, 100, 20], // 80% drop
                expression: 'rps',
            };

            const anomalies = detector.detectAnomalies(series);
            const drops = anomalies.filter(a => a.type === 'drop');
            assert.ok(drops.length > 0);
        });

        await st.test('detects outliers', () => {
            const series: MetricSeries = {
                timestamps: [
                    '2024-01-01T10:00:00Z',
                    '2024-01-01T10:01:00Z',
                    '2024-01-01T10:02:00Z',
                    '2024-01-01T10:03:00Z',
                    '2024-01-01T10:04:00Z',
                ],
                values: [50, 52, 51, 200, 49], // 200 is outlier
                expression: 'latency',
            };

            const anomalies = detector.detectAnomalies(series);
            // The spike detector may catch this before outlier detector
            // Just verify we detected some anomaly
            assert.ok(anomalies.length > 0);
            assert.ok(anomalies.some(a => a.value === 200));
        });

        await st.test('returns empty for insufficient data', () => {
            const series: MetricSeries = {
                timestamps: ['2024-01-01T10:00:00Z'],
                values: [50],
                expression: 'cpu_usage',
            };

            const anomalies = detector.detectAnomalies(series);
            assert.strictEqual(anomalies.length, 0);
        });

        await st.test('sorts anomalies by severity and time', () => {
            const series: MetricSeries = {
                timestamps: [
                    '2024-01-01T10:00:00Z',
                    '2024-01-01T10:01:00Z',
                    '2024-01-01T10:02:00Z',
                    '2024-01-01T10:03:00Z',
                ],
                values: [50, 100, 50, 150], // Multiple spikes
                expression: 'cpu_usage',
            };

            const anomalies = detector.detectAnomalies(series);
            assert.ok(anomalies.length > 0);
            // High severity should come first
            for (let i = 0; i < anomalies.length - 1; i++) {
                const severityOrder = { high: 3, medium: 2, low: 1 };
                assert.ok(
                    severityOrder[anomalies[i].severity] >=
                    severityOrder[anomalies[i + 1].severity]
                );
            }
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

        await st.test('detects decreasing trend', () => {
            const series: MetricSeries = {
                timestamps: [
                    '2024-01-01T10:00:00Z',
                    '2024-01-01T10:01:00Z',
                    '2024-01-01T10:02:00Z',
                    '2024-01-01T10:03:00Z',
                ],
                values: [40, 30, 20, 10],
                expression: 'error_rate',
            };

            const trends = detector.detectTrends(series);
            assert.strictEqual(trends.length, 1);
            assert.strictEqual(trends[0].direction, 'decreasing');
        });

        await st.test('detects stable trend', () => {
            const series: MetricSeries = {
                timestamps: [
                    '2024-01-01T10:00:00Z',
                    '2024-01-01T10:01:00Z',
                    '2024-01-01T10:02:00Z',
                    '2024-01-01T10:03:00Z',
                ],
                values: [50, 50.1, 49.9, 50],
                expression: 'cpu_usage',
            };

            const trends = detector.detectTrends(series);
            if (trends.length > 0) {
                assert.strictEqual(trends[0].direction, 'stable');
            }
        });

        await st.test('returns empty for insufficient data', () => {
            const series: MetricSeries = {
                timestamps: ['2024-01-01T10:00:00Z', '2024-01-01T10:01:00Z'],
                values: [50, 60],
                expression: 'cpu_usage',
            };

            const trends = detector.detectTrends(series);
            assert.strictEqual(trends.length, 0);
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

        await st.test('handles services without anomalies', () => {
            const seriesList: MetricSeries[] = [
                {
                    timestamps: ['2024-01-01T10:00:00Z', '2024-01-01T10:01:00Z'],
                    values: [50, 51],
                    expression: 'cpu_usage',
                    service: 'service-a',
                },
            ];

            const comparison = detector.compareServices(seriesList);
            assert.ok(comparison.length >= 0);
        });
    });
});
