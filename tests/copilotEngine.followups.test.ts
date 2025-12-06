import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LlmClient, LlmMessage, Tool, ToolCall, ToolResult, JsonObject } from '../src/types.js';
import { makeEngine, StubMcp } from './helpers/copilotTestUtils.js';

test('refines plan with prior results to add concrete follow-ups', async () => {
  try {
    const llmCalls: { messages: LlmMessage[]; tools: Tool[] }[] = [];
    const llm: LlmClient = {
      async chat(messages: LlmMessage[], tools: Tool[], _opts?: { chatId?: string }) {
        llmCalls.push({ messages, tools });
        if (llmCalls.length === 1 && tools.length) {
          return {
            content: 'plan1',
            toolCalls: [{ name: 'query-incidents', arguments: { limit: 1 } }],
            chatId: 'conv-followups-plan',
          };
        }
        if (llmCalls.length === 2 && tools.length) {
          const userMsg = messages.find((m) => m.role === 'user')?.content || '';
          assert.ok(userMsg.includes('Tool results'), 'refinement should receive tool results');
          return {
            content: 'plan2',
            toolCalls: [{ name: 'get-incident-timeline', arguments: { id: 'INC-100' } }],
            chatId: 'conv-followups-plan',
          };
        }
        return {
          content: JSON.stringify({ conclusion: 'done', evidence: [] }),
          toolCalls: [],
          chatId: 'conv-followups-plan',
        };
      },
    };

    const calls: ToolCall[] = [];
    const mcp: StubMcp = {
      async listTools() {
        return [
          { name: 'query-incidents' } as Tool,
          { name: 'get-incident-timeline' } as Tool,
        ];
      },
      async callTool(call): Promise<ToolResult> {
        calls.push(call);
        if (call.name === 'query-incidents') {
          return { name: call.name, result: [{ id: 'INC-100' }] };
        }
        if (call.name === 'get-incident-timeline') {
          assert.equal((call.arguments as JsonObject).id, 'INC-100');
          return { name: call.name, result: [{ at: '2024-01-01T00:00:00Z', kind: 'event' }] };
        }
        throw new Error('unexpected call');
      },
    };

    const engine = makeEngine(llm, mcp);
    await engine.answer('Summarize incident');
    assert.equal(calls[0]?.name, 'query-incidents');
    assert.equal(calls[1]?.name, 'get-incident-timeline');
    assert.ok(llmCalls.filter((c) => c.tools.length).length >= 2, 'planner should run multiple passes with tools');
  } catch (error) {
    console.error('Test failed with error:', error);
    throw error;
  }
});

test('emits references instead of links with ids and ranges for console', async () => {
  const llm: LlmClient = {
    async chat(messages: LlmMessage[], tools: Tool[], _opts?: { chatId?: string }) {
      console.log('LLM Chat called with tools:', tools.length);
      if (tools.length) {
        const plan = {
          toolCalls: [
            {
              name: 'query-logs',
              arguments: {
                expression: { search: 'error OR exception' },
                scope: {
                  service: 'checkout',
                },
                start: '2024-01-01T00:00:00Z',
              } as JsonObject,
            },
            {
              name: 'query-metrics',
              arguments: { expression: { metricName: 'latency_p95' }, scope: { service: 'checkout' }, step: 60 } as JsonObject,
            },
          ],
        };
        return {
          content: 'planning...',
          toolCalls: plan.toolCalls,
          chatId: 'conv-references-plan',
        };
      }
      return {
        content: JSON.stringify({ conclusion: 'done', evidence: ['ok'] }),
        toolCalls: [],
        chatId: 'conv-references',
      };
    },
  };

  const calls: ToolCall[] = [];
  const mcp: StubMcp = {
    async listTools() {
      console.log('StubMcp listTools called');
      return [
        { name: 'query-logs' } as Tool,
        { name: 'query-metrics' } as Tool,
      ];
    },
    async callTool(call) {
      calls.push(call);
      if (call.name === 'query-logs') {
        return { name: call.name, result: [{ id: 'log-1', message: 'error' }] } as ToolResult;
      }
      if (call.name === 'query-metrics') {
        return { name: call.name, result: [{ point: { timestamp: '2024-01-01T00:00:00Z', value: 100 } }] } as ToolResult;
      }
      throw new Error('unexpected call');
    },
  };

  const engine = makeEngine(llm, mcp);
  const answer = await engine.answer('Show me logs and metrics');

  assert.ok(calls.some((c) => c.name === 'query-logs'), 'should call logs tool');
  assert.ok(calls.some((c) => c.name === 'query-metrics'), 'should call metrics tool');
  // assert.ok(answer.conclusion.includes('log-1'), 'should include log reference'); // Mock doesn't return this in conclusion
  assert.strictEqual(answer.references?.logs?.[0]?.expression?.search, 'error OR exception');
  assert.equal(answer.references?.logs?.[0]?.scope?.service, 'checkout');
  assert.equal(answer.references?.logs?.[0]?.start, '2024-01-01T00:00:00Z');
  assert.equal(answer.references?.metrics?.[0]?.expression?.metricName, 'latency_p95');
  assert.equal(answer.references?.metrics?.[0]?.scope?.service, 'checkout');
  assert.equal(answer.references?.metrics?.[0]?.step, 60);
});

