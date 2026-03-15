import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ScopeInferer } from '../../src/engine/scopeInferer.js';
import { ToolResult, JsonObject } from '../../src/types.js';

// TODO: Update these tests to work with the new capability-based ScopeInferer
// For now, skipping most tests to allow compilation

test('ScopeInferer: infers service from incident results', async () => {
  const inferer = new ScopeInferer();

  const results: ToolResult[] = [
    {
      name: 'query-incidents',
      result: {
        incidents: [
          { id: 'INC-123', service: 'payment-api', status: 'open' }
        ]
      }
    }
  ];

  const inference = await inferer.inferScope('what happened?', results);

  assert.ok(inference);
  assert.equal(inference.scope.service, 'payment-api');
  assert.equal(inference.confidence, 0.85); // Incident based confidence
  assert.equal(inference.source, 'incident');
});

test('ScopeInferer: infers service from incident timeline', async () => {
  const inferer = new ScopeInferer();

  const results: ToolResult[] = [
    {
      name: 'get-incident-timeline',
      result: {
        id: 'INC-456',
        service: 'checkout-service',
        events: []
      }
    }
  ];

  const inference = await inferer.inferScope('show timeline', results);

  assert.ok(inference);
  assert.equal(inference.scope.service, 'checkout-service');
  assert.equal(inference.source, 'previous_query');
});

test('ScopeInferer: infers environment from question', async () => {
  const inferer = new ScopeInferer();

  const inference = await inferer.inferScope('show logs in production', []);

  assert.ok(inference);
  assert.equal(inference.scope.environment, 'production');
  assert.equal(inference.confidence, 0.6);
  assert.equal(inference.source, 'question');
});

test('ScopeInferer: infers team from question', async () => {
  const inferer = new ScopeInferer();

  const inference = await inferer.inferScope('check metrics for the platform team', []);

  assert.ok(inference);
  assert.equal(inference.scope.team, 'platform');
  assert.equal(inference.confidence, 0.6);
  assert.equal(inference.source, 'question');
});

test('ScopeInferer: applies scope to query-logs', () => {
  const inferer = new ScopeInferer();

  const calls = [
    {
      name: 'query-logs',
      arguments: { expression: { search: 'error' } }
    }
  ];

  const inference = {
    scope: { service: 'payment-api' },
    confidence: 0.8,
    source: 'incident' as const,
    reason: 'test'
  };

  const updated = inferer.applyScope(calls, inference);

  assert.ok(updated[0].arguments);
  assert.ok(updated[0].arguments.scope);
  assert.equal(((updated[0].arguments as JsonObject).scope as JsonObject).service, 'payment-api');
});

test('ScopeInferer: applies scope to query-metrics', () => {
  const inferer = new ScopeInferer();

  const calls = [
    {
      name: 'query-metrics',
      arguments: { expression: { metricName: 'latency_p95' } }
    }
  ];

  const inference = {
    scope: { service: 'checkout-api', environment: 'production' },
    confidence: 0.8,
    source: 'incident' as const,
    reason: 'test'
  };

  const updated = inferer.applyScope(calls, inference);

  assert.ok(updated[0].arguments);
  assert.ok(updated[0].arguments.scope);
  assert.equal(((updated[0].arguments as JsonObject).scope as JsonObject).service, 'checkout-api');
  assert.equal(((updated[0].arguments as JsonObject).scope as JsonObject).environment, 'production');
});

test('ScopeInferer: does not apply scope to other tools', () => {
  const inferer = new ScopeInferer();

  const calls = [
    {
      name: 'query-tickets',
      arguments: { limit: 10 }
    }
  ];

  const inference = {
    scope: { service: 'payment-api' },
    confidence: 0.8,
    source: 'incident' as const,
    reason: 'test'
  };

  const updated = inferer.applyScope(calls, inference);

  // Should not modify the call
  assert.deepEqual(updated[0], calls[0]);
});

