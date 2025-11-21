import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ScopeInferenceEngine } from '../src/engine/scopeInferenceEngine.js';
import { ToolResult, ToolCall, ScopeInference } from '../src/types.js';

test('ScopeInferenceEngine: infers service from incident results', () => {
  const engine = new ScopeInferenceEngine();
  const results: ToolResult[] = [
    {
      name: 'query-incidents',
      result: {
        incidents: [
          { id: 'INC-1', service: 'payment-service', severity: 'sev1' },
        ],
      },
      arguments: {},
    },
  ];

  const inference = engine.inferScope('show me logs', results);

  assert.ok(inference);
  assert.equal(inference.scope.service, 'payment-service');
  assert.equal(inference.source, 'incident');
  assert.ok(inference.confidence > 0.7);
});

test('ScopeInferenceEngine: infers environment from question', () => {
  const engine = new ScopeInferenceEngine();
  const results: ToolResult[] = [];

  const inference = engine.inferScope('show me production logs', results);

  assert.ok(inference);
  assert.equal(inference.scope.environment, 'production');
  assert.equal(inference.source, 'question');
});

test('ScopeInferenceEngine: infers region from question', () => {
  const engine = new ScopeInferenceEngine();
  const results: ToolResult[] = [];

  const inference = engine.inferScope('check metrics in us-east-1', results);

  assert.ok(inference);
  assert.equal(inference.scope.region, 'us-east-1');
  assert.equal(inference.source, 'question');
  assert.ok(inference.confidence > 0.8);
});

test('ScopeInferenceEngine: applies scope to query-logs', () => {
  const engine = new ScopeInferenceEngine();
  const calls: ToolCall[] = [
    {
      name: 'query-logs',
      arguments: { query: 'error' },
    },
  ];

  const inference = {
    scope: { service: 'api-service' },
    confidence: 0.8,
    source: 'incident' as const,
    reason: 'test',
  };

  const updated = engine.applyScope(calls, inference);

  assert.equal(updated.length, 1);
  assert.equal((updated[0].arguments as any).scope.service, 'api-service');
});

test('ScopeInferenceEngine: applies scope to query-metrics', () => {
  const engine = new ScopeInferenceEngine();
  const calls: ToolCall[] = [
    {
      name: 'query-metrics',
      arguments: { expression: 'cpu_usage' },
    },
  ];

  const inference = {
    scope: { service: 'db-service', environment: 'production' },
    confidence: 0.8,
    source: 'incident' as const,
    reason: 'test',
  };

  const updated = engine.applyScope(calls, inference);

  assert.equal(updated.length, 1);
  assert.equal((updated[0].arguments as any).scope.service, 'db-service');
  assert.equal((updated[0].arguments as any).scope.environment, 'production');
});

test('ScopeInferenceEngine: does not apply scope to other tools', () => {
  const engine = new ScopeInferenceEngine();
  const calls: ToolCall[] = [
    {
      name: 'query-incidents',
      arguments: { limit: 10 },
    },
  ];

  const inference = {
    scope: { service: 'api-service' },
    confidence: 0.8,
    source: 'incident' as const,
    reason: 'test',
  };

  const updated = engine.applyScope(calls, inference);

  assert.equal(updated.length, 1);
  assert.equal((updated[0].arguments as any).scope, undefined);
});

test('ScopeInferenceEngine: preserves explicit scope', () => {
  const engine = new ScopeInferenceEngine();
  const calls: ToolCall[] = [
    {
      name: 'query-logs',
      arguments: {
        query: 'error',
        scope: { service: 'explicit-service' },
      },
    },
  ];

  const inference = {
    scope: { service: 'inferred-service' },
    confidence: 0.8,
    source: 'incident' as const,
    reason: 'test',
  };

  const updated = engine.applyScope(calls, inference);

  assert.equal(updated.length, 1);
  assert.equal((updated[0].arguments as any).scope.service, 'explicit-service');
});

test('ScopeInferenceEngine: detects explicit scope correctly', () => {
  const engine = new ScopeInferenceEngine();

  const withScope: ToolCall = {
    name: 'query-logs',
    arguments: { scope: { service: 'test' } },
  };

  const withoutScope: ToolCall = {
    name: 'query-logs',
    arguments: { query: 'error' },
  };

  assert.equal(engine.hasExplicitScope(withScope), true);
  assert.equal(engine.hasExplicitScope(withoutScope), false);
});

test('ScopeInferenceEngine: infers from previous query scope', () => {
  const engine = new ScopeInferenceEngine();
  const results: ToolResult[] = [
    {
      name: 'query-logs',
      result: { logs: [] },
      arguments: {
        scope: { service: 'previous-service', environment: 'staging' },
      },
    },
  ];

  const inference = engine.inferScope('show me more', results);

  assert.ok(inference);
  assert.equal(inference.scope.service, 'previous-service');
  assert.equal(inference.scope.environment, 'staging');
  assert.equal(inference.source, 'previous_query');
});

test('ScopeInferenceEngine: returns null when no scope can be inferred', () => {
  const engine = new ScopeInferenceEngine();
  const results: ToolResult[] = [];

  const inference = engine.inferScope('hello', results);

  assert.equal(inference, null);
});

test('ScopeInferenceEngine: prioritizes incident scope over question', () => {
  const engine = new ScopeInferenceEngine();
  const results: ToolResult[] = [
    {
      name: 'query-incidents',
      result: {
        incidents: [
          { id: 'INC-1', service: 'incident-service' },
        ],
      },
      arguments: {},
    },
  ];

  const inference = engine.inferScope('show me production logs', results);

  assert.ok(inference);
  // Incident scope should be inferred first (higher priority)
  assert.equal(inference.scope.service, 'incident-service');
  assert.equal(inference.source, 'incident');
});

test('ScopeInferenceEngine: handles various environment keywords', () => {
  const engine = new ScopeInferenceEngine();

  const testCases = [
    { question: 'check prod logs', expected: 'production' },
    { question: 'staging metrics', expected: 'staging' },
    { question: 'dev environment', expected: 'development' },
    { question: 'qa tests', expected: 'qa' },
  ];

  for (const { question, expected } of testCases) {
    const inference = engine.inferScope(question, []);
    assert.ok(inference, `Failed for: ${question}`);
    assert.equal(inference.scope.environment, expected);
  }
});

test('ScopeInferenceEngine: merges inferred scope with existing partial scope', () => {
  const engine = new ScopeInferenceEngine();
  const calls: ToolCall[] = [
    {
      name: 'query-logs',
      arguments: {
        query: 'error',
        scope: { environment: 'production' },
      },
    },
  ];

  const inference = {
    scope: { service: 'api-service' },
    confidence: 0.8,
    source: 'incident' as const,
    reason: 'test',
  };

  const updated = engine.applyScope(calls, inference);

  assert.equal(updated.length, 1);
  const scope = (updated[0].arguments as any).scope;
  assert.equal(scope.service, 'api-service');
  assert.equal(scope.environment, 'production');
});

test('ScopeInferenceEngine: extracts service from incident timeline', () => {
  const engine = new ScopeInferenceEngine();
  const results: ToolResult[] = [
    {
      name: 'get-incident-timeline',
      result: {
        service: 'timeline-service',
        events: [],
      },
      arguments: { id: 'INC-1' },
    },
  ];

  const inference = engine.inferScope('show logs', results);

  assert.ok(inference);
  assert.equal(inference.scope.service, 'timeline-service');
  assert.equal(inference.source, 'incident');
});
