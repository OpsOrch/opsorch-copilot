import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildReferences } from '../../src/engine/referenceBuilder.js';
import { DomainRegistry } from '../../src/engine/domainRegistry.js';
import type { DomainConfig, ToolResult } from '../../src/types.js';
import { incidentDomain } from '../../src/engine/domains/incident.js';

test('buildReferences - extracts incident IDs from arguments', () => {
    const registry = new DomainRegistry();
    const incidentDomain: DomainConfig = {
        name: 'incident',
        version: '1.0.0',
        toolPatterns: [{ match: 'get-incident', type: 'exact' }],
        entities: [{ type: 'incident', idPaths: ['$.id'], collectionKey: 'incidents' }],
        references: [],
        referenceExtraction: {
            argumentPaths: {
                incident: ['$.arguments.id', '$.arguments.incidentId'],
            },
        },
    };

    registry.register(incidentDomain);

    const results: ToolResult[] = [
        {
            name: 'get-incident',
            arguments: { id: 'INC-123' },
            result: { title: 'Test Incident' },
        },
    ];

    const refs = buildReferences(results, registry);
    assert.ok(refs);
    assert.deepEqual(refs.incidents, ['INC-123']);
});

test('buildReferences - extracts incident IDs from results', () => {
    const registry = new DomainRegistry();
    const incidentDomain: DomainConfig = {
        name: 'incident',
        version: '1.0.0',
        toolPatterns: [{ match: 'query-incidents', type: 'exact' }],
        entities: [{ type: 'incident', idPaths: ['$.id'], collectionKey: 'incidents' }],
        references: [],
        referenceExtraction: {
            resultPaths: {
                incident: {
                    idPaths: ['$.result.id'],
                    arrayPaths: ['$.result.incidents[*]'],
                },
            },
        },
    };

    registry.register(incidentDomain);

    const results: ToolResult[] = [
        {
            name: 'query-incidents',
            arguments: {},
            result: {
                incidents: [
                    { id: 'INC-1', title: 'First' },
                    { id: 'INC-2', title: 'Second' },
                ],
            },
        },
    ];

    const refs = buildReferences(results, registry);
    assert.ok(refs);
    assert.ok(refs.incidents);
    assert.deepEqual(refs.incidents!.sort(), ['INC-1', 'INC-2']);
});

test('buildReferences - extracts structured metric references', () => {
    const registry = new DomainRegistry();
    const metricDomain: DomainConfig = {
        name: 'metric',
        version: '1.0.0',
        toolPatterns: [{ match: 'query-metrics', type: 'exact' }],
        entities: [{ type: 'metric', idPaths: ['$.expression'] }],
        references: [],
        referenceExtraction: {
            structuredReferences: [
                {
                    bucket: 'metrics',
                    schema: 'copilot.metricQuery',
                    requiredFields: [{ name: 'expression', path: '$.arguments.expression' }],
                    optionalFields: [
                        { name: 'start', path: '$.arguments.start' },
                        { name: 'end', path: '$.arguments.end' },
                        { name: 'step', path: '$.arguments.step' },
                    ],
                },
            ],
        },
    };

    registry.register(metricDomain);

    const results: ToolResult[] = [
        {
            name: 'query-metrics',
            arguments: {
                expression: { metricName: 'latency_p95' },
                start: '2024-01-01T00:00:00Z',
                end: '2024-01-01T01:00:00Z',
                step: 60,
            },
            result: { series: [] },
        },
    ];

    const refs = buildReferences(results, registry);
    assert.ok(refs);
    assert.ok(refs.metrics);
    assert.equal(refs.metrics!.length, 1);
    assert.deepEqual(refs.metrics![0].expression, { metricName: 'latency_p95' });
    assert.equal(refs.metrics![0].start, '2024-01-01T00:00:00Z');
    assert.equal(refs.metrics![0].step, 60);
});

