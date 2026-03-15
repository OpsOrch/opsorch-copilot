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

test('cache entries are scoped by namespace', () => {
    const cache = new ResultCache({ maxSize: 10, ttlMs: 60000 });
    const call: ToolCall = { name: 'query-incidents', arguments: { limit: 5 } };

    cache.set(call, { name: 'query-incidents', result: 'chat-a' }, 'chat-a');
    cache.set(call, { name: 'query-incidents', result: 'chat-b' }, 'chat-b');

    assert.deepEqual(cache.get(call, 'chat-a'), { name: 'query-incidents', result: 'chat-a' });
    assert.deepEqual(cache.get(call, 'chat-b'), { name: 'query-incidents', result: 'chat-b' });
    assert.equal(cache.get(call, 'chat-c'), null);
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

// Tests for fuzzy timestamp normalization
test('fuzzy matches timestamps within 60s for cache hits', () => {
    const cache = new ResultCache({ maxSize: 10, ttlMs: 60000 });

    // Two calls with timestamps differing by just seconds (same minute)
    const call1: ToolCall = {
        name: 'query-logs',
        arguments: {
            start: '2025-12-06T21:25:15.971Z',
            end: '2025-12-06T21:55:15.971Z',
        }
    };

    const call2: ToolCall = {
        name: 'query-logs',
        arguments: {
            start: '2025-12-06T21:25:45.999Z', // +30s
            end: '2025-12-06T21:55:30.123Z',   // +15s
        }
    };

    const result: ToolResult = { name: 'query-logs', result: { logs: [] } };

    cache.set(call1, result);

    // call2 should hit the cache because timestamps are within 60s
    const retrieved = cache.get(call2);
    assert.deepEqual(retrieved, result);
});

test('fuzzy matches across minute boundaries', () => {
    const cache = new ResultCache({ maxSize: 10, ttlMs: 60000 });

    const call1: ToolCall = {
        name: 'query-logs',
        arguments: {
            start: '2025-12-06T21:25:58.000Z',
            end: '2025-12-06T21:55:00.000Z',
        }
    };

    const call2: ToolCall = {
        name: 'query-logs',
        arguments: {
            start: '2025-12-06T21:26:02.000Z', // +4s, matches (old logic would fail here)
            end: '2025-12-06T21:55:00.000Z',
        }
    };

    const result: ToolResult = { name: 'query-logs', result: { logs: [] } };

    cache.set(call1, result);
    assert.deepEqual(cache.get(call2), result);
});

test('does not cache hit if difference > 60s', () => {
    const cache = new ResultCache({ maxSize: 10, ttlMs: 60000 });

    const call1: ToolCall = {
        name: 'query-logs',
        arguments: {
            start: '2025-12-06T21:25:15.971Z',
            end: '2025-12-06T21:55:15.971Z',
        }
    };

    const call2: ToolCall = {
        name: 'query-logs',
        arguments: {
            start: '2025-12-06T21:26:16.971Z', // +61s
            end: '2025-12-06T21:55:15.971Z',
        }
    };

    const result: ToolResult = { name: 'query-logs', result: { logs: [] } };

    cache.set(call1, result);

    // call2 should NOT hit the cache because start > 60s diff
    const retrieved = cache.get(call2);
    assert.equal(retrieved, null);
});

test('fuzzy matches nested timestamps in scope objects', () => {
    const cache = new ResultCache({ maxSize: 10, ttlMs: 60000 });

    const call1: ToolCall = {
        name: 'query-metrics',
        arguments: {
            expression: { metricName: 'http_errors' },
            start: '2025-12-06T17:20:00.000Z',
            end: '2025-12-06T21:40:00.000Z',
            scope: { service: 'svc-payments' },
        }
    };

    const call2: ToolCall = {
        name: 'query-metrics',
        arguments: {
            expression: { metricName: 'http_errors' },
            start: '2025-12-06T17:20:55.500Z', // +55s
            end: '2025-12-06T21:40:45.999Z',   // +45s
            scope: { service: 'svc-payments' },
        }
    };

    const result: ToolResult = { name: 'query-metrics', result: { series: [] } };

    cache.set(call1, result);
    assert.deepEqual(cache.get(call2), result); // Should cache hit
});

// Tests for hit/miss tracking
test('stats returns correct hit rate', () => {
    const cache = new ResultCache({ maxSize: 10, ttlMs: 60000 });

    const call: ToolCall = { name: 'test', arguments: { a: 1 } };
    const result: ToolResult = { name: 'test', result: 'data' };

    // First access should be a miss
    cache.get(call);

    // Store and retrieve should be a hit
    cache.set(call, result);
    cache.get(call);

    const stats = cache.stats();
    assert.equal(stats.hits, 1);
    assert.equal(stats.misses, 1);
    assert.equal(stats.hitRate, 0.5);
});

test('stats returns zero hit rate for empty cache', () => {
    const cache = new ResultCache({ maxSize: 10, ttlMs: 60000 });

    const stats = cache.stats();
    assert.equal(stats.hits, 0);
    assert.equal(stats.misses, 0);
    assert.equal(stats.hitRate, 0);
});

test('expired entries count as misses', async () => {
    const cache = new ResultCache({ maxSize: 10, ttlMs: 50 });

    const call: ToolCall = { name: 'test', arguments: {} };
    const result: ToolResult = { name: 'test', result: 'data' };

    cache.set(call, result);
    cache.get(call); // Hit

    // Wait for expiration
    await new Promise(resolve => setTimeout(resolve, 60));

    cache.get(call); // Miss (expired)

    const stats = cache.stats();
    assert.equal(stats.hits, 1);
    assert.equal(stats.misses, 1);
});

test('cache.set removes existing fuzzy-matched entry to prevent duplicates', () => {
    const cache = new ResultCache({ maxSize: 10, ttlMs: 60000 });

    const call1: ToolCall = {
        name: 'query-logs',
        arguments: {
            start: '2025-01-01T10:00:15.000Z',
            end: '2025-01-01T10:30:00.000Z',
        },
    };
    cache.set(call1, { name: 'query-logs', result: 'first' });

    const call2: ToolCall = {
        name: 'query-logs',
        arguments: {
            start: '2025-01-01T10:00:45.000Z', // +30s
            end: '2025-01-01T10:30:00.000Z',
        },
    };
    cache.set(call2, { name: 'query-logs', result: 'second' });

    assert.equal(cache.stats().size, 1, 'Fuzzy-matched entries should replace, not accumulate');
    assert.deepEqual(cache.get(call2), { name: 'query-logs', result: 'second' });
});

test('cache.set does not remove entries with different tool names', () => {
    const cache = new ResultCache({ maxSize: 10, ttlMs: 60000 });

    cache.set(
        { name: 'query-logs', arguments: { start: '2025-01-01T10:00:00Z' } },
        { name: 'query-logs', result: 'logs' },
    );
    cache.set(
        { name: 'query-metrics', arguments: { start: '2025-01-01T10:00:00Z' } },
        { name: 'query-metrics', result: 'metrics' },
    );

    assert.equal(cache.stats().size, 2, 'Different tool names should not be deduped');
});
