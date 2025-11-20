import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyQuestionHeuristics } from '../src/engine/questionHeuristics.js';
import { ToolCall } from '../src/types.js';

// Helper to check if tool exists
const makeHasTool = (tools: string[]) => (name: string) => tools.includes(name);

test('applyQuestionHeuristics returns empty when no heuristics match', () => {
    const question = 'what is the weather';
    const calls: ToolCall[] = [];
    const hasTool = makeHasTool([]);

    const result = applyQuestionHeuristics(question, calls, hasTool);
    assert.deepEqual(result, []);
});

test('applyQuestionHeuristics keeps existing calls', () => {
    const question = 'generic question';
    const calls: ToolCall[] = [{ name: 'existing-tool', arguments: {} }];
    const hasTool = makeHasTool([]);

    const result = applyQuestionHeuristics(question, calls, hasTool);
    assert.equal(result.length, 1);
    assert.equal(result[0].name, 'existing-tool');
});

test('applyQuestionHeuristics injects incident query for "incident" mentions', () => {
    const question = 'show me recent incidents';
    const calls: ToolCall[] = [];
    const hasTool = makeHasTool(['query-incidents']);

    const result = applyQuestionHeuristics(question, calls, hasTool);
    assert.ok(result.some(c => c.name === 'query-incidents'));
    const incidentCall = result.find(c => c.name === 'query-incidents');
    assert.ok(incidentCall?.arguments);
});

test('applyQuestionHeuristics uses limit=1 for "latest" incident', () => {
    const question = 'show me the latest incident';
    const calls: ToolCall[] = [];
    const hasTool = makeHasTool(['query-incidents']);

    const result = applyQuestionHeuristics(question, calls, hasTool);
    const incidentCall = result.find(c => c.name === 'query-incidents');
    assert.equal((incidentCall?.arguments as any)?.limit, 1);
});

test('applyQuestionHeuristics extracts severity filter', () => {
    const question = 'show sev1 incidents';
    const calls: ToolCall[] = [];
    const hasTool = makeHasTool(['query-incidents']);

    const result = applyQuestionHeuristics(question, calls, hasTool);
    const incidentCall = result.find(c => c.name === 'query-incidents');
    assert.deepEqual((incidentCall?.arguments as any)?.severities, ['sev1']);
});

test('applyQuestionHeuristics injects logs for "error" mentions', () => {
    const question = 'show me error logs';
    const calls: ToolCall[] = [];
    const hasTool = makeHasTool(['query-logs']);

    const result = applyQuestionHeuristics(question, calls, hasTool);
    assert.ok(result.some(c => c.name === 'query-logs'));
    const logCall = result.find(c => c.name === 'query-logs');
    assert.ok((logCall?.arguments as any)?.query);
    assert.ok((logCall?.arguments as any)?.start);
    assert.ok((logCall?.arguments as any)?.end);
});

test('applyQuestionHeuristics uses error code in query', () => {
    const question = 'show me 500 errors';
    const calls: ToolCall[] = [];
    const hasTool = makeHasTool(['query-logs']);

    const result = applyQuestionHeuristics(question, calls, hasTool);
    const logCall = result.find(c => c.name === 'query-logs');
    const query = (logCall?.arguments as any)?.query;
    assert.ok(query?.includes('500'));
});

test('applyQuestionHeuristics injects metrics for "latency" mentions', () => {
    const question = 'show me latency metrics';
    const calls: ToolCall[] = [];
    const hasTool = makeHasTool(['query-metrics']);

    const result = applyQuestionHeuristics(question, calls, hasTool);
    assert.ok(result.some(c => c.name === 'query-metrics'));
    const metricCall = result.find(c => c.name === 'query-metrics');
    const expression = (metricCall?.arguments as any)?.expression;
    assert.ok(expression?.includes('latency_p95'));
});

test('applyQuestionHeuristics injects metrics for "cpu" mentions', () => {
    const question = 'show me cpu usage';
    const calls: ToolCall[] = [];
    const hasTool = makeHasTool(['query-metrics']);

    const result = applyQuestionHeuristics(question, calls, hasTool);
    const metricCall = result.find(c => c.name === 'query-metrics');
    const expression = (metricCall?.arguments as any)?.expression;
    assert.ok(expression?.includes('cpu_usage'));
});