test('ScopeInferer: preserves explicit scope', () => {
  const inferer = new ScopeInferer();

  const calls = [
    {
      name: 'query-logs',
      arguments: {
        expression: { search: 'error' },
        scope: { service: 'explicit-service' }
      }
    }
  ];

  const inference = {
    scope: { service: 'inferred-service' },
    confidence: 0.8,
    source: 'incident' as const,
    reason: 'test'
  };

  const updated = inferer.applyScope(calls, inference);

  // Should keep explicit service
  assert.ok(updated[0].arguments);
  assert.ok(updated[0].arguments.scope);
  assert.equal(((updated[0].arguments as JsonObject).scope as JsonObject).service, 'explicit-service');
});

test('ScopeInferer: detects explicit scope correctly', () => {
  const inferer = new ScopeInferer();

  const callWithScope = {
    name: 'query-logs',
    arguments: {
      expression: { search: 'error' },
      scope: { service: 'test-service' }
    }
  };

  const callWithoutScope = {
    name: 'query-logs',
    arguments: { expression: { search: 'error' } }
  };

  assert.ok(inferer.hasExplicitScope(callWithScope));
  assert.ok(!inferer.hasExplicitScope(callWithoutScope));
});

test('ScopeInferer: infers from previous query scope', async () => {
  const inferer = new ScopeInferer();

  const results: ToolResult[] = [
    {
      name: 'query-logs',
      arguments: {
        expression: { search: 'error' },
        scope: { service: 'payment-api', environment: 'staging' }
      },
      result: { logs: [] }
    }
  ];

  const inference = await inferer.inferScope('show more', results);

  assert.ok(inference);
  assert.equal(inference.scope.service, 'payment-api');
  assert.equal(inference.scope.environment, 'staging');
  assert.equal(inference.source, 'previous_query');
});

test('ScopeInferer: returns null when no scope can be inferred', async () => {
  const inferer = new ScopeInferer();

  const inference = await inferer.inferScope('hello world', []);

  assert.equal(inference, null);
});

test('ScopeInferer: prioritizes incident scope over question', async () => {
  const inferer = new ScopeInferer();

  const results: ToolResult[] = [
    {
      name: 'query-incidents',
      result: {
        incidents: [
          { id: 'INC-789', service: 'incident-service' }
        ]
      }
    }
  ];

  // Question mentions production, but incident has service
  const inference = await inferer.inferScope('show logs in production', results);

  assert.ok(inference);
  // Should use incident service, not question environment
  assert.equal(inference.scope.service, 'incident-service');
  assert.equal(inference.source, 'incident');
});

test('ScopeInferer: handles various environment keywords', async () => {
  const inferer = new ScopeInferer();

  const tests = [
    { question: 'check staging', expected: 'staging' },
    { question: 'in dev environment', expected: 'development' },
    { question: 'qa logs', expected: 'qa' },
    { question: 'prod metrics', expected: 'production' }
  ];

  for (const { question, expected } of tests) {
    const inference = await inferer.inferScope(question, []);
    assert.ok(inference, `Should infer from: ${question}`);
    assert.equal(inference.scope.environment, expected);
  }
});

test('ScopeInferer: merges inferred scope with existing partial scope', () => {
  const inferer = new ScopeInferer();

  const calls = [
    {
      name: 'query-logs',
      arguments: {
        expression: { search: 'error' },
        scope: { environment: 'production' }
      }
    }
  ];

  const inference = {
    scope: { service: 'payment-api' },
    confidence: 0.8,
    source: 'incident' as const,
    reason: 'test'
  };

  const updated = inferer.applyScope(calls, inference);

  // Should merge both
  assert.ok(updated[0].arguments);
  assert.ok(updated[0].arguments.scope);
  assert.equal(((updated[0].arguments as JsonObject).scope as JsonObject).service, 'payment-api');
  assert.equal(((updated[0].arguments as JsonObject).scope as JsonObject).environment, 'production');
});

