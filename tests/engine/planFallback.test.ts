import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inferPlanFromQuestion } from '../../src/engine/planFallback.js';

test('inferPlanFromQuestion injects query-alerts when alert keywords present', () => {
  const plan = inferPlanFromQuestion('show the latest alerts for this service');
  const alertCall = plan.find((call) => call.name === 'query-alerts');
  assert.ok(alertCall, 'expected query-alerts to be present');
  assert.equal(alertCall?.arguments?.limit, 5);
  // MCP alertQuerySchema: scope is object
  const args = alertCall?.arguments as unknown as { scope: { service: string }, limit: number };
  assert.ok(args.scope);
  assert.equal(args.scope.service, '{{service}}');
});

test('inferPlanFromQuestion injects query-logs with expression', () => {
  const plan = inferPlanFromQuestion('check logs for errors');
  const logCall = plan.find((call) => call.name === 'query-logs');
  assert.ok(logCall);
  const args = logCall?.arguments as unknown as { expression: { search: string } };
  // MCP logQuerySchema: expression object
  assert.ok(args.expression);
  assert.equal(args.expression.search, 'error OR 500');
});

test('inferPlanFromQuestion injects query-metrics with expression object', () => {
  const plan = inferPlanFromQuestion('show cpu metrics');
  const metricCall = plan.find((call) => call.name === 'query-metrics');
  assert.ok(metricCall);
  const args = metricCall?.arguments as unknown as { expression: { metricName: string } };
  // MCP metricQuerySchema: expression object
  assert.ok(args.expression);
  assert.equal(args.expression.metricName, 'latency_p95');
});
