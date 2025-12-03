import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inferPlanFromQuestion } from '../src/engine/planFallback.js';

test('inferPlanFromQuestion injects query-alerts when alert keywords present', () => {
  const plan = inferPlanFromQuestion('show the latest alerts for this service');
  const alertCall = plan.find((call) => call.name === 'query-alerts');
  assert.ok(alertCall, 'expected query-alerts to be present');
  assert.equal(alertCall?.arguments?.limit, 5);
});
