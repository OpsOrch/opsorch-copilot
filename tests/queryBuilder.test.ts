import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
    QueryBuilder,
    getDefaultTimeWindow,
    parseTimeWindow
} from '../src/engine/queryBuilder.js';
import { DomainRegistry } from '../src/engine/domainRegistry.js';
import { logDomain } from '../src/engine/domains/log.js';
import { metricDomain } from '../src/engine/domains/metric.js';
import { incidentDomain } from '../src/engine/domains/incident.js';
import type { IntentContext } from '../src/types.js';

// Helper to create context
const makeContext = (overrides: Partial<IntentContext> = {}): IntentContext => ({
    lastToolsUsed: [],
    lastToolArgs: [],
    turnNumber: 0,
    isFollowUp: false,
    ...overrides,
});

// Helper to create registry with domains
const makeRegistry = (): DomainRegistry => {
    const registry = new DomainRegistry();
    registry.register(logDomain);
    registry.register(metricDomain);
    registry.register(incidentDomain);
    return registry;
};

// QueryBuilder.buildQuery tests for log domain

test('QueryBuilder.buildQuery extracts error codes for log domain', () => {
    const builder = new QueryBuilder(makeRegistry());
    const query = builder.buildQuery('log', 'show me 500 errors', makeContext());
    assert.ok(typeof query === 'string' && query.includes('500'));
});

test('QueryBuilder.buildQuery extracts 5xx pattern for log domain', () => {
    const builder = new QueryBuilder(makeRegistry());
    const query = builder.buildQuery('log', 'show me 5xx errors', makeContext());
    assert.ok(typeof query === 'string' && query.includes('5x'));
});

test('QueryBuilder.buildQuery extracts 404 errors for log domain', () => {
    const builder = new QueryBuilder(makeRegistry());
    const query = builder.buildQuery('log', 'show me 404 errors', makeContext());
    assert.ok(typeof query === 'string' && query.includes('404'));
});

test('QueryBuilder.buildQuery extracts error keywords for log domain', () => {
    const builder = new QueryBuilder(makeRegistry());
    const query = builder.buildQuery('log', 'show me timeout exceptions', makeContext());
    assert.ok(typeof query === 'string' && query.includes('timeout'));
    assert.ok(typeof query === 'string' && query.includes('exception'));
});

test('QueryBuilder.buildQuery handles priority terms from domain config', () => {
    const builder = new QueryBuilder(makeRegistry());
    const query = builder.buildQuery('log', 'websocket disconnect errors', makeContext());
    assert.ok(typeof query === 'string' && query.includes('disconnect'));
    assert.ok(typeof query === 'string' && query.includes('websocket'));
});

test('QueryBuilder.buildQuery defaults to configured default query', () => {
    const builder = new QueryBuilder(makeRegistry());
    const query = builder.buildQuery('log', 'show me logs', makeContext());
    assert.equal(query, 'error OR exception');
});

test('QueryBuilder.buildQuery uses incident context when no patterns found', () => {
    const builder = new QueryBuilder(makeRegistry());
    const context = makeContext({ recentEntities: { incident: 'inc-123' } });
    const query = builder.buildQuery('log', 'show me logs', context);
    assert.ok(typeof query === 'string' && (query.includes('error') || query.includes('exception')));
});

test('QueryBuilder.buildQuery deduplicates keywords', () => {
    const builder = new QueryBuilder(makeRegistry());
    const query = builder.buildQuery('log', 'error error error', makeContext());
    assert.ok(typeof query === 'string');
    const errorCount = (query.match(/error/g) || []).length;
    assert.equal(errorCount, 1);
});

test('QueryBuilder.buildQuery handles missing domain gracefully', () => {
    const registry = new DomainRegistry();
    const builder = new QueryBuilder(registry);
    const query = builder.buildQuery('log', 'show me logs', makeContext());
    assert.equal(query, 'error OR exception');
});

// QueryBuilder.buildQuery tests for metric domain

test('QueryBuilder.buildQuery detects latency for metric domain', () => {
    const builder = new QueryBuilder(makeRegistry());
    assert.equal(builder.buildQuery('metric', 'show me latency', makeContext()), 'latency_p95');
});

test('QueryBuilder.buildQuery detects p95 for metric domain', () => {
    const builder = new QueryBuilder(makeRegistry());
    assert.equal(builder.buildQuery('metric', 'what is the p95', makeContext()), 'latency_p95');
});

test('QueryBuilder.buildQuery detects p99 for metric domain', () => {
    const builder = new QueryBuilder(makeRegistry());
    assert.equal(builder.buildQuery('metric', 'check p99', makeContext()), 'latency_p99');
});

test('QueryBuilder.buildQuery detects error rate for metric domain', () => {
    const builder = new QueryBuilder(makeRegistry());
    assert.equal(builder.buildQuery('metric', 'show me error rate', makeContext()), 'error_rate');
});

test('QueryBuilder.buildQuery detects CPU for metric domain', () => {
    const builder = new QueryBuilder(makeRegistry());
    assert.equal(builder.buildQuery('metric', 'show me cpu usage', makeContext()), 'cpu_usage');
});

test('QueryBuilder.buildQuery detects memory for metric domain', () => {
    const builder = new QueryBuilder(makeRegistry());
    assert.equal(builder.buildQuery('metric', 'show me memory', makeContext()), 'memory_usage');
});

test('QueryBuilder.buildQuery detects contextual metrics for metric domain', () => {
    const builder = new QueryBuilder(makeRegistry());
    assert.equal(builder.buildQuery('metric', 'show me database metrics', makeContext()), 'db_connections');
});