test('drills into incident timelines/logs/metrics when user asks for root cause', async () => {
  let plannerCalls = 0;
  const llm: LlmClient = {
    async chat(_messages: LlmMessage[], tools: Tool[], _opts?: { chatId?: string }) {
      if (tools.length) {
        plannerCalls += 1;
        if (plannerCalls === 1) {
          return {
            content: 'plan',
            toolCalls: [
              { name: 'query-incidents', arguments: { limit: 1, severities: ['sev1'] } },
              // Explicitly request metrics and logs as per user prompting "check cpu metrics",
              // since heuristic injection is now disabled when LLM provides a plan.
              {
                name: 'query-metrics',
                arguments: {
                  start: '2024-01-01T00:00:00Z',
                  end: '2024-01-01T01:00:00Z',
                  step: 60,
                  scope: { service: 'checkout' },
                  expression: { metricName: 'cpu_usage' }
                } as JsonObject
              },
              {
                name: 'query-logs',
                arguments: {
                  start: '2024-01-01T00:00:00Z',
                  end: '2024-01-01T01:00:00Z',
                  scope: { service: 'checkout' },
                  expression: { search: 'error' }
                } as JsonObject
              }
            ],
            chatId: 'conv-root-cause',
          };
        }
        return { content: 'no follow ups', toolCalls: [], chatId: 'conv-root-cause' };
      }
      return {
        content: JSON.stringify({ conclusion: 'done', evidence: [] }),
        toolCalls: [],
        chatId: 'conv-root-cause',
      };
    },
  };

  const calls: ToolCall[] = [];
  const mcp: StubMcp = {
    async listTools() {
      return [
        { name: 'query-incidents' } as Tool,
        { name: 'get-incident-timeline' } as Tool,
        { name: 'query-logs' } as Tool,
        { name: 'query-metrics' } as Tool,
      ];
    },
    async callTool(call): Promise<ToolResult> {
      calls.push(call);
      if (call.name === 'query-incidents') {
        return {
          name: call.name,
          result: [
            {
              id: 'INC-200',
              service: 'checkout',
              startTime: '2024-01-01T00:00:00Z',
              endTime: '2024-01-01T00:30:00Z',
            },
          ],
        };
      }
      if (call.name === 'get-incident-timeline') {
        assert.equal((call.arguments as JsonObject).id, 'INC-200');
        return {
          name: call.name,
          result: [
            { at: '2024-01-01T00:05:00Z', kind: 'event' },
            { at: '2024-01-01T00:25:00Z', kind: 'event' },
          ],
        };
      }
      if (call.name === 'query-logs') {
        assert.ok(Number.isFinite(Date.parse((call.arguments as JsonObject).start as string)), 'logs call needs start window');
        assert.equal(((call.arguments as JsonObject).scope as JsonObject)?.service, 'checkout');
        return { name: call.name, result: [] };
      }
      if (call.name === 'query-metrics') {
        assert.ok(Number.isFinite(Date.parse((call.arguments as JsonObject).start as string)), 'metrics call needs start window');
        assert.equal(((call.arguments as JsonObject).scope as JsonObject)?.service, 'checkout');
        return { name: call.name, result: [] };
      }
      throw new Error(`unexpected call ${call.name}`);
    },
  };

  const engine = makeEngine(llm, mcp);
  await engine.answer('Find the root cause and check cpu metrics of the latest SEV1 incident.');

  // The engine may call query-metrics multiple times with different parameters
  // for comprehensive root cause analysis
  const callNames = calls.map((call) => call.name);
  assert.ok(callNames.includes('query-incidents'), 'Should query incidents');
  assert.ok(callNames.includes('get-incident-timeline'), 'Should get timeline');
  assert.ok(callNames.includes('query-metrics'), 'Should query metrics');
  assert.ok(callNames.includes('query-logs'), 'Should query logs');
});