test('ScopeInferer: extracts service from metric query arguments', async () => {
  const inferer = new ScopeInferer();

  const results: ToolResult[] = [
    {
      name: 'query-metrics',
      arguments: {
        expression: { metricName: 'latency_p95' },
        service: 'api-gateway'
      },
      result: { series: [] }
    }
  ];

  const inference = await inferer.inferScope('show more metrics', results);

  assert.ok(inference);
  assert.equal(inference.scope.service, 'api-gateway');
  assert.equal(inference.source, 'previous_query');
});

test('ScopeInferer: detects multiple team references', async () => {
  const inferer = new ScopeInferer();
  const teams = ['platform', 'core-infra', 'payments', 'sre'];

  for (const team of teams) {
    const question = `get incidents for the ${team} team`;
    const inference = await inferer.inferScope(question, []);

    assert.ok(inference, `Should detect team: ${team}`);
    assert.equal(inference.scope.team, team);
    assert.equal(inference.confidence, 0.6);
    assert.equal(inference.source, 'question');
  }
});

test('ScopeInferer: applyScope only matches exact query tool names', () => {
  const inferer = new ScopeInferer();
  const inference = {
    scope: { service: 'payment-api' },
    confidence: 0.8,
    source: 'incident' as const,
    reason: 'test',
  };

  const calls = [
    { name: 'query-logs', arguments: {} },
    { name: 'query-metrics', arguments: {} },
    { name: 'query-incidents', arguments: {} },
    { name: 'query-alerts', arguments: {} },
    { name: 'get-incident', arguments: {} },
    { name: 'get-incident-timeline', arguments: {} },
    { name: 'query-tickets', arguments: {} },
    { name: 'get-service', arguments: {} },
  ];

  const updated = inferer.applyScope(calls, inference);

  // First 4 should have scope injected
  for (const call of updated.slice(0, 4)) {
    const scope = (call.arguments as JsonObject)?.scope as JsonObject | undefined;
    assert.equal(scope?.service, 'payment-api', `${call.name} should get scope`);
  }

  // Last 4 should NOT have scope injected
  for (const call of updated.slice(4)) {
    const scope = (call.arguments as JsonObject)?.scope as JsonObject | undefined;
    assert.equal(scope, undefined, `${call.name} should NOT get scope`);
  }
});

test('ScopeInferer: does not narrow scope when result items have different services', () => {
  const inferer = new ScopeInferer();

  const calls = [{ name: 'query-logs', arguments: {} }];

  // When inferFromResults returns no service (multi-service), applyScope should not inject one
  const noServiceInference = {
    scope: {} as { service?: string },
    confidence: 0.75,
    source: 'previous_query' as const,
    reason: 'test',
  };

  const updated = inferer.applyScope(calls, noServiceInference);
  const scope = (updated[0].arguments as JsonObject)?.scope as JsonObject | undefined;
  assert.equal(scope, undefined, 'No scope should be applied when no service was inferred');
});

test('ScopeInferer: infers scope when all log items share same service', async () => {
  const inferer = new ScopeInferer();

  const results: ToolResult[] = [
    {
      name: 'query-logs',
      result: {
        logs: [
          { id: 'log-1', service: 'payment-api' },
          { id: 'log-2', service: 'payment-api' },
        ],
      },
    },
  ];

  const inference = await inferer.inferScope('what happened?', results);

  assert.ok(inference, 'Should infer scope when all items share the same service');
  assert.equal(inference.scope.service, 'payment-api');
});

test('ScopeInferer: does not narrow multi-service log results', async () => {
  const inferer = new ScopeInferer();

  const results: ToolResult[] = [
    {
      name: 'query-logs',
      result: {
        logs: [
          { id: 'log-1', service: 'api-gateway' },
          { id: 'log-2', service: 'auth-service' },
        ],
      },
    },
  ];

  const inference = await inferer.inferScope('show me logs', results);

  if (inference?.scope.service) {
    assert.ok(
      inference.scope.service !== 'api-gateway' && inference.scope.service !== 'auth-service',
      `Should not pick one service from multi-service results, got: ${inference.scope.service}`,
    );
  }
});

