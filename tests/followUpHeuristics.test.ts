import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyFollowUpHeuristics } from '../src/engine/followUpHeuristics.js';
import { ToolCall, ToolResult } from '../src/types.js';
import { McpClient } from '../src/mcpClient.js';

// Helper to mock McpClient
const makeMockMcp = (tools: string[]) => ({
  hasTool: (name: string) => tools.includes(name),
  callTool: async () => ({ result: {} }),
  ensureTools: async () => { },
  listTools: async () => [],
  getTools: () => []
} as unknown as McpClient);

test('applyFollowUpHeuristics returns proposed calls if no results', () => {
  const question = 'what happened';
  const results: ToolResult[] = [];
  const proposed: ToolCall[] = [{ name: 'test', arguments: {} }];
  const mcp = makeMockMcp([]);

  const result = applyFollowUpHeuristics({ question, results, proposed, mcp });
  assert.deepEqual(result, proposed);
});

test('applyFollowUpHeuristics deduplicates calls', () => {
  const question = 'what happened';
  const results: ToolResult[] = [
    { name: 'test', arguments: { id: '1' }, result: 'ok' }
  ];
  const proposed: ToolCall[] = [
    { name: 'test', arguments: { id: '1' } }, // Duplicate of executed
    { name: 'new', arguments: { id: '2' } },
    { name: 'new', arguments: { id: '2' } }   // Duplicate of proposed
  ];
  const mcp = makeMockMcp([]);

  const result = applyFollowUpHeuristics({ question, results, proposed, mcp });
  // Should filter out duplicates but keep incident related calls if not drilling down
  // Since 'new' is not incident related and 'what happened' triggers drill down
  assert.equal(result.length, 1);
  assert.equal(result[0].name, 'new');
});

test('applyFollowUpHeuristics adds timeline for incident context', () => {
  const question = 'what happened';
  const results: ToolResult[] = [
    { name: 'query-incidents', result: { incidents: [{ id: 'INC-1' }] } }
  ];
  const proposed: ToolCall[] = [];
  const mcp = makeMockMcp(['get-incident-timeline']);

  const result = applyFollowUpHeuristics({ question, results, proposed, mcp });
  assert.ok(result.some(c => c.name === 'get-incident-timeline'));
  const call = result.find(c => c.name === 'get-incident-timeline');
  assert.equal((call?.arguments as any)?.id, 'INC-1');
});

test('applyFollowUpHeuristics skips timeline if already executed', () => {
  const question = 'what happened';
  const results: ToolResult[] = [
    { name: 'query-incidents', result: { incidents: [{ id: 'INC-1' }] } },
    { name: 'get-incident-timeline', arguments: { id: 'INC-1' }, result: 'ok' }
  ];
  const proposed: ToolCall[] = [];
  const mcp = makeMockMcp(['get-incident-timeline']);

  const result = applyFollowUpHeuristics({ question, results, proposed, mcp });
  assert.ok(!result.some(c => c.name === 'get-incident-timeline'));
});

test('applyFollowUpHeuristics filters non-incident calls if not drilling down', () => {
  const question = 'list incidents'; // Not a drill-down question
  const results: ToolResult[] = [
    { name: 'query-incidents', result: { incidents: [{ id: 'INC-1' }] } }
  ];
  const proposed: ToolCall[] = [
    { name: 'query-logs', arguments: {} },
    { name: 'get-incident-timeline', arguments: { id: 'INC-1' } }
  ];
  const mcp = makeMockMcp(['get-incident-timeline']);

  const result = applyFollowUpHeuristics({ question, results, proposed, mcp });
  // Should keep timeline (incident related) but remove logs
  assert.ok(result.some(c => c.name === 'get-incident-timeline'));
  assert.ok(!result.some(c => c.name === 'query-logs'));
});

test('applyFollowUpHeuristics adds logs and metrics when drilling down', () => {
  const question = 'root cause analysis';
  const results: ToolResult[] = [
    {
      name: 'query-incidents',
      result: {
        incidents: [{
          id: 'INC-1',
          service: 'checkout',
          start: '2024-01-01T10:00:00Z',
          end: '2024-01-01T11:00:00Z'
        }]
      }
    }
  ];
  const proposed: ToolCall[] = [];
  const mcp = makeMockMcp(['query-logs', 'query-metrics', 'get-incident-timeline']);

  const result = applyFollowUpHeuristics({ question, results, proposed, mcp });

  assert.ok(result.some(c => c.name === 'query-logs'));
  assert.ok(result.some(c => c.name === 'query-metrics'));

  const logCall = result.find(c => c.name === 'query-logs');
  assert.equal((logCall?.arguments as any)?.scope?.service, 'checkout');
  assert.ok((logCall?.arguments as any)?.start);
  assert.ok((logCall?.arguments as any)?.end);
});

