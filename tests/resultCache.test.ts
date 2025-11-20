import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ResultCache } from '../src/engine/resultCache.js';
import { ToolCall, ToolResult } from '../src/types.js';

test('caches and retrieves tool results', () => {
    const cache = new ResultCache({ maxSize: 10, ttlMs: 60000 });

    const call: ToolCall = {
        name: 'query-incidents',
        arguments: { limit: 5, severities: ['sev1'] }
    };

    const result: ToolResult = {
        name: 'query-incidents',
        result: { incidents: [{ id: 'inc-123' }] }
    };

    cache.set(call, result);
    const retrieved = cache.get(call);

    assert.deepEqual(retrieved, result);
});

test('returns null for cache miss', () => {
    const cache = new ResultCache();

    const call: ToolCall = {
        name: 'query-logs',
        arguments: { query: 'error' }
    };

    assert.equal(cache.get(call), null);
});

test('cache key is consistent for same arguments', () => {
    const cache = new ResultCache();

    const call1: ToolCall = { name: 'test', arguments: { a: 1, b: 2 } };
    const call2: ToolCall = { name: 'test', arguments: { b: 2, a: 1 } }; // Different order

    const result: ToolResult = { name: 'test', result: 'data' };

    cache.set(call1, result);
    assert.deepEqual(cache.get(call2), result); // Should find it despite different order
});

test('evicts oldest entry when max size reached', () => {
    const cache = new ResultCache({ maxSize: 3, ttlMs: 60000 });

    const calls: ToolCall[] = [
        { name: 'call1', arguments: {} },
        { name: 'call2', arguments: {} },
        { name: 'call3', arguments: {} },
        { name: 'call4', arguments: {} }, // This should evict call1
    ];

    const results: ToolResult[] = calls.map((call, i) => ({
        name: call.name,
        result: `result${i + 1}`
    }));

    calls.forEach((call, i) => cache.set(call, results[i]));

    assert.equal(cache.get(calls[0]), null); // call1 evicted
    assert.deepEqual(cache.get(calls[1]), results[1]); // call2 still there
    assert.deepEqual(cache.get(calls[2]), results[2]); // call3 still there
    assert.deepEqual(cache.get(calls[3]), results[3]); // call4 just added
});

test('expires entries after TTL', async () => {
    const cache = new ResultCache({ maxSize: 10, ttlMs: 50 }); // 50ms TTL

    const call: ToolCall = { name: 'test', arguments: {} };
    const result: ToolResult = { name: 'test', result: 'data' };

    cache.set(call, result);
    assert.deepEqual(cache.get(call), result); // Fresh

    // Wait for expiration
    await new Promise(resolve => setTimeout(resolve, 60));

    assert.equal(cache.get(call), null); // Expired
});

test('clears all entries', () => {
    const cache = new ResultCache();

    cache.set({ name: 'test1', arguments: {} }, { name: 'test1', result: 'data1' });
    cache.set({ name: 'test2', arguments: {} }, { name: 'test2', result: 'data2' });

    assert.equal(cache.stats().size, 2);

    cache.clear();

    assert.equal(cache.stats().size, 0);
});

test('invalidates by tool name', () => {
    const cache = new ResultCache();

    cache.set({ name: 'query-incidents', arguments: { limit: 5 } }, { name: 'query-incidents', result: 'data1' });
    cache.set({ name: 'query-logs', arguments: { query: 'error' } }, { name: 'query-logs', result: 'data2' });
    cache.set({ name: 'query-incidents', arguments: { limit: 10 } }, { name: 'query-incidents', result: 'data3' });

    cache.invalidateByToolName('query-incidents');

    assert.equal(cache.get({ name: 'query-incidents', arguments: { limit: 5 } }), null);
    assert.equal(cache.get({ name: 'query-incidents', arguments: { limit: 10 } }), null);
    assert.deepEqual(cache.get({ name: 'query-logs', arguments: { query: 'error' } }), { name: 'query-logs', result: 'data2' });
});

test('LRU: recently accessed items are not evicted', () => {
    const cache = new ResultCache({ maxSize: 3, ttlMs: 60000 });

    const call1: ToolCall = { name: 'old', arguments: {} };
    const call2: ToolCall = { name: 'middle', arguments: {} };
    const call3: ToolCall = { name: 'recent', arguments: {} };
    const call4: ToolCall = { name: 'new', arguments: {} };

    cache.set(call1, { name: 'old', result: '1' });
    cache.set(call2, { name: 'middle', result: '2' });
    cache.set(call3, { name: 'recent', result: '3' });

    // Access call1 to make it recently used
    cache.get(call1);

    // Add new item (should evict call2, not call1)
    cache.set(call4, { name: 'new', result: '4' });

    assert.deepEqual(cache.get(call1), { name: 'old', result: '1' }); // Still there (recently accessed)
    assert.equal(cache.get(call2), null); // Evicted (least recently used)
    assert.deepEqual(cache.get(call3), { name: 'recent', result: '3' }); // Still there
    assert.deepEqual(cache.get(call4), { name: 'new', result: '4' }); // Just added
});