test('applyQuestionHeuristics respects existing incident calls', () => {
    const question = 'show incidents';
    const existingCall: ToolCall = { name: 'query-incidents', arguments: { limit: 5 } };
    const calls: ToolCall[] = [existingCall];
    const hasTool = makeHasTool(['query-incidents']);

    const result = applyQuestionHeuristics(question, calls, hasTool);
    // Should not inject another incident call
    const incidentCalls = result.filter(c => c.name === 'query-incidents');
    assert.equal(incidentCalls.length, 1);
});

test('applyQuestionHeuristics skips when tool not available', () => {
    const question = 'show me incidents and logs';
    const calls: ToolCall[] = [];
    const hasTool = makeHasTool([]); // No tools available

    const result = applyQuestionHeuristics(question, calls, hasTool);
    assert.deepEqual(result, []);
});

test('applyQuestionHeuristics combines multiple heuristics', () => {
    const question = 'show logs and metrics for errors';
    const calls: ToolCall[] = [];
    const hasTool = makeHasTool(['query-logs', 'query-metrics']);

    const result = applyQuestionHeuristics(question, calls, hasTool);
    assert.ok(result.some(c => c.name === 'query-logs'));
    assert.ok(result.some(c => c.name === 'query-metrics'));
});

test('applyQuestionHeuristics prioritizes incidents when injected', () => {
    const question = 'show sev1 incidents';
    const existingCall: ToolCall = { name: 'query-services', arguments: {} };
    const calls: ToolCall[] = [existingCall];
    const hasTool = makeHasTool(['query-incidents', 'query-services']);

    const result = applyQuestionHeuristics(question, calls, hasTool);
    // When incidents are injected, they should be prioritized (come first)
    assert.ok(result.some(c => c.name === 'query-incidents'), 'Should inject incident call');
    assert.equal(result[0].name, 'query-incidents', 'Incident should be first');
});

test('applyQuestionHeuristics handles 5xx error pattern', () => {
    const question = 'show 5xx errors';
    const calls: ToolCall[] = [];
    const hasTool = makeHasTool(['query-logs']);

    const result = applyQuestionHeuristics(question, calls, hasTool);
    assert.ok(result.some(c => c.name === 'query-logs'));
});

test('applyQuestionHeuristics provides default time window', () => {
    const question = 'show logs';
    const calls: ToolCall[] = [];
    const hasTool = makeHasTool(['query-logs']);

    const result = applyQuestionHeuristics(question, calls, hasTool);
    const logCall = result.find(c => c.name === 'query-logs');

    // Should have ISO timestamps
    assert.ok((logCall?.arguments as any)?.start);
    assert.ok((logCall?.arguments as any)?.end);
    const start = new Date((logCall?.arguments as any).start);
    const end = new Date((logCall?.arguments as any).end);
    assert.ok(end.getTime() > start.getTime());
});

test('applyQuestionHeuristics parses dynamic time windows', () => {
    const question = 'show logs for last 2 hours';
    const calls: ToolCall[] = [];
    const hasTool = makeHasTool(['query-logs']);

    const result = applyQuestionHeuristics(question, calls, hasTool);
    const logCall = result.find(c => c.name === 'query-logs');
    const start = new Date((logCall?.arguments as any).start);
    const end = new Date((logCall?.arguments as any).end);

    // 2 hours = 7200000 ms
    const diff = end.getTime() - start.getTime();
    // Allow small delta for execution time
    assert.ok(Math.abs(diff - 7200000) < 1000, `Expected ~2h window, got ${diff}ms`);
});

test('applyQuestionHeuristics extracts service name', () => {
    const question = 'show logs for checkout service';
    const calls: ToolCall[] = [];
    const hasTool = makeHasTool(['query-logs']);

    const result = applyQuestionHeuristics(question, calls, hasTool);
    const logCall = result.find(c => c.name === 'query-logs');
    assert.deepEqual((logCall?.arguments as any)?.scope, { service: 'checkout' });
});

test('applyQuestionHeuristics extracts service name with "in" preposition', () => {
    const question = 'show metrics in payment-api service';
    const calls: ToolCall[] = [];
    const hasTool = makeHasTool(['query-metrics']);

    const result = applyQuestionHeuristics(question, calls, hasTool);
    const metricCall = result.find(c => c.name === 'query-metrics');
    assert.deepEqual((metricCall?.arguments as any)?.scope, { service: 'payment-api' });
});