test('QueryBuilder.buildQuery defaults to configured default for metric domain', () => {
    const builder = new QueryBuilder(makeRegistry());
    assert.equal(builder.buildQuery('metric', 'show me metrics', makeContext()), 'latency_p95');
});

test('QueryBuilder.buildQuery handles missing metric domain gracefully', () => {
    const registry = new DomainRegistry();
    const builder = new QueryBuilder(registry);
    assert.equal(builder.buildQuery('metric', 'show me metrics', makeContext()), 'latency_p95');
});

// QueryBuilder.buildQuery tests for incident domain

test('QueryBuilder.buildQuery extracts status keywords for incident domain', () => {
    const builder = new QueryBuilder(makeRegistry());
    const query = builder.buildQuery('incident', 'show me open incidents', makeContext());
    assert.ok(typeof query === 'object');
    assert.equal((query as any).status, 'open');
});

test('QueryBuilder.buildQuery extracts active status for incident domain', () => {
    const builder = new QueryBuilder(makeRegistry());
    const query = builder.buildQuery('incident', 'show me active incidents', makeContext());
    assert.ok(typeof query === 'object');
    assert.equal((query as any).status, 'open');
});

test('QueryBuilder.buildQuery extracts closed status for incident domain', () => {
    const builder = new QueryBuilder(makeRegistry());
    const query = builder.buildQuery('incident', 'show me closed incidents', makeContext());
    assert.ok(typeof query === 'object');
    assert.equal((query as any).status, 'closed');
});

test('QueryBuilder.buildQuery extracts severity patterns for incident domain', () => {
    const builder = new QueryBuilder(makeRegistry());
    const query = builder.buildQuery('incident', 'show me sev-1 incidents', makeContext());
    assert.ok(typeof query === 'object');
    assert.equal((query as any).severity, '1');
});

test('QueryBuilder.buildQuery extracts severity without dash for incident domain', () => {
    const builder = new QueryBuilder(makeRegistry());
    const query = builder.buildQuery('incident', 'show me sev3 incidents', makeContext());
    assert.ok(typeof query === 'object');
    assert.equal((query as any).severity, '3');
});

test('QueryBuilder.buildQuery returns empty object when no patterns match for incident domain', () => {
    const builder = new QueryBuilder(makeRegistry());
    const query = builder.buildQuery('incident', 'show me incidents', makeContext());
    assert.deepEqual(query, {});
});

test('QueryBuilder.buildQuery handles missing incident domain gracefully', () => {
    const registry = new DomainRegistry();
    const builder = new QueryBuilder(registry);
    const query = builder.buildQuery('incident', 'show me incidents', makeContext());
    assert.deepEqual(query, {});
});

// parseTimeWindow tests

test('parseTimeWindow parses "last 2 hours"', () => {
    const window = parseTimeWindow('show me logs for the last 2 hours');
    assert.ok(window);
    assert.ok(window!.start);
    assert.ok(window!.end);

    const start = new Date(window!.start);
    const end = new Date(window!.end);
    const diff = end.getTime() - start.getTime();

    // Should be approximately 2 hours (allow 1 second tolerance)
    assert.ok(Math.abs(diff - 2 * 60 * 60 * 1000) < 1000);
});

test('parseTimeWindow parses "past 30 minutes"', () => {
    const window = parseTimeWindow('past 30 minutes');
    assert.ok(window);

    const start = new Date(window!.start);
    const end = new Date(window!.end);
    const diff = end.getTime() - start.getTime();

    // Should be approximately 30 minutes
    assert.ok(Math.abs(diff - 30 * 60 * 1000) < 1000);
});

test('parseTimeWindow parses "last 1 day"', () => {
    const window = parseTimeWindow('previous 1 day');
    assert.ok(window);

    const start = new Date(window!.start);
    const end = new Date(window!.end);
    const diff = end.getTime() - start.getTime();

    // Should be approximately 24 hours
    assert.ok(Math.abs(diff - 24 * 60 * 60 * 1000) < 1000);
});

test('parseTimeWindow returns undefined for no time pattern', () => {
    const window = parseTimeWindow('show me logs');
    assert.equal(window, undefined);
});

test('parseTimeWindow handles plural "hours"', () => {
    const window = parseTimeWindow('last 3 hours');
    assert.ok(window);

    const start = new Date(window!.start);
    const end = new Date(window!.end);
    const diff = end.getTime() - start.getTime();

    assert.ok(Math.abs(diff - 3 * 60 * 60 * 1000) < 1000);
});

// getDefaultTimeWindow tests

test('getDefaultTimeWindow returns 1 hour by default', () => {
    const window = getDefaultTimeWindow(makeContext());

    const start = new Date(window.start);
    const end = new Date(window.end);
    const diff = end.getTime() - start.getTime();

    // Should be approximately 1 hour
    assert.ok(Math.abs(diff - 60 * 60 * 1000) < 1000);
});

test('getDefaultTimeWindow reuses context time window', () => {
    const contextWindow = {
        start: '2024-01-01T00:00:00Z',
        end: '2024-01-01T01:00:00Z'
    };

    const context = makeContext({ lastTimeWindow: contextWindow });
    const window = getDefaultTimeWindow(context);

    assert.equal(window.start, contextWindow.start);
    assert.equal(window.end, contextWindow.end);
});

test('getDefaultTimeWindow returns valid ISO timestamps', () => {
    const window = getDefaultTimeWindow(makeContext());

    // Should be valid ISO 8601 format
    assert.ok(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/.test(window.start));
    assert.ok(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/.test(window.end));
});

test('getDefaultTimeWindow end is after start', () => {
    const window = getDefaultTimeWindow(makeContext());

    const start = new Date(window.start);
    const end = new Date(window.end);

    assert.ok(end.getTime() > start.getTime());
});
