import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getToolKey } from '../../src/engine/toolKeyExtractor.js';

test('getToolKey', async (t) => {
    await t.test('generates stable key for tool name with no args', () => {
        const key = getToolKey('query-logs', undefined);
        assert.equal(key, 'query-logs:{}');
    });

    await t.test('generates stable key for tool name with empty args', () => {
        const key = getToolKey('query-logs', {});
        assert.equal(key, 'query-logs:{}');
    });

    await t.test('generates stable key for tool with simple args', () => {
        const key = getToolKey('query-logs', { limit: 10, search: 'error' });
        // Keys should be sorted alphabetically
        assert.equal(key, 'query-logs:{"limit":10,"search":"error"}');
    });

    await t.test('sorts arguments alphabetically for stable keys', () => {
        const key1 = getToolKey('query-incidents', { limit: 5, status: 'open' });
        const key2 = getToolKey('query-incidents', { status: 'open', limit: 5 });
        assert.equal(key1, key2, 'Keys should be identical regardless of argument order');
    });

    await t.test('normalizes timestamps to nearest minute', () => {
        const key1 = getToolKey('query-logs', { start: '2025-12-07T10:30:15.000Z' });
        const key2 = getToolKey('query-logs', { start: '2025-12-07T10:30:45.999Z' });
        assert.equal(key1, key2, 'Timestamps within same minute should produce same key');
    });

    await t.test('produces different keys for different minutes', () => {
        const key1 = getToolKey('query-logs', { start: '2025-12-07T10:30:00.000Z' });
        const key2 = getToolKey('query-logs', { start: '2025-12-07T10:31:00.000Z' });
        assert.notEqual(key1, key2, 'Timestamps in different minutes should produce different keys');
    });

    await t.test('handles nested objects', () => {
        const key = getToolKey('query-logs', {
            expression: { search: 'error', filters: [] },
            limit: 100
        });
        assert.ok(key.includes('expression'), 'Should include nested object');
        assert.ok(key.includes('search'), 'Should include nested properties');
    });

    await t.test('handles arrays with timestamps', () => {
        const key1 = getToolKey('query-metrics', {
            times: ['2025-12-07T10:30:15.000Z', '2025-12-07T11:30:15.000Z']
        });
        const key2 = getToolKey('query-metrics', {
            times: ['2025-12-07T10:30:45.000Z', '2025-12-07T11:30:45.000Z']
        });
        assert.equal(key1, key2, 'Array timestamps should be normalized');
    });

    await t.test('handles non-timestamp strings unchanged', () => {
        const key = getToolKey('query-incidents', { status: 'open', title: 'Payment failure' });
        assert.ok(key.includes('open'), 'Should preserve status string');
        assert.ok(key.includes('Payment failure'), 'Should preserve title string');
    });

    await t.test('handles null values', () => {
        const key = getToolKey('query-logs', { search: null, limit: 10 });
        assert.ok(key.includes('null'), 'Should handle null values');
    });

    await t.test('handles boolean values', () => {
        const key = getToolKey('query-logs', { verbose: true, debug: false });
        assert.ok(key.includes('true'), 'Should preserve boolean true');
        assert.ok(key.includes('false'), 'Should preserve boolean false');
    });

    await t.test('handles numeric values', () => {
        const key = getToolKey('query-metrics', { step: 300, threshold: 0.95 });
        assert.ok(key.includes('300'), 'Should preserve integers');
        assert.ok(key.includes('0.95'), 'Should preserve floats');
    });
});