test('applyFollowUpHeuristics respects maxToolCalls', () => {
  const question = 'root cause';
  const results: ToolResult[] = [
    { name: 'query-incidents', result: { incidents: [{ id: 'INC-1', start: '2024-01-01T10:00:00Z' }] } }
  ];
  const proposed: ToolCall[] = [];
  const mcp = makeMockMcp(['query-logs', 'query-metrics', 'get-incident-timeline']);

  // Should generate timeline, logs, metrics (3 calls)
  // Limit to 1
  const result = applyFollowUpHeuristics({
    question,
    results,
    proposed,
    mcp,
    maxToolCalls: 1
  });

  assert.equal(result.length, 1);
});

test('applyFollowUpHeuristics expands time window correctly', () => {
  const question = 'root cause';
  const results: ToolResult[] = [
    { name: 'query-incidents', result: { incidents: [{ id: 'INC-1', start: '2024-01-01T10:00:00Z' }] } }
  ];
  const proposed: ToolCall[] = [];
  const mcp = makeMockMcp(['query-logs']);

  const result = applyFollowUpHeuristics({ question, results, proposed, mcp });
  const logCall = result.find(c => c.name === 'query-logs');
  const start = new Date((logCall?.arguments as any).start);
  const end = new Date((logCall?.arguments as any).end);

  // Should be padded by 15 mins
  // Incident start is 10:00
  // Window start should be 10:00 - 15m = 09:45
  assert.ok(start.toISOString().includes('09:45'));
});

test('applyFollowUpHeuristics generates context-aware log queries', () => {
  const question = 'why did this happen?';
  const incidentResult: ToolResult = {
    name: 'query-incidents',
    result: {
      incidents: [{
        id: 'INC-700',
        service: 'payments',
        title: 'Payment webhook timeouts from Stripe',
        startTime: '2024-01-01T00:00:00Z',
        endTime: '2024-01-01T01:00:00Z',
      }],
    },
  };

  const result = applyFollowUpHeuristics({
    question,
    results: [incidentResult],
    proposed: [],
    mcp: makeMockMcp(['query-logs', 'get-incident-timeline']),
  });

  const logCall = result.find(c => c.name === 'query-logs');
  assert.ok(logCall, 'should inject log query');
  const query = (logCall?.arguments as any)?.query || '';
  // With improved keyword extraction, we expect high-value keywords like 'payment', 'webhook', 'stripe', or 'timeouts'
  assert.ok(
    query.includes('payment') || query.includes('webhook') || query.includes('stripe') || query.includes('timeout'),
    `Query should include relevant keywords from incident title. Got: ${query}`
  );
});

test('applyFollowUpHeuristics selects targeted metrics for DB incidents', () => {
  const question = 'root cause';
  const results: ToolResult[] = [
    {
      name: 'query-incidents',
      result: {
        incidents: [{
          id: 'INC-1',
          title: 'High DB Latency',
          start: '2024-01-01T10:00:00Z'
        }]
      }
    }
  ];
  const proposed: ToolCall[] = [];
  const mcp = makeMockMcp(['query-metrics']);

  const result = applyFollowUpHeuristics({ question, results, proposed, mcp });
  const metricCall = result.find(c => c.name === 'query-metrics');
  const expression = (metricCall?.arguments as any)?.expression;

  // Should include DB specific metrics
  assert.ok(expression.includes('db_latency'));
  assert.ok(expression.includes('db_connections'));
});

test('applyFollowUpHeuristics selects targeted metrics for Disk incidents', () => {
  const question = 'root cause';
  const results: ToolResult[] = [
    {
      name: 'query-incidents',
      result: {
        incidents: [{
          id: 'INC-1',
          summary: 'Disk volume full',
          start: '2024-01-01T10:00:00Z'
        }]
      }
    }
  ];
  const proposed: ToolCall[] = [];
  const mcp = makeMockMcp(['query-metrics']);

  const result = applyFollowUpHeuristics({ question, results, proposed, mcp });
  const metricCall = result.find(c => c.name === 'query-metrics');
  const expression = (metricCall?.arguments as any)?.expression;

  // Should include Disk specific metrics
  assert.ok(expression.includes('disk_usage'));
});
