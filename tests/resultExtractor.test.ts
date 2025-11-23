import './setup.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ResultExtractor } from '../src/engine/resultExtractor.js';
import { domainRegistry } from '../src/engine/domainRegistry.js';
import { ToolResult } from '../src/types.js';

test('ResultExtractor', async (t) => {
    const extractor = new ResultExtractor(domainRegistry);

    await t.test('extractServicesFromHistory', async (st) => {
        await st.test('extracts services from incident results', () => {
            const results: ToolResult[] = [
                {
                    name: 'query-incidents',
                    result: {
                        incidents: [
                            { id: 'INC-1', service: 'payment-api' },
                            { id: 'INC-2', service: 'auth-service' },
                        ],
                    },
                },
            ];

            const services = extractor.extractServicesFromHistory(results);
            assert.ok(services.includes('payment-api'));
            assert.ok(services.includes('auth-service'));
        });

        await st.test('deduplicates services', () => {
            const results: ToolResult[] = [
                {
                    name: 'query-incidents',
                    result: {
                        incidents: [
                            { id: 'INC-1', service: 'payment-api' },
                            { id: 'INC-2', service: 'payment-api' },
                        ],
                    },
                },
            ];

            const services = extractor.extractServicesFromHistory(results);
            assert.strictEqual(services.length, 1);
            assert.strictEqual(services[0], 'payment-api');
        });

        await st.test('returns empty array for no results', () => {
            const services = extractor.extractServicesFromHistory([]);
            assert.deepStrictEqual(services, []);
        });

        await st.test('handles results without services', () => {
            const results: ToolResult[] = [
                {
                    name: 'query-logs',
                    result: { logs: [] },
                },
            ];

            const services = extractor.extractServicesFromHistory(results);
            assert.deepStrictEqual(services, []);
        });
    });

    await t.test('extractMostRecentService', async (st) => {
        await st.test('returns most recent service', () => {
            const results: ToolResult[] = [
                {
                    name: 'query-incidents',
                    result: { incidents: [{ id: 'INC-1', service: 'old-service' }] },
                },
                {
                    name: 'query-incidents',
                    result: { incidents: [{ id: 'INC-2', service: 'new-service' }] },
                },
            ];

            const service = extractor.extractMostRecentService(results);
            assert.strictEqual(service, 'new-service');
        });

        await st.test('returns undefined for no results', () => {
            const service = extractor.extractMostRecentService([]);
            assert.strictEqual(service, undefined);
        });

        await st.test('returns undefined when no services found', () => {
            const results: ToolResult[] = [
                {
                    name: 'query-logs',
                    result: { logs: [] },
                },
            ];

            const service = extractor.extractMostRecentService(results);
            assert.strictEqual(service, undefined);
        });
    });

    await t.test('extractValue', async (st) => {
        await st.test('extracts value from top-level field', () => {
            const payload = { service: 'payment-api', status: 'active' };
            const value = extractor.extractValue(payload, ['service']);
            assert.strictEqual(value, 'payment-api');
        });

        await st.test('extracts value from nested field', () => {
            const payload = { data: { service: 'payment-api' } };
            const value = extractor.extractValue(payload, ['service']);
            assert.strictEqual(value, 'payment-api');
        });

        await st.test('tries multiple field names', () => {
            const payload = { serviceName: 'payment-api' };
            const value = extractor.extractValue(payload, ['service', 'serviceName']);
            assert.strictEqual(value, 'payment-api');
        });

        await st.test('returns undefined when field not found', () => {
            const payload = { other: 'value' };
            const value = extractor.extractValue(payload, ['service']);
            assert.strictEqual(value, undefined);
        });

        await st.test('trims whitespace', () => {
            const payload = { service: '  payment-api  ' };
            const value = extractor.extractValue(payload, ['service']);
            assert.strictEqual(value, 'payment-api');
        });

        await st.test('skips empty strings', () => {
            const payload = { service: '', serviceName: 'payment-api' };
            const value = extractor.extractValue(payload, ['service', 'serviceName']);
            assert.strictEqual(value, 'payment-api');
        });
    });

    await t.test('extractIsoDate', async (st) => {
        await st.test('extracts ISO date from field', () => {
            const payload = { startTime: '2024-01-01T10:00:00Z' };
            const date = extractor.extractIsoDate(payload, ['startTime']);
            assert.strictEqual(date, '2024-01-01T10:00:00Z');
        });

        await st.test('extracts from nested fields', () => {
            const payload = { data: { timestamp: '2024-01-01T10:00:00Z' } };
            const date = extractor.extractIsoDate(payload, ['timestamp']);
            assert.strictEqual(date, '2024-01-01T10:00:00Z');
        });

        await st.test('filters by afterDate', () => {
            const payload = {
                start: '2024-01-01T10:00:00Z',
                end: '2024-01-01T11:00:00Z',
            };
            const date = extractor.extractIsoDate(
                payload,
                ['start', 'end'],
                '2024-01-01T10:30:00Z'
            );
            assert.strictEqual(date, '2024-01-01T11:00:00Z');
        });

        await st.test('returns undefined when no date found', () => {
            const payload = { other: 'value' };
            const date = extractor.extractIsoDate(payload, ['timestamp']);
            assert.strictEqual(date, undefined);
        });
    });

    await t.test('isIsoDateString', async (st) => {
        await st.test('recognizes valid ISO dates', () => {
            assert.ok(extractor.isIsoDateString('2024-01-01T10:00:00Z'));
            assert.ok(extractor.isIsoDateString('2024-12-31T23:59:59.999Z'));
        });

        await st.test('rejects invalid formats', () => {
            assert.ok(!extractor.isIsoDateString('2024-01-01'));
            assert.ok(!extractor.isIsoDateString('not-a-date'));
            assert.ok(!extractor.isIsoDateString('10:00:00'));
        });
    });
});
