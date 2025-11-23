import './setup.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ParallelToolRunner, ToolDependency } from '../src/engine/parallelToolRunner.js';
import { domainRegistry } from '../src/engine/domainRegistry.js';
import { ToolCall, Tool, ToolResult } from '../src/types.js';
import { MockMcp } from '../src/mcps/mock.js';

test('ParallelToolRunner: identifies no dependencies for independent tools', () => {
  const runner = new ParallelToolRunner(domainRegistry);
  const calls: ToolCall[] = [
    { name: 'query-logs', arguments: { query: 'error' } },
    { name: 'query-metrics', arguments: { expression: 'cpu' } },
    { name: 'query-services', arguments: {} },
  ];

  const dependencies = runner.analyzeDependencies(calls);

  assert.equal(dependencies.length, 3);
  assert.deepEqual(dependencies[0].dependsOn, []);
  assert.deepEqual(dependencies[1].dependsOn, []);
  assert.deepEqual(dependencies[2].dependsOn, []);
});

test('ParallelToolRunner: identifies timeline dependency on incident query', () => {
  const runner = new ParallelToolRunner(domainRegistry);
  const calls: ToolCall[] = [
    { name: 'query-incidents', arguments: { limit: 1 } },
    { name: 'get-incident-timeline', arguments: {} }, // No explicit ID
  ];

  const dependencies = runner.analyzeDependencies(calls);

  assert.equal(dependencies.length, 2);
  assert.deepEqual(dependencies[0].dependsOn, []);
  assert.deepEqual(dependencies[1].dependsOn, ['query-incidents']);
});

test('ParallelToolRunner: no dependency when timeline has explicit ID', () => {
  const runner = new ParallelToolRunner(domainRegistry);
  const calls: ToolCall[] = [
    { name: 'query-incidents', arguments: { limit: 1 } },
    { name: 'get-incident-timeline', arguments: { id: 'INC-123' } },
  ];

  const dependencies = runner.analyzeDependencies(calls);

  assert.equal(dependencies.length, 2);
  assert.deepEqual(dependencies[0].dependsOn, []);
  assert.deepEqual(dependencies[1].dependsOn, []); // Has explicit ID, no dependency
});

test('ParallelToolRunner: identifies get-ticket dependency on query-tickets', () => {
  const runner = new ParallelToolRunner(domainRegistry);
  const calls: ToolCall[] = [
    { name: 'query-tickets', arguments: { query: 'bug' } },
    { name: 'get-ticket', arguments: {} }, // No explicit ID
  ];

  const dependencies = runner.analyzeDependencies(calls);

  assert.equal(dependencies.length, 2);
  assert.deepEqual(dependencies[0].dependsOn, []);
  assert.deepEqual(dependencies[1].dependsOn, ['query-tickets']);
});

test('ParallelToolRunner: identifies update dependency on get operation', () => {
  const runner = new ParallelToolRunner(domainRegistry);
  const calls: ToolCall[] = [
    { name: 'get-incident', arguments: { id: 'INC-123' } },
    { name: 'update-incident', arguments: { id: 'INC-123', status: 'resolved' } },
  ];

  const dependencies = runner.analyzeDependencies(calls);

  assert.equal(dependencies.length, 2);
  assert.deepEqual(dependencies[0].dependsOn, []);
  assert.deepEqual(dependencies[1].dependsOn, ['get-incident']);
});

test('ParallelToolRunner: can execute independent tools in parallel', () => {
  const runner = new ParallelToolRunner(domainRegistry);
  const calls: ToolCall[] = [
    { name: 'query-logs', arguments: {} },
    { name: 'query-metrics', arguments: {} },
  ];

  const canParallelize = runner.canExecuteInParallel(calls);

  assert.equal(canParallelize, true);
});

test('ParallelToolRunner: cannot execute dependent tools in parallel', () => {
  const runner = new ParallelToolRunner(domainRegistry);
  const calls: ToolCall[] = [
    { name: 'query-incidents', arguments: {} },
    { name: 'get-incident-timeline', arguments: {} },
  ];

  const canParallelize = runner.canExecuteInParallel(calls);

  assert.equal(canParallelize, false);
});

test('ParallelToolRunner: groups independent tools into single batch', () => {
  const runner = new ParallelToolRunner(domainRegistry);
  const dependencies: ToolDependency[] = [
    { tool: { name: 'query-logs', arguments: {} }, dependsOn: [] },
    { tool: { name: 'query-metrics', arguments: {} }, dependsOn: [] },
    { tool: { name: 'query-services', arguments: {} }, dependsOn: [] },
  ];

  const batches = runner.groupIntoBatches(dependencies);

  assert.equal(batches.length, 1);
  assert.equal(batches[0].length, 3);
});

test('ParallelToolRunner: groups dependent tools into multiple batches', () => {
  const runner = new ParallelToolRunner(domainRegistry);
  const dependencies: ToolDependency[] = [
    { tool: { name: 'query-incidents', arguments: {} }, dependsOn: [] },
    {
      tool: { name: 'get-incident-timeline', arguments: {} },
      dependsOn: ['query-incidents'],
    },
    { tool: { name: 'query-logs', arguments: {} }, dependsOn: [] },
  ];

  const batches = runner.groupIntoBatches(dependencies);

  assert.equal(batches.length, 2);
  assert.equal(batches[0].length, 2); // query-incidents and query-logs
  assert.equal(batches[1].length, 1); // get-incident-timeline
});

