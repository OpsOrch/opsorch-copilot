import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ExecutionTracer } from '../src/engine/executionTracer.js';
import { ToolCall, CopilotAnswer, HeuristicModification, ToolExecutionTrace } from '../src/types.js';

test('ExecutionTracer: creates trace with unique ID', () => {
  const tracer = new ExecutionTracer();
  const trace1 = tracer.startTrace('chat-1');
  const trace2 = tracer.startTrace('chat-2');

  assert.ok(trace1.traceId, 'Trace should have an ID');
  assert.ok(trace2.traceId, 'Trace should have an ID');
  assert.notEqual(trace1.traceId, trace2.traceId, 'Trace IDs should be unique');
  assert.equal(trace1.chatId, 'chat-1');
  assert.equal(trace2.chatId, 'chat-2');
  assert.ok(trace1.startTime > 0, 'Trace should have start time');
  assert.deepEqual(trace1.iterations, [], 'New trace should have no iterations');
});

test('ExecutionTracer: records iteration start', () => {
  const tracer = new ExecutionTracer();
  const trace = tracer.startTrace('chat-1');

  const plannedTools: ToolCall[] = [
    { name: 'query-incidents', arguments: { limit: 5 } },
    { name: 'query-logs', arguments: { query: 'error' } },
  ];

  tracer.startIteration(trace, plannedTools);

  assert.equal(trace.iterations.length, 1, 'Should have one iteration');
  assert.equal(trace.iterations[0].iterationNumber, 1);
  assert.deepEqual(trace.iterations[0].plannedTools, plannedTools);
  assert.deepEqual(trace.iterations[0].heuristicModifications, []);
  assert.deepEqual(trace.iterations[0].toolExecutions, []);
});

test('ExecutionTracer: records multiple iterations', () => {
  const tracer = new ExecutionTracer();
  const trace = tracer.startTrace('chat-1');

  tracer.startIteration(trace, [{ name: 'tool1', arguments: {} }]);
  tracer.startIteration(trace, [{ name: 'tool2', arguments: {} }]);
  tracer.startIteration(trace, [{ name: 'tool3', arguments: {} }]);

  assert.equal(trace.iterations.length, 3);
  assert.equal(trace.iterations[0].iterationNumber, 1);
  assert.equal(trace.iterations[1].iterationNumber, 2);
  assert.equal(trace.iterations[2].iterationNumber, 3);
});

test('ExecutionTracer: records heuristic modifications', () => {
  const tracer = new ExecutionTracer();
  const trace = tracer.startTrace('chat-1');

  tracer.startIteration(trace, []);

  const modification: HeuristicModification = {
    heuristicName: 'questionHeuristics',
    action: 'inject',
    reason: 'Added incident query based on question pattern',
    affectedTools: ['query-incidents'],
  };

  tracer.recordHeuristic(trace, modification);

  assert.equal(trace.iterations[0].heuristicModifications.length, 1);
  assert.deepEqual(trace.iterations[0].heuristicModifications[0], modification);
});

test('ExecutionTracer: records tool executions', () => {
  const tracer = new ExecutionTracer();
  const trace = tracer.startTrace('chat-1');

  tracer.startIteration(trace, []);

  const execution: ToolExecutionTrace = {
    toolName: 'query-incidents',
    cacheHit: false,
    executionTimeMs: 150,
    resultSizeBytes: 1024,
    success: true,
  };

  tracer.recordToolExecution(trace, execution);

  assert.equal(trace.iterations[0].toolExecutions.length, 1);
  assert.deepEqual(trace.iterations[0].toolExecutions[0], execution);
});

test('ExecutionTracer: records cache hits', () => {
  const tracer = new ExecutionTracer();
  const trace = tracer.startTrace('chat-1');

  tracer.startIteration(trace, []);

  const cacheHit: ToolExecutionTrace = {
    toolName: 'query-logs',
    cacheHit: true,
    executionTimeMs: 0,
    resultSizeBytes: 512,
    success: true,
  };

  tracer.recordToolExecution(trace, cacheHit);

  assert.equal(trace.iterations[0].toolExecutions[0].cacheHit, true);
  assert.equal(trace.iterations[0].toolExecutions[0].executionTimeMs, 0);
});

test('ExecutionTracer: records tool failures', () => {
  const tracer = new ExecutionTracer();
  const trace = tracer.startTrace('chat-1');

  tracer.startIteration(trace, []);

  const failure: ToolExecutionTrace = {
    toolName: 'query-metrics',
    cacheHit: false,
    executionTimeMs: 200,
    resultSizeBytes: 0,
    success: false,
    error: 'Connection timeout',
  };

  tracer.recordToolExecution(trace, failure);

  assert.equal(trace.iterations[0].toolExecutions[0].success, false);
  assert.equal(trace.iterations[0].toolExecutions[0].error, 'Connection timeout');
});

test('ExecutionTracer: completes iteration with duration', async () => {
  const tracer = new ExecutionTracer();
  const trace = tracer.startTrace('chat-1');

  tracer.startIteration(trace, []);

  // Simulate some work
  await new Promise(resolve => setTimeout(resolve, 50));

  tracer.completeIteration(trace);

  assert.ok(trace.iterations[0].durationMs >= 50, 'Duration should be at least 50ms');
});

