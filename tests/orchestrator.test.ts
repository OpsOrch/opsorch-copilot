import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CopilotEngine } from '../src/orchestrator.js';
import { LlmClient, LlmMessage, Tool, ToolCall } from '../src/types.js';

type StubMcp = {
  listTools: () => Promise<Tool[]>;
  callTool: (call: ToolCall) => Promise<{ name: string; result: unknown }>;
};

function makeEngine(llm: LlmClient, mcp: StubMcp) {
  const engine = new CopilotEngine({ mcpUrl: 'http://localhost:7070/mcp', llm });
  // Override MCP client with stub for tests (no network).
  (engine as any).mcp = mcp;
  return engine;
}

test('executes LLM-planned tool calls and propagates ids', async () => {
  const llm: LlmClient = {
    async chat(messages: LlmMessage[], tools: Tool[]) {
      if (tools.length) {
        return {
          content: 'plan',
          toolCalls: [{ name: 'health', arguments: {} }],
          conversationId: 'conv-123',
          responseId: 'turn-abc',
        };
      }
      return {
        content: JSON.stringify({ conclusion: 'health is ok', evidence: ['health: ok'], confidence: 0.95 }),
        toolCalls: [],
        conversationId: 'conv-123',
        responseId: 'turn-abc',
      };
    },
  };

  const mcp: StubMcp = {
    async listTools() {
      return [{ name: 'health' } as Tool];
    },
    async callTool(call) {
      assert.equal(call.name, 'health');
      return { name: call.name, result: { status: 'ok' } };
    },
  };

  const engine = makeEngine(llm, mcp);
  const answer = await engine.answer('Check health');
  assert.equal(answer.conversationId, 'conv-123');
  assert.equal(answer.responseId, 'turn-abc');
  assert.ok(answer.conclusion.includes('health'));
  assert.ok(answer.evidence && answer.evidence[0]?.includes('health'));
});

test('falls back to heuristic plan when LLM fails', async () => {
  const llm: LlmClient = {
    async chat() {
      throw new Error('llm-fail');
    },
  };

  // Capture which tool was invoked from heuristic plan.
  const calls: ToolCall[] = [];
  const mcp: StubMcp = {
    async listTools() {
      return [{ name: 'query-incidents' } as Tool];
    },
    async callTool(call) {
      calls.push(call);
      return { name: call.name, result: { ok: true } };
    },
  };

  const engine = makeEngine(llm, mcp);
  const answer = await engine.answer('Find impactful incidents');
  assert.ok(answer.conclusion.length > 0);
  assert.equal(calls[0]?.name, 'query-incidents');
});

test('asks LLM for explicit JSON plan when no tool calls were returned', async () => {
  const toolUsages: number[] = [];
  const llm: LlmClient = {
    async chat(messages: LlmMessage[], tools: Tool[]) {
      toolUsages.push(tools.length);
      // First call (with tools) returns no structured tool calls.
      if (tools.length) {
        return { content: 'no tool calls', toolCalls: [] };
      }
      // Second call should be the explicit JSON planner without tool schema.
      const lastSystem = messages.find((m) => m.role === 'system');
      assert.ok(lastSystem && lastSystem.content?.includes('JSON'), 'planner system prompt should request JSON');
      return {
        content: JSON.stringify({ toolCalls: [{ name: 'query-services', arguments: {} }] }),
        toolCalls: [],
      };
    },
  };

  const calls: ToolCall[] = [];
  const mcp: StubMcp = {
    async listTools() {
      return [{ name: 'query-services' } as Tool];
    },
    async callTool(call) {
      calls.push(call);
      return { name: call.name, result: { ok: true } };
    },
  };

  const engine = makeEngine(llm, mcp);
  const answer = await engine.answer('What can you see?');
  assert.deepEqual(toolUsages.slice(0, 2), [1, 0]);
  assert.equal(calls[0]?.name, 'query-services');
  assert.ok(answer.conclusion.length > 0);
});

test('skips placeholder args and reports missing data', async () => {
  const llm: LlmClient = {
    async chat() {
      return {
        content: 'plan',
        toolCalls: [{ name: 'get-incident-timeline', arguments: { id: '{{incidentId}}' } }],
      };
    },
  };

  const mcp: StubMcp = {
    async listTools() {
      return [{ name: 'get-incident-timeline' } as Tool];
    },
    async callTool() {
      throw new Error('should not be called');
    },
  };

  const engine = makeEngine(llm, mcp);
  const answer = await engine.answer('What triggered severity change?');
  assert.ok(answer.missing?.includes('tool outputs'));
});

