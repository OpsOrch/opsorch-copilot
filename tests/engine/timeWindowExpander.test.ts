
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TimeWindowExpander } from '../../src/engine/timeWindowExpander.js';
import { ToolResult } from '../../src/types.js';

test('TimeWindowExpander', async (t) => {
    const expander = new TimeWindowExpander();

    await t.test('expandWindow should expand time window by factor', async () => {
        const start = '2023-01-01T10:00:00.000Z';
        const end = '2023-01-01T11:00:00.000Z'; // 1 hour duration
        const window = { start, end };

        // Factor 2 -> expand by 100% (from 1h to 2h). 
        // Should expand 30 mins each side.
        const result = expander.expandWindow(window, 2);

        const expectedStart = '2023-01-01T09:30:00.000Z';
        const expectedEnd = '2023-01-01T11:30:00.000Z';

        assert.equal(result.start, expectedStart);
        assert.equal(result.end, expectedEnd);
    });

    await t.test('expandWindow should cap at max window', async () => {
        // Max is 24h.
        // Start with 20h window. Expand by 2 -> 40h. Should be capped at 24h.
        const start = '2023-01-01T00:00:00.000Z';
        const end = '2023-01-01T20:00:00.000Z';
        const window = { start, end };

        const result = expander.expandWindow(window, 2);

        const durationMs = new Date(result.end).getTime() - new Date(result.start).getTime();
        const maxMs = 24 * 60 * 60 * 1000;

        assert.equal(durationMs, maxMs);
    });

    await t.test('expandWindowByPadding should apply padding correctly', async () => {
        // We'll mock Date.now() if needed, but here we can pass undefined start/end
        // Actually, to test deterministic, pass start/end.

        const start = '2023-01-01T10:00:00.000Z';
        const end = '2023-01-01T11:00:00.000Z';

        // Padding 15 mins
        const result = expander.expandWindowByPadding(start, end, 15);

        const expectedStart = '2023-01-01T09:45:00.000Z';
        const expectedEnd = '2023-01-01T11:15:00.000Z';

        assert.equal(result?.start, expectedStart);
        assert.equal(result?.end, expectedEnd);
    });

    await t.test('expandWindowByPadding should handle missing start/end defaults', async () => {
        // If start missing, uses end - duration.
        // If end missing, uses start + duration.
        const start = '2023-01-01T10:00:00.000Z';
        const durationMins = 60;
        const paddingMins = 0;

        const result = expander.expandWindowByPadding(start, undefined, paddingMins, durationMins);

        const expectedEnd = '2023-01-01T11:00:00.000Z';
        assert.equal(result?.start, start);
        assert.equal(result?.end, expectedEnd);
    });

    await t.test('isEmptyResult should detect empty payload structures', async () => {
        assert.ok(expander.isEmptyResult({ name: 'tool', result: [] })); // empty array
        assert.ok(expander.isEmptyResult({ name: 'tool', result: { entries: [] } })); // empty entries
        assert.ok(expander.isEmptyResult({ name: 'tool', result: { count: 0 } })); // zero count

        assert.ok(!expander.isEmptyResult({ name: 'tool', result: [{ id: 1 }] })); // non-empty array
        assert.ok(!expander.isEmptyResult({ name: 'tool', result: { count: 5 } })); // non-zero count
    });
});

test('TimeWindowExpander: detects empty array result', () => {
    const expander = new TimeWindowExpander();
    const result: ToolResult = {
        name: 'query-logs',
        result: [],
    };

    assert.equal(expander.isEmptyResult(result), true);
});

test('TimeWindowExpander: detects empty entries', () => {
    const expander = new TimeWindowExpander();
    const result: ToolResult = {
        name: 'query-logs',
        result: { entries: [] },
    };

    assert.equal(expander.isEmptyResult(result), true);
});

test('TimeWindowExpander: detects empty series', () => {
    const expander = new TimeWindowExpander();
    const result: ToolResult = {
        name: 'query-metrics',
        result: { series: [] },
    };

    assert.equal(expander.isEmptyResult(result), true);
});

test('TimeWindowExpander: detects count = 0', () => {
    const expander = new TimeWindowExpander();
    const result: ToolResult = {
        name: 'query-logs',
        result: { count: 0, entries: [] },
    };

    assert.equal(expander.isEmptyResult(result), true);
});

test('TimeWindowExpander: recognizes non-empty result', () => {
    const expander = new TimeWindowExpander();
    const result: ToolResult = {
        name: 'query-logs',
        result: { entries: [{ message: 'error' }] },
    };

    assert.equal(expander.isEmptyResult(result), false);
});

test('TimeWindowExpander: expands window by 2x', () => {
    const expander = new TimeWindowExpander();
    const window = {
        start: '2024-01-01T10:00:00Z',
        end: '2024-01-01T11:00:00Z', // 1 hour
    };

    const expanded = expander.expandWindow(window, 2);

    // Should expand by 30 minutes on each side (total 2 hours)
    const originalDuration = 60 * 60 * 1000; // 1 hour in ms
    const expandedDuration =
        new Date(expanded.end).getTime() - new Date(expanded.start).getTime();

    assert.equal(expandedDuration, originalDuration * 2);
});

test('TimeWindowExpander: caps window at 24 hours', () => {
    const expander = new TimeWindowExpander();
    const window = {
        start: '2024-01-01T00:00:00Z',
        end: '2024-01-01T12:00:00Z', // 12 hours
    };

    const expanded = expander.expandWindow(window, 3); // Would be 36 hours

    const expandedDuration =
        new Date(expanded.end).getTime() - new Date(expanded.start).getTime();
    const maxDuration = 24 * 60 * 60 * 1000; // 24 hours in ms

    assert.ok(expandedDuration <= maxDuration);
});

test('TimeWindowExpander: calculates window duration', () => {
    const expander = new TimeWindowExpander();
    const window = {
        start: '2024-01-01T10:00:00Z',
        end: '2024-01-01T13:00:00Z', // 3 hours
    };

    const duration = expander.getWindowDurationHours(window);

    assert.equal(duration, 3);
});

test('TimeWindowExpander: handles invalid window gracefully', () => {
    const expander = new TimeWindowExpander();
    const window = {
        start: 'invalid',
        end: 'invalid',
    };

    const expanded = expander.expandWindow(window);

    // Should return original window on error
    assert.deepEqual(expanded, window);
});

