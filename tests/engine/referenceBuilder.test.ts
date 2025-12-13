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
        // Verify alert IDs are NOT incorrectly added to incidents
        assert.ok(!refs.incidents || !refs.incidents.includes('ALT-1'));
        assert.ok(!refs.incidents || !refs.incidents.includes('ALT-2'));
        assert.ok(!refs.incidents || !refs.incidents.includes('ALT-3'));
    });

    await t.test('extracts services from alerts and scope args', () => {
        const results: ToolResult[] = [
            {
                name: 'query-alerts',
                result: [
                    {
                        id: 'ALT-1',
                        scope: { service: 'svc-payments' },
                        fields: {
                            service: 'svc-database',
                            affectedServices: ['svc-checkout', 'svc-catalog']
                        }
                    }
                ],
                arguments: { scope: { service: 'svc-api-gateway' } }
            },
            {
                name: 'query-metrics',
                result: [],
                arguments: { scope: { service: 'svc-notifications' } }
            }
        ];

        const refs = buildReferences(results);
        assert.ok(refs);
        assert.ok(refs.services);
        // From alert scope
        assert.ok(refs.services.includes('svc-payments'));
        // From alert fields.service
        assert.ok(refs.services.includes('svc-database'));
        // From alert fields.affectedServices
        assert.ok(refs.services.includes('svc-checkout'));
        assert.ok(refs.services.includes('svc-catalog'));
        // From query-alerts args.scope.service
        assert.ok(refs.services.includes('svc-api-gateway'));
        // From query-metrics args.scope.service (universal extraction)
        assert.ok(refs.services.includes('svc-notifications'));
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
    await t.test('extracts logs references with filters but no search', () => {
        const results: ToolResult[] = [
            {
                name: 'query-logs',
                result: { logs: [] },
                arguments: {
                    expression: {
                        filters: [
                            { field: 'service', operator: '=', value: 'svc-notifications' }
                        ]
                    },
                    start: '2025-12-06T14:53:39Z',
                    end: '2025-12-06T15:23:39Z',
                    scope: { service: 'svc-notifications', environment: 'prod' }
                }
            }
        ];

        const refs = buildReferences(results);
        assert.ok(refs, 'Should return references even without search string');
        assert.ok(refs.logs, 'Should have logs references');
        assert.strictEqual(refs.logs.length, 1);
        assert.deepEqual(refs.logs[0].scope, { service: 'svc-notifications' });
        assert.deepEqual(refs.logs[0].expression.filters, [{ field: 'service', operator: '=', value: 'svc-notifications' }]);
    });

    await t.test('extracts metric references with complex expression object', () => {
        const results: ToolResult[] = [
            {
                name: 'query-metrics',
                result: [],
                arguments: {
                    expression: {
                        metricName: 'http_requests_total',
                        filters: [{ label: 'status', operator: '=', value: '500' }]
                    },
                    start: '2025-12-06T15:08:03.584Z',
                    scope: { service: 'svc-notifications' }
                }
            }
        ];

        const refs = buildReferences(results);
        assert.ok(refs, 'Should return references');
        assert.ok(refs.metrics, 'Should return metric references');
        assert.strictEqual(refs.metrics[0].expression.metricName, 'http_requests_total');
    });

    await t.test('extracts metric references from result when expression missing from args', () => {
        const results: ToolResult[] = [
            {
                name: 'query-metrics',
                result: [
                    { metricName: 'demo.series', values: [[1733517600, 100.5]] },
                    { name: 'cpu_usage', values: [[1733517600, 45.2]] }
                ],
                arguments: {
                    step: 60,
                    start: '2025-12-06T19:00:00Z',
                    end: '2025-12-06T20:00:00Z',
                    scope: { service: 'svc-payments' }
                }
            }
        ];

        const refs = buildReferences(results);
        assert.ok(refs, 'Should return references when extracting from result');
        assert.ok(refs.metrics, 'Should have metrics references');
        assert.strictEqual(refs.metrics.length, 2, 'Should extract both metrics from result');
        assert.strictEqual(refs.metrics[0].expression.metricName, 'demo.series');
        assert.strictEqual(refs.metrics[1].expression.metricName, 'cpu_usage');
        assert.strictEqual(refs.metrics[0].start, '2025-12-06T19:00:00Z');
        assert.deepEqual(refs.metrics[0].scope, { service: 'svc-payments' });
    });

    await t.test('ignores describe-metrics results for references', () => {
        const results: ToolResult[] = [
            {
                name: 'describe-metrics',
                result: [
                    { name: 'cpu_usage' },
                    { name: 'memory_usage' }
                ],
                arguments: { service: 'backend' }
            }
        ];

        const refs = buildReferences(results);
        assert.equal(refs, undefined, 'Should return undefined if only describe-metrics present');
    });

    await t.test('extracts deployment IDs', () => {
        const results: ToolResult[] = [
            {
                name: 'query-deployments',
                result: {
                    deployments: [
                        { id: 'DEP-1', version: 'v1.2.3' },
                        { id: 'DEP-2', version: 'v1.2.4' }
                    ]
                },
                arguments: {}
            },
            {
                name: 'get-deployment',
                result: { id: 'DEP-3' },
                arguments: { id: 'DEP-3' }
            }
        ];

        const refs = buildReferences(results);
        assert.ok(refs);
        assert.ok(refs.deployments);
        assert.strictEqual(refs.deployments.length, 3);
        assert.ok(refs.deployments.includes('DEP-1'));
        assert.ok(refs.deployments.includes('DEP-2'));
        assert.ok(refs.deployments.includes('DEP-3'));
    });

    await t.test('extracts deployment IDs from array result', () => {
        const results: ToolResult[] = [
            {
                name: 'query-deployments',
                result: [
                    { id: 'DEP-4', status: 'success' },
                    { id: 'DEP-5', status: 'failed' }
                ],
                arguments: {}
            }
        ];

        const refs = buildReferences(results);
        assert.ok(refs);
        assert.ok(refs.deployments);
        assert.strictEqual(refs.deployments.length, 2);
        assert.ok(refs.deployments.includes('DEP-4'));
        assert.ok(refs.deployments.includes('DEP-5'));
    });

    await t.test('handles deployment references with mixed valid and invalid data', () => {
        const results: ToolResult[] = [
            {
                name: 'query-deployments',
                result: [
                    { id: 'DEP-6', status: 'success' },
                    { id: '', status: 'failed' }, // empty ID should be ignored
                    { status: 'pending' }, // missing ID should be ignored
                    { id: 'DEP-7', status: 'running' }
                ],
                arguments: { id: 'DEP-8' }
            }
        ];

        const refs = buildReferences(results);
        assert.ok(refs);
        assert.ok(refs.deployments);
        assert.strictEqual(refs.deployments.length, 3);
        assert.ok(refs.deployments.includes('DEP-6'));
        assert.ok(refs.deployments.includes('DEP-7'));
        assert.ok(refs.deployments.includes('DEP-8')); // from args
        assert.ok(!refs.deployments.includes('')); // empty ID should not be included
    });



});