test('refines plan with prior results to add concrete follow-ups', async () => {
  const llmCalls: { messages: LlmMessage[]; tools: Tool[] }[] = [];
  const llm: LlmClient = {
    async chat(messages: LlmMessage[], tools: Tool[]) {
      llmCalls.push({ messages, tools });
      // First pass: suggest listing incidents.
      if (llmCalls.length === 1 && tools.length) {
        return { content: 'plan1', toolCalls: [{ name: 'query-incidents', arguments: { limit: 1 } }] };
      }
      // Second pass (refinement): should see tool results in user content and emit concrete timeline call.
      if (llmCalls.length === 2 && tools.length) {
        const userMsg = messages.find((m) => m.role === 'user')?.content || '';
        assert.ok(userMsg.includes('Tool results'), 'refinement should receive tool results');
        return { content: 'plan2', toolCalls: [{ name: 'get-incident-timeline', arguments: { id: 'INC-100' } }] };
      }
      // Synthesis call.
      return { content: JSON.stringify({ conclusion: 'done', evidence: [] }), toolCalls: [] };
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
    async callTool(call) {
      calls.push(call);
      if (call.name === 'query-incidents') {
        return { name: call.name, result: { incidents: [{ id: 'INC-100' }] } };
      }
      if (call.name === 'get-incident-timeline') {
        assert.equal((call.arguments as any).id, 'INC-100');
        return { name: call.name, result: { id: 'INC-100', events: [] } };
      }
      throw new Error('unexpected call');
    },
  };

  const engine = makeEngine(llm, mcp);
  await engine.answer('Summarize incident');
  assert.equal(calls[0]?.name, 'query-incidents');
  assert.equal(calls[1]?.name, 'get-incident-timeline');
  assert.ok(llmCalls.filter((c) => c.tools.length).length >= 2, 'planner should run multiple passes with tools');
});

test('emits references instead of links with ids and ranges for console', async () => {
  const llm: LlmClient = {
    async chat(messages: LlmMessage[], tools: Tool[]) {
      // Planning turn emits concrete log/metric calls; synthesis returns only conclusion/evidence.
      if (tools.length) {
        const toolCalls: ToolCall[] = [
          {
            name: 'query-logs',
            arguments: {
              query: 'error OR 500',
              start: '2024-01-01T00:00:00Z',
              end: '2024-01-01T01:00:00Z',
              service: 'checkout',
            },
          },
          {
            name: 'query-metrics',
            arguments: {
              expression: 'latency_p95',
              start: '2024-01-01T00:00:00Z',
              end: '2024-01-01T01:00:00Z',
              step: '60s',
              service: 'checkout',
            },
          },
        ];
        return { content: 'plan', toolCalls } satisfies {
          content: string;
          toolCalls: ToolCall[];
          conversationId?: string;
          responseId?: string;
        };
      }
      return {
        content: JSON.stringify({ conclusion: 'done', evidence: ['ok'] }),
        toolCalls: [],
      };
    },
  };

  const calls: ToolCall[] = [];
  const mcp: StubMcp = {
    async listTools() {
      return [
        { name: 'query-logs' } as Tool,
        { name: 'query-metrics' } as Tool,
      ];
    },
    async callTool(call) {
      calls.push(call);
      return { name: call.name, result: { ok: true } };
    },
  };

  const engine = makeEngine(llm, mcp);
  const answer = await engine.answer('Show me logs and metrics');

  assert.ok(calls.some((c) => c.name === 'query-logs'), 'should call logs tool');
  assert.ok(calls.some((c) => c.name === 'query-metrics'), 'should call metrics tool');
  assert.equal(answer.references?.logs?.[0]?.query, 'error OR 500');
  assert.equal(answer.references?.logs?.[0]?.service, 'checkout');
  assert.equal(answer.references?.logs?.[0]?.start, '2024-01-01T00:00:00Z');
  assert.equal(answer.references?.metrics?.[0]?.expression, 'latency_p95');
  assert.equal(answer.references?.metrics?.[0]?.scope, 'checkout');
  assert.equal(answer.references?.metrics?.[0]?.step, '60s');
});
