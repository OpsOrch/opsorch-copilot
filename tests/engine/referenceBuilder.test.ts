import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildReferences } from '../../src/engine/referenceBuilder.js';
import { ToolResult } from '../../src/types.js';

test('referenceBuilder', async (t) => {

    await t.test('extracts incident IDs', () => {
        const results: ToolResult[] = [
            {
                name: 'query-incidents',
                result: {
                    incidents: [
                        { id: 'INC-1', title: 'Incident 1' },
                        { id: 'INC-2', title: 'Incident 2' }
                    ]
                },
                arguments: {}
            },
            {
                name: 'get-incident',
                result: { id: 'INC-3' },
                arguments: { id: 'INC-3' }
            }
        ];

        const refs = buildReferences(results);
        assert.ok(refs);
        assert.ok(refs.incidents);
        assert.strictEqual(refs.incidents.length, 3);
        assert.ok(refs.incidents.includes('INC-1'));
        assert.ok(refs.incidents.includes('INC-2'));
        assert.ok(refs.incidents.includes('INC-3'));
    });

    await t.test('extracts service names', () => {
        const results: ToolResult[] = [
            {
                name: 'query-services',
                result: [
                    { name: 'payment-api' },
                    { name: 'auth-service' }
                ],
                arguments: { service: 'checkout-service' }
            }
        ];

        const refs = buildReferences(results);
        assert.ok(refs);
        assert.ok(refs.services);
        assert.ok(refs.services.includes('payment-api')); // from result
        assert.ok(refs.services.includes('auth-service')); // from result
        assert.ok(refs.services.includes('checkout-service')); // from args
    });

    await t.test('extracts alert IDs', () => {
        const results: ToolResult[] = [
            {
                name: 'query-alerts',
                result: [
                    { id: 'ALT-1' },
                    { id: 'ALT-2' }
                ],
                arguments: {}
            },
            {
                name: 'get-alert',
                result: { id: 'ALT-3' },
                arguments: { id: 'ALT-3' }
            }
        ];

        const refs = buildReferences(results);
        assert.ok(refs);
        assert.ok(refs.alerts);
        assert.ok(refs.alerts.includes('ALT-1')); // from array result
        assert.ok(refs.alerts.includes('ALT-2')); // from array result
        assert.ok(refs.alerts.includes('ALT-3')); // from args
    });

    await t.test('extracts ticket IDs', () => {
        const results: ToolResult[] = [
            {
                name: 'query-tickets',
                result: [
                    { id: 'TKT-1' }
                ],
                arguments: {}
            },
            {
                name: 'get-ticket',
                result: { id: 'TKT-2' },
                arguments: { id: 'TKT-2' }
            }
        ];

        const refs = buildReferences(results);
        assert.ok(refs);
        assert.ok(refs.tickets);
        assert.ok(refs.tickets.includes('TKT-1'));
        assert.ok(refs.tickets.includes('TKT-2')); // from args
    });

    await t.test('extracts logs references', () => {
        const results: ToolResult[] = [
            {
                name: 'query-logs',
                result: { logs: [] },
                arguments: {
                    expression: { search: 'error OR exception' },
                    start: '2024-01-01T00:00:00Z',
                    end: '2024-01-01T01:00:00Z'
                }
            }
        ];

        const refs = buildReferences(results);
        assert.ok(refs);
        assert.ok(refs.logs);
        assert.strictEqual(refs.logs.length, 1);
        assert.strictEqual(refs.logs[0].expression.search, 'error OR exception');
        assert.strictEqual(refs.logs[0].start, '2024-01-01T00:00:00Z');
    });

    await t.test('extracts metric references', () => {
        const results: ToolResult[] = [
            {
                name: 'query-metrics',
                result: [],
                arguments: {
                    expression: { metricName: 'cpu_usage' },
                    start: '2024-01-01T00:00:00Z'
                }
            }
        ];

        const refs = buildReferences(results);
        assert.ok(refs);
        assert.ok(refs.metrics);
        assert.strictEqual(refs.metrics.length, 1);
        assert.strictEqual(refs.metrics[0].expression.metricName, 'cpu_usage');
        assert.strictEqual(refs.metrics[0].start, '2024-01-01T00:00:00Z');
    });
});