test('buildReferences - extracts structured log references', () => {
    const registry = new DomainRegistry();
    const logDomain: DomainConfig = {
        name: 'log',
        version: '1.0.0',
        toolPatterns: [{ match: 'query-logs', type: 'exact' }],
        entities: [{ type: 'log_query', idPaths: ['$.query'] }],
        references: [],
        referenceExtraction: {
            structuredReferences: [
                {
                    bucket: 'logs',
                    schema: 'copilot.logQuery',
                    requiredFields: [{ name: 'expression', path: '$.arguments.expression' }],
                    optionalFields: [
                        { name: 'start', path: '$.arguments.start' },
                        { name: 'scope', path: '$.arguments.scope' },
                    ],
                },
            ],
        },
    };

    registry.register(logDomain);

    const results: ToolResult[] = [
        {
            name: 'query-logs',
            arguments: {
                expression: { search: 'error OR exception' },
                start: '2024-01-01T00:00:00Z',
                scope: { service: 'api-gateway' },
            },
            result: { entries: [] },
        },
    ];

    const refs = buildReferences(results, registry);
    assert.ok(refs);
    assert.ok(refs.logs);
    assert.equal(refs.logs!.length, 1);
    assert.deepEqual(refs.logs![0].expression, { search: 'error OR exception' });
    assert.equal(refs.logs![0].scope?.service, 'api-gateway');
});

test('buildReferences - handles missing required fields', () => {
    const registry = new DomainRegistry();
    const domain: DomainConfig = {
        name: 'test',
        version: '1.0.0',
        toolPatterns: [{ match: 'test-tool', type: 'exact' }],
        entities: [],
        references: [],
        referenceExtraction: {
            structuredReferences: [
                {
                    bucket: 'testBucket',
                    schema: 'test.schema',
                    requiredFields: [{ name: 'required', path: '$.arguments.required' }],
                },
            ],
        },
    };

    registry.register(domain);

    const results: ToolResult[] = [
        {
            name: 'test-tool',
            arguments: {}, // Missing required field
            result: {},
        },
    ];

    const refs = buildReferences(results, registry);
    // Should return undefined or empty since required field is missing
    assert.ok(!refs || !(refs as any).testBucket);
});

test('buildReferences - deduplicates entity IDs', () => {
    const registry = new DomainRegistry();
    const domain: DomainConfig = {
        name: 'service',
        version: '1.0.0',
        toolPatterns: [{ match: 'query-services', type: 'exact' }],
        entities: [{ type: 'service', idPaths: ['$.id'], collectionKey: 'services' }],
        references: [],
        referenceExtraction: {
            resultPaths: {
                service: {
                    idPaths: ['$.result.services[*].id'],
                },
            },
        },
    };

    registry.register(domain);

    const results: ToolResult[] = [
        {
            name: 'query-services',
            arguments: {},
            result: {
                services: [
                    { id: 'api-gateway' },
                    { id: 'payment-service' },
                    { id: 'api-gateway' }, // Duplicate
                ],
            },
        },
    ];

    const refs = buildReferences(results, registry);
    assert.ok(refs);
    assert.ok(refs.services);
    assert.equal(refs.services!.length, 2);
    assert.ok(refs.services!.includes('api-gateway'));
    assert.ok(refs.services!.includes('payment-service'));
});

test('buildReferences - handles tools without domain configuration', () => {
    const registry = new DomainRegistry();

    const results: ToolResult[] = [
        {
            name: 'unknown-tool',
            arguments: {},
            result: { data: 'something' },
        },
    ];

    const refs = buildReferences(results, registry);
    // Should return undefined for unknown tools
    assert.ok(!refs);
});

test('buildReferences - returns undefined for empty results', () => {
    const registry = new DomainRegistry();
    const refs = buildReferences([], registry);
    assert.ok(!refs);
});

test('buildReferences - extracts service from scope argument globally', () => {
    // Setup registry with incident domain (which doesn't have explicit service extraction from scope)
    const registry = new DomainRegistry();
    registry.register(incidentDomain);

    const results: ToolResult[] = [
        {
            name: 'query-incidents',
            arguments: {
                scope: {
                    service: 'payment-service',
                    environment: 'prod'
                }
            },
            result: {
                incidents: []
            }
        }
    ];

    const refs = buildReferences(results, registry);

    assert.ok(refs, 'References should be defined');
    assert.ok(refs.services, 'Services bucket should be defined');
    assert.ok(refs.services.includes('payment-service'), 'Should contain payment-service');
});
