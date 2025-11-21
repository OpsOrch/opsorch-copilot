import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TimelineSummarizer } from '../src/engine/timelineSummarizer.js';
import { TimelineEvent } from '../src/types.js';

test('TimelineSummarizer: detects when summarization is needed', () => {
  const summarizer = new TimelineSummarizer();
  
  const shortTimeline: TimelineEvent[] = Array.from({ length: 10 }, (_, i) => ({
    timestamp: `2024-01-01T10:${String(i).padStart(2, '0')}:00Z`,
    kind: 'notification',
    body: `Event ${i}`,
  }));
  
  const longTimeline: TimelineEvent[] = Array.from({ length: 25 }, (_, i) => ({
    timestamp: `2024-01-01T10:${String(i).padStart(2, '0')}:00Z`,
    kind: 'notification',
    body: `Event ${i}`,
  }));

  assert.equal(summarizer.needsSummarization(shortTimeline), false);
  assert.equal(summarizer.needsSummarization(longTimeline), true);
});

test('TimelineSummarizer: identifies key events', () => {
  const summarizer = new TimelineSummarizer();
  const events: TimelineEvent[] = [
    {
      timestamp: '2024-01-01T10:00:00Z',
      kind: 'incident_created',
      body: 'Incident created',
    },
    {
      timestamp: '2024-01-01T10:01:00Z',
      kind: 'notification',
      body: 'Alert sent',
    },
    {
      timestamp: '2024-01-01T10:02:00Z',
      kind: 'severity_change',
      body: 'Severity changed to SEV1',
    },
    {
      timestamp: '2024-01-01T10:03:00Z',
      kind: 'status_change',
      body: 'Status changed to investigating',
    },
  ];

  const keyEvents = summarizer.identifyKeyEvents(events);

  // Should include incident_created, severity_change, status_change
  assert.ok(keyEvents.some(e => e.kind === 'incident_created'));
  assert.ok(keyEvents.some(e => e.kind === 'severity_change'));
  assert.ok(keyEvents.some(e => e.kind === 'status_change'));
  
  // Should not include regular notification
  assert.equal(keyEvents.filter(e => e.kind === 'notification').length, 0);
});

test('TimelineSummarizer: groups similar events', () => {
  const summarizer = new TimelineSummarizer();
  const events: TimelineEvent[] = [
    {
      timestamp: '2024-01-01T10:00:00Z',
      kind: 'notification',
      body: 'Alert notification 1',
    },
    {
      timestamp: '2024-01-01T10:01:00Z',
      kind: 'notification',
      body: 'Alert notification 2',
    },
    {
      timestamp: '2024-01-01T10:02:00Z',
      kind: 'notification',
      body: 'Alert notification 3',
    },
    {
      timestamp: '2024-01-01T10:03:00Z',
      kind: 'notification',
      body: 'Alert notification 4',
    },
  ];

  const groupedEvents = summarizer.groupEvents(events);

  assert.ok(groupedEvents.length > 0);
  const notificationGroup = groupedEvents.find(g => g.type === 'notifications');
  assert.ok(notificationGroup);
  assert.equal(notificationGroup.count, 4);
});

test('TimelineSummarizer: summarizes long timeline', () => {
  const summarizer = new TimelineSummarizer();
  const events: TimelineEvent[] = [
    // Key events
    {
      timestamp: '2024-01-01T10:00:00Z',
      kind: 'incident_created',
      body: 'Incident created',
    },
    {
      timestamp: '2024-01-01T10:05:00Z',
      kind: 'severity_change',
      body: 'Severity changed to SEV1',
    },
    // Many notifications (should be grouped)
    ...Array.from({ length: 20 }, (_, i) => ({
      timestamp: `2024-01-01T10:${String(10 + i).padStart(2, '0')}:00Z`,
      kind: 'notification',
      body: `Notification ${i}`,
    })),
  ];

  const summary = summarizer.summarize(events);

  assert.equal(summary.totalEvents, 22);
  assert.ok(summary.keyEvents.length > 0);
  assert.ok(summary.groupedEvents.length > 0);
  assert.ok(summary.omittedCount >= 0);
});

test('TimelineSummarizer: formats summary for LLM', () => {
  const summarizer = new TimelineSummarizer();
  const events: TimelineEvent[] = [
    {
      timestamp: '2024-01-01T10:00:00Z',
      kind: 'incident_created',
      body: 'Incident created',
    },
    {
      timestamp: '2024-01-01T10:01:00Z',
      kind: 'severity_change',
      body: 'Severity changed to SEV1',
    },
  ];

  const summary = summarizer.summarize(events);
  const formatted = summarizer.formatSummary(summary);

  assert.ok(formatted.includes('Timeline Summary'));
  assert.ok(formatted.includes('Key Events'));
  assert.ok(formatted.includes('incident_created'));
  assert.ok(formatted.includes('severity_change'));
});

test('TimelineSummarizer: handles empty timeline', () => {
  const summarizer = new TimelineSummarizer();
  const events: TimelineEvent[] = [];

  const summary = summarizer.summarize(events);

  assert.equal(summary.totalEvents, 0);
  assert.equal(summary.keyEvents.length, 0);
  assert.equal(summary.groupedEvents.length, 0);
  assert.equal(summary.omittedCount, 0);
});

test('TimelineSummarizer: preserves first and last events', () => {
  const summarizer = new TimelineSummarizer();
  const events: TimelineEvent[] = [
    {
      timestamp: '2024-01-01T10:00:00Z',
      kind: 'routine',
      body: 'First event',
    },
    {
      timestamp: '2024-01-01T10:01:00Z',
      kind: 'routine',
      body: 'Middle event',
    },
    {
      timestamp: '2024-01-01T10:02:00Z',
      kind: 'routine',
      body: 'Last event',
    },
  ];

  const keyEvents = summarizer.identifyKeyEvents(events);

  assert.ok(keyEvents.some(e => e.body === 'First event'));
  assert.ok(keyEvents.some(e => e.body === 'Last event'));
});

test('TimelineSummarizer: respects max events limit', () => {
  const summarizer = new TimelineSummarizer();
  const events: TimelineEvent[] = Array.from({ length: 50 }, (_, i) => ({
    timestamp: `2024-01-01T10:${String(i).padStart(2, '0')}:00Z`,
    kind: 'severity_change',
    body: `Event ${i}`,
  }));

  const summary = summarizer.summarize(events, 10);

  assert.ok(summary.keyEvents.length <= 10);
});

test('TimelineSummarizer: identifies user comments as key events', () => {
  const summarizer = new TimelineSummarizer();
  const events: TimelineEvent[] = [
    {
      timestamp: '2024-01-01T10:00:00Z',
      kind: 'comment',
      body: 'User comment',
      actor: { type: 'user', name: 'John' },
    },
    {
      timestamp: '2024-01-01T10:01:00Z',
      kind: 'comment',
      body: 'Automated comment',
      actor: { type: 'bot', name: 'AutoBot' },
    },
  ];

  const keyEvents = summarizer.identifyKeyEvents(events);

  assert.ok(keyEvents.some(e => e.actor?.type === 'user'));
});
