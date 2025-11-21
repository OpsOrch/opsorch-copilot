import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TimeWindowExpander } from '../src/engine/timeWindowExpander.js';
import { ToolResult } from '../src/types.js';

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