test('ParallelToolRunner: executes independent tools in parallel', async () => {
  const runner = new ParallelToolRunner(domainRegistry);
  const executionOrder: string[] = [];

  const mcp = new MockMcp(
    async () => [
      { name: 'query-logs' } as Tool,
      { name: 'query-metrics' } as Tool,
    ],
    async (call) => {
      executionOrder.push(call.name);
      // Simulate async execution
      await new Promise((resolve) => setTimeout(resolve, 10));
      return { name: call.name, result: { ok: true } };
    }
  );

  const dependencies: ToolDependency[] = [
    { tool: { name: 'query-logs', arguments: {} }, dependsOn: [] },
    { tool: { name: 'query-metrics', arguments: {} }, dependsOn: [] },
  ];

  const results = await runner.executeWithDependencies(
    dependencies,
    mcp,
    'test-chat',
    await mcp.listTools()
  );

  assert.equal(results.length, 2);
  // Both should execute (order may vary due to parallel execution)
  assert.ok(executionOrder.includes('query-logs'));
  assert.ok(executionOrder.includes('query-metrics'));
});

test('ParallelToolRunner: executes dependent tools in correct order', async () => {
  const runner = new ParallelToolRunner(domainRegistry);
  const executionOrder: string[] = [];

  const mcp = new MockMcp(
    async () => [
      { name: 'query-incidents' } as Tool,
      { name: 'get-incident-timeline' } as Tool,
    ],
    async (call) => {
      executionOrder.push(call.name);
      return { name: call.name, result: { ok: true } };
    }
  );

  const dependencies: ToolDependency[] = [
    { tool: { name: 'query-incidents', arguments: {} }, dependsOn: [] },
    {
      tool: { name: 'get-incident-timeline', arguments: {} },
      dependsOn: ['query-incidents'],
    },
  ];

  const results = await runner.executeWithDependencies(
    dependencies,
    mcp,
    'test-chat',
    await mcp.listTools()
  );

  assert.equal(results.length, 2);
  // query-incidents must execute before get-incident-timeline
  assert.equal(executionOrder[0], 'query-incidents');
  assert.equal(executionOrder[1], 'get-incident-timeline');
});

test('ParallelToolRunner: handles mixed parallel and sequential execution', async () => {
  const runner = new ParallelToolRunner(domainRegistry);
  const executionOrder: string[] = [];

  const mcp = new MockMcp(
    async () => [
      { name: 'query-incidents' } as Tool,
      { name: 'query-logs' } as Tool,
      { name: 'get-incident-timeline' } as Tool,
    ],
    async (call) => {
      executionOrder.push(call.name);
      return { name: call.name, result: { ok: true } };
    }
  );

  const dependencies: ToolDependency[] = [
    { tool: { name: 'query-incidents', arguments: {} }, dependsOn: [] },
    { tool: { name: 'query-logs', arguments: {} }, dependsOn: [] },
    {
      tool: { name: 'get-incident-timeline', arguments: {} },
      dependsOn: ['query-incidents'],
    },
  ];

  const results = await runner.executeWithDependencies(
    dependencies,
    mcp,
    'test-chat',
    await mcp.listTools()
  );

  assert.equal(results.length, 3);

  // query-incidents and query-logs should execute first (parallel)
  const firstBatch = executionOrder.slice(0, 2);
  assert.ok(firstBatch.includes('query-incidents'));
  assert.ok(firstBatch.includes('query-logs'));

  // get-incident-timeline should execute after query-incidents
  assert.equal(executionOrder[2], 'get-incident-timeline');
});

test('ParallelToolRunner: handles empty tool list', async () => {
  const runner = new ParallelToolRunner(domainRegistry);
  const mcp = new MockMcp(
    async () => [],
    async () => ({ name: 'test', result: {} })
  );

  const results = await runner.executeWithDependencies([], mcp, 'test-chat', []);

  assert.equal(results.length, 0);
});

test('ParallelToolRunner: handles tool execution errors gracefully', async () => {
  const runner = new ParallelToolRunner(domainRegistry);

  const mcp = new MockMcp(
    async () => [
      { name: 'query-logs' } as Tool,
      { name: 'query-metrics' } as Tool,
    ],
    async (call) => {
      if (call.name === 'query-logs') {
        throw new Error('Log query failed');
      }
      return { name: call.name, result: { ok: true } };
    }
  );

  const dependencies: ToolDependency[] = [
    { tool: { name: 'query-logs', arguments: {} }, dependsOn: [] },
    { tool: { name: 'query-metrics', arguments: {} }, dependsOn: [] },
  ];

  const results = await runner.executeWithDependencies(
    dependencies,
    mcp,
    'test-chat',
    await mcp.listTools()
  );

  // Should still return results for both (error will be in result)
  assert.equal(results.length, 2);

  // One should have error, one should succeed
  const hasError = results.some(r =>
    typeof r.result === 'object' && r.result !== null && 'error' in r.result
  );
  const hasSuccess = results.some(r =>
    typeof r.result === 'object' && r.result !== null && 'ok' in r.result
  );

  assert.ok(hasError);
  assert.ok(hasSuccess);
});

test('ParallelToolRunner: handles circular dependencies gracefully', async () => {
  const runner = new ParallelToolRunner(domainRegistry);

  const mcp = new MockMcp(
    async () => [
      { name: 'tool-a' } as Tool,
      { name: 'tool-b' } as Tool,
    ],
    async (call) => ({ name: call.name, result: { ok: true } })
  );

  // Manually create circular dependency (shouldn't happen in practice)
  const dependencies: ToolDependency[] = [
    { tool: { name: 'tool-a', arguments: {} }, dependsOn: ['tool-b'] },
    { tool: { name: 'tool-b', arguments: {} }, dependsOn: ['tool-a'] },
  ];

  const results = await runner.executeWithDependencies(
    dependencies,
    mcp,
    'test-chat',
    await mcp.listTools()
  );

  // Should execute both tools (fallback to sequential)
  assert.equal(results.length, 2);
});
