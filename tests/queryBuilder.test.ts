import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
    buildLogQuery,
    buildMetricsExpression,
    getDefaultTimeWindow,
    parseTimeWindow
} from '../src/engine/queryBuilder.js';
import type { ConversationContext } from '../src/engine/intentClassifier.js';

// Helper to create context
const makeContext = (overrides: Partial<ConversationContext> = {}): ConversationContext => ({
    lastToolsUsed: [],
    lastToolArgs: [],
    turnNumber: 0,
    isFollowUp: false,
    ...overrides,
});

// buildLogQuery tests

test('buildLogQuery extracts error codes', () => {
    const query = buildLogQuery('show me 500 errors', makeContext());
    assert.ok(query.includes('500'));
});

test('buildLogQuery extracts 5xx pattern', () => {
    const query = buildLogQuery('show me 5xx errors', makeContext());
    assert.ok(query.includes('5x'));
});

test('buildLogQuery extracts 404 errors', () => {
    const query = buildLogQuery('show me 404 errors', makeContext());
    assert.ok(query.includes('404'));
});

test('buildLogQuery extracts error keywords', () => {
    const query = buildLogQuery('show me timeout exceptions', makeContext());
    assert.ok(query.includes('timeout'));
    assert.ok(query.includes('exception'));
});

test('buildLogQuery handles "disconnect" keyword', () => {
    const query = buildLogQuery('websocket disconnect errors', makeContext());
    assert.ok(query.includes('disconnect'));
    assert.ok(query.includes('websocket'));
    assert.ok(query.includes('error'));
});

test('buildLogQuery defaults to "error OR exception"', () => {
    const query = buildLogQuery('show me logs', makeContext());
    assert.equal(query, 'error OR exception');
});

test('buildLogQuery uses incident context when no patterns found', () => {
    const context = makeContext({ lastIncident: 'inc-123' });
    const query = buildLogQuery('show me logs', context);
    assert.ok(query.includes('error') || query.includes('exception'));
});

test('buildLogQuery deduplicates keywords', () => {
    const query = buildLogQuery('error error error', makeContext());
    const errorCount = (query.match(/error/g) || []).length;
    assert.equal(errorCount, 1);
});

// buildMetricsExpression tests

test('buildMetricsExpression detects latency', () => {
    assert.equal(buildMetricsExpression('show me latency', makeContext()), 'latency_p95');
});

test('buildMetricsExpression detects p95', () => {
    assert.equal(buildMetricsExpression('what is the p95', makeContext()), 'latency_p95');
});

test('buildMetricsExpression detects p99', () => {
    assert.equal(buildMetricsExpression('check p99 latency', makeContext()), 'latency_p95');
});

test('buildMetricsExpression detects error rate', () => {
    assert.equal(buildMetricsExpression('show me error rate', makeContext()), 'error_rate');
});

test('buildMetricsExpression detects failures', () => {
    assert.equal(buildMetricsExpression('show me failures', makeContext()), 'error_rate');
});

test('buildMetricsExpression detects CPU', () => {
    assert.equal(buildMetricsExpression('show me cpu usage', makeContext()), 'cpu_usage');
});

test('buildMetricsExpression detects memory', () => {
    assert.equal(buildMetricsExpression('show me memory', makeContext()), 'memory_usage');
});

test('buildMetricsExpression detects throughput', () => {
    assert.equal(buildMetricsExpression('show me throughput', makeContext()), 'request_rate');
});

test('buildMetricsExpression detects QPS', () => {
    assert.equal(buildMetricsExpression('what is the qps', makeContext()), 'request_rate');
});

test('buildMetricsExpression defaults to latency_p95', () => {
    assert.equal(buildMetricsExpression('show me metrics', makeContext()), 'latency_p95');
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
