import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyFollowUpHeuristics } from '../src/engine/followUpHeuristics.js';
import { ToolCall, ToolResult } from '../src/types.js';

test('drops non-incident follow-ups for severity summaries when context is missing', () => {
  const proposed: ToolCall[] = [{ name: 'health', arguments: {} }];
  const results: ToolResult[] = [
    {
      name: 'query-incidents',
      result: { ok: true },
      arguments: { limit: 1 },
    },
  ];

  const calls = applyFollowUpHeuristics({
    question: 'Summarize the latest SEV1 incident',
    results,
    proposed,
    hasTool: () => true,
    maxToolCalls: 3,
  });

  assert.equal(calls.length, 0, 'engine should not run unrelated tools without incident context');
});

test('still inserts timeline follow-ups for summary questions when incidents were found', () => {
  const proposed: ToolCall[] = [];
  const results: ToolResult[] = [
    {
      name: 'query-incidents',
      result: { incidents: [{ id: 'INC-500' }] },
      arguments: { limit: 1 },
    },
  ];

  const calls = applyFollowUpHeuristics({
    question: 'Summarize checkout incident',
    results,
    proposed,
    hasTool: (name) => name === 'get-incident-timeline',
    maxToolCalls: 3,
  });

  assert.deepEqual(calls, [{ name: 'get-incident-timeline', arguments: { id: 'INC-500' } }]);
});
