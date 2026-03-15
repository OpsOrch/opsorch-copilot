import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CorrelationDetector } from '../src/engine/correlationDetector.js';
import { CorrelationEvent, ToolResult } from '../src/types.js';

test('CorrelationDetector: extracts events from tool results', () => {
  const detector = new CorrelationDetector();
  const results: ToolResult[] = [
    {
      name: 'query-logs',
      result: {
        entries: [
          { timestamp: '2024-01-01T10:00:00Z', message: 'error', severity: 'error' },
          { timestamp: '2024-01-01T10:00:01Z', message: 'error', severity: 'error' },
          { timestamp: '2024-01-01T10:00:02Z', message: 'error', severity: 'error' },
          { timestamp: '2024-01-01T10:00:03Z', message: 'error', severity: 'error' },
          { timestamp: '2024-01-01T10:00:04Z', message: 'error', severity: 'error' },
        ]
      },
    },
  ];

  const events = detector.extractEvents(results);

  assert.ok(events.length > 0);
  assert.equal(events[0].source, 'log');
});

test('CorrelationDetector: detects correlations between events', () => {
  const detector = new CorrelationDetector();
  const events: CorrelationEvent[] = [
    {
      timestamp: '2024-01-01T10:00:00Z',
      source: 'metric',
      type: 'metric_spike',
      value: 100,
    },
    {
      timestamp: '2024-01-01T10:01:00Z',
      source: 'log',
      type: 'error_burst',
      value: 50,
    },
  ];

  const correlations = detector.detectCorrelations(events);

  assert.ok(correlations.length > 0);
  assert.equal(correlations[0].events.length, 2);
  assert.ok(correlations[0].strength > 0.5);
});

test('CorrelationDetector: identifies root cause', () => {
  const detector = new CorrelationDetector();
  const events: CorrelationEvent[] = [
    {
      timestamp: '2024-01-01T10:00:00Z',
      source: 'metric',
      type: 'metric_spike',
    },
    {
      timestamp: '2024-01-01T10:01:00Z',
      source: 'log',
      type: 'error_burst',
    },
  ];

  const correlations = detector.detectCorrelations(events);
  const rootCause = detector.identifyRootCause(correlations);

  assert.ok(rootCause);
  assert.equal(rootCause.type, 'metric_spike'); // Earliest event
});

test('CorrelationDetector: handles empty results', () => {
  const detector = new CorrelationDetector();
  const events = detector.extractEvents([]);

  assert.equal(events.length, 0);
});

test('CorrelationDetector: sorts events by timestamp', () => {
  const detector = new CorrelationDetector();
  const results: ToolResult[] = [
    {
      name: 'get-incident-timeline',
      result: [
        { at: '2024-01-01T10:05:00Z', kind: 'severity_change' },
        { at: '2024-01-01T10:00:00Z', kind: 'status_change' },
      ],
    },
  ];

  const events = detector.extractEvents(results);

  // Should be sorted by timestamp
  if (events.length >= 2) {
    const time1 = new Date(events[0].timestamp).getTime();
    const time2 = new Date(events[1].timestamp).getTime();
    assert.ok(time1 <= time2);
  }
});