test('ExecutionTracer: completes trace with final answer', () => {
  const tracer = new ExecutionTracer();
  const trace = tracer.startTrace('chat-1');

  tracer.startIteration(trace, []);
  tracer.completeIteration(trace);

  const answer: CopilotAnswer = {
    conclusion: 'Test conclusion',
    evidence: ['Evidence 1', 'Evidence 2'],
    confidence: 0.85,
    chatId: 'chat-1',
  };

  // Capture console.log output
  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (msg: string) => logs.push(msg);

  tracer.completeTrace(trace, answer);

  console.log = originalLog;

  assert.ok(trace.endTime, 'Trace should have end time');
  assert.deepEqual(trace.finalAnswer, answer);

  // Verify telemetry was emitted
  const telemetryLog = logs.find(log => log.includes('[ExecutionTrace]'));
  assert.ok(telemetryLog, 'Should emit telemetry log');

  const telemetry = JSON.parse(telemetryLog!.replace('[ExecutionTrace] ', ''));
  assert.equal(telemetry.chatId, 'chat-1');
  assert.equal(telemetry.iterationCount, 1);
  assert.equal(telemetry.confidence, 0.85);
});

test('ExecutionTracer: calculates cache hit rate correctly', () => {
  const tracer = new ExecutionTracer();
  const trace = tracer.startTrace('chat-1');

  tracer.startIteration(trace, []);

  // 2 cache hits, 3 misses
  tracer.recordToolExecution(trace, {
    toolName: 'tool1',
    cacheHit: true,
    executionTimeMs: 0,
    resultSizeBytes: 100,
    success: true,
  });
  tracer.recordToolExecution(trace, {
    toolName: 'tool2',
    cacheHit: true,
    executionTimeMs: 0,
    resultSizeBytes: 100,
    success: true,
  });
  tracer.recordToolExecution(trace, {
    toolName: 'tool3',
    cacheHit: false,
    executionTimeMs: 100,
    resultSizeBytes: 200,
    success: true,
  });
  tracer.recordToolExecution(trace, {
    toolName: 'tool4',
    cacheHit: false,
    executionTimeMs: 150,
    resultSizeBytes: 300,
    success: true,
  });
  tracer.recordToolExecution(trace, {
    toolName: 'tool5',
    cacheHit: false,
    executionTimeMs: 200,
    resultSizeBytes: 400,
    success: true,
  });

  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (msg: string) => logs.push(msg);

  tracer.completeTrace(trace, { conclusion: 'Test', chatId: 'chat-1' });

  console.log = originalLog;

  const telemetryLog = logs.find(log => log.includes('[ExecutionTrace]'));
  const telemetry = JSON.parse(telemetryLog!.replace('[ExecutionTrace] ', ''));

  assert.equal(telemetry.totalToolCalls, 5);
  assert.equal(telemetry.cacheHitRate, 0.4); // 2/5 = 0.4
});

test('ExecutionTracer: tracks failed tool count', () => {
  const tracer = new ExecutionTracer();
  const trace = tracer.startTrace('chat-1');

  tracer.startIteration(trace, []);

  tracer.recordToolExecution(trace, {
    toolName: 'tool1',
    cacheHit: false,
    executionTimeMs: 100,
    resultSizeBytes: 100,
    success: true,
  });
  tracer.recordToolExecution(trace, {
    toolName: 'tool2',
    cacheHit: false,
    executionTimeMs: 100,
    resultSizeBytes: 0,
    success: false,
    error: 'Error 1',
  });
  tracer.recordToolExecution(trace, {
    toolName: 'tool3',
    cacheHit: false,
    executionTimeMs: 100,
    resultSizeBytes: 0,
    success: false,
    error: 'Error 2',
  });

  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (msg: string) => logs.push(msg);

  tracer.completeTrace(trace, { conclusion: 'Test', chatId: 'chat-1' });

  console.log = originalLog;

  const telemetryLog = logs.find(log => log.includes('[ExecutionTrace]'));
  const telemetry = JSON.parse(telemetryLog!.replace('[ExecutionTrace] ', ''));

  assert.equal(telemetry.failedToolCount, 2);
});

test('ExecutionTracer: handles empty trace gracefully', () => {
  const tracer = new ExecutionTracer();
  const trace = tracer.startTrace('chat-1');

  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (msg: string) => logs.push(msg);

  tracer.completeTrace(trace, { conclusion: 'Test', chatId: 'chat-1' });

  console.log = originalLog;

  const telemetryLog = logs.find(log => log.includes('[ExecutionTrace]'));
  const telemetry = JSON.parse(telemetryLog!.replace('[ExecutionTrace] ', ''));

  assert.equal(telemetry.iterationCount, 0);
  assert.equal(telemetry.totalToolCalls, 0);
  assert.equal(telemetry.cacheHitRate, 0);
  assert.equal(telemetry.failedToolCount, 0);
});
