import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LlmClient, LlmMessage, Tool, ToolCall } from '../src/types.js';
import { makeEngine, StubMcp } from './helpers/copilotTestUtils.js';

test('executes LLM-planned tool calls and propagates ids', async () => {
  const llm: LlmClient = {
    async chat(messages: LlmMessage[], tools: Tool[], _opts?: { chatId?: string }) {
      if (tools.length) {
        return {
          content: 'plan',
          toolCalls: [{ name: 'query-services', arguments: {} }],
          chatId: 'conv-123',
        };
      }
      return {
        content: JSON.stringify({ conclusion: 'services healthy', evidence: ['services list ok'], confidence: 0.95 }),
        toolCalls: [],
        chatId: 'conv-123',
      };
    },
  };

  const mcp: StubMcp = {
    async listTools() {
      return [{ name: 'query-services' } as Tool];
    },
    async callTool(call) {
      assert.equal(call.name, 'query-services');
      return { name: call.name, result: { services: ['checkout'] } };
    },
  };

  const engine = makeEngine(llm, mcp);
  const answer = await engine.answer('List services');
  assert.equal(answer.chatId, 'conv-123');
  assert.ok(answer.conclusion.includes('services'));
  assert.ok(answer.evidence && answer.evidence.length > 0);
});

test('extracts incident references from MCP text content payloads', async () => {
  const llm: LlmClient = {
    async chat(messages: LlmMessage[], tools: Tool[]) {
      if (tools.length) {
        return {
          content: 'plan',
          toolCalls: [{ name: 'query-incidents', arguments: { service: 'payments' } }],
          chatId: 'conv-incidents-plan',
        };
      }
      return {
        content: JSON.stringify({ conclusion: 'done', evidence: [] }),
        toolCalls: [],
        chatId: 'conv-incidents-plan',
      };
    },
  };

  const incidents = [
    {
      id: 'inc-003',
      title: 'Payments webhook timeouts from Stripe',
      severity: 'sev1',
      status: 'open',
    },
  ];

  const mcp: StubMcp = {
    async listTools() {
      return [{ name: 'query-incidents' } as Tool];
    },
    async callTool(call) {
      return {
        name: call.name,
        result: {
          content: [
            {
              type: 'text',
              text: JSON.stringify(incidents, null, 2),
            },
          ],
        },
      };
    },
  };

  const engine = makeEngine(llm, mcp);
  const answer = await engine.answer('show incidents');
  assert.deepEqual(answer.references?.incidents, ['inc-003']);
});

test('seeds planner with caller chat id but adopts LLM-provided overrides', async () => {
  const observedChatIds: Array<string | undefined> = [];
  const llm: LlmClient = {
    async chat(_messages: LlmMessage[], tools: Tool[], opts?: { chatId?: string }) {
      observedChatIds.push(opts?.chatId);
      if (tools.length) {
        return { content: 'plan', toolCalls: [{ name: 'query-services', arguments: {} }], chatId: 'llm-conv' };
      }
      return { content: JSON.stringify({ conclusion: 'done' }), toolCalls: [], chatId: 'llm-conv' };
    },
  };

  const mcp: StubMcp = {
    async listTools() {
      return [{ name: 'query-services' } as Tool];
    },
    async callTool(call) {
      return { name: call.name, result: { ok: true } };
    },
  };

  const engine = makeEngine(llm, mcp);
  const answer = await engine.answer('List services', { chatId: 'user-conv' });

  assert.equal(answer.chatId, 'llm-conv');
  assert.equal(observedChatIds[0], 'user-conv');
  assert.equal(observedChatIds[1], 'user-conv');
  assert.equal(observedChatIds[observedChatIds.length - 1], 'llm-conv');
});

test('falls back to heuristic plan when LLM fails', async () => {
  const llm: LlmClient = {
    async chat(_messages: LlmMessage[] = [], _tools: Tool[] = [], _opts?: { chatId?: string }) {
      throw new Error('llm-fail');
    },
  };

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
    async chat(messages: LlmMessage[], tools: Tool[], _opts?: { chatId?: string }) {
      toolUsages.push(tools.length);
      if (tools.length) {
        return { content: 'no tool calls', toolCalls: [], chatId: 'conv-json-plan' };
      }
      const lastSystem = messages.find((m) => m.role === 'system');
      assert.ok(lastSystem && lastSystem.content?.includes('JSON'), 'planner system prompt should request JSON');
      return {
        content: JSON.stringify({ toolCalls: [{ name: 'query-services', arguments: {} }] }),
        toolCalls: [],
        chatId: 'conv-json-plan',
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
    async chat(_messages: LlmMessage[] = [], _tools: Tool[] = [], _opts?: { chatId?: string }) {
      return {
        content: 'plan',
        toolCalls: [{ name: 'get-incident-timeline', arguments: { id: '{{incidentId}}' } }],
        chatId: 'conv-placeholder-plan',
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

test('caps planner to 3 tool calls per iteration even if LLM proposes more', async () => {
  let plannerCalls = 0;
  const llm: LlmClient = {
    async chat(_messages: LlmMessage[], tools: Tool[], _opts?: { chatId?: string }) {
      if (tools.length) {
        plannerCalls += 1;
        if (plannerCalls === 1) {
          return {
            content: 'plan',
            toolCalls: [
              { name: 'a', arguments: {} },
              { name: 'b', arguments: {} },
              { name: 'c', arguments: {} },
              { name: 'd', arguments: {} },
            ],
            chatId: 'conv-capped-plan',
          };
        }
        return { content: 'no follow ups', toolCalls: [], chatId: 'conv-capped-plan' };
      }
      return {
        content: JSON.stringify({ conclusion: 'done', evidence: [] }),
        toolCalls: [],
        chatId: 'conv-capped-plan',
      };
    },
  };

  const calls: ToolCall[] = [];
  const mcp: StubMcp = {
    async listTools() {
      return [
        { name: 'a' } as Tool,
        { name: 'b' } as Tool,
        { name: 'c' } as Tool,
        { name: 'd' } as Tool,
      ];
    },
    async callTool(call) {
      calls.push(call);
      return { name: call.name, result: { ok: true } };
    },
  };

  const engine = makeEngine(llm, mcp);
  await engine.answer('Need many tools');
  assert.equal(calls.length, 3);
  assert.deepEqual(
    calls.map((call) => call.name),
    ['a', 'b', 'c'],
    'engine should execute only the first 3 tool calls'
  );
});

test('skips tool calls missing MCP-required fields', async () => {
  const llm: LlmClient = {
    async chat(_messages: LlmMessage[] = [], _tools: Tool[] = [], _opts?: { chatId?: string }) {
      return {
        content: 'plan',
        toolCalls: [
          { name: 'query-metrics', arguments: { start: '2024-01-01T00:00:00Z', end: '2024-01-01T01:00:00Z' } },
        ],
        chatId: 'conv-missing-fields',
      };
    },
  };

  const calls: ToolCall[] = [];
  const mcp: StubMcp = {
    async listTools() {
      return [
        {
          name: 'query-metrics',
          inputSchema: {
            type: 'object',
            required: ['expression', 'step', 'start', 'end'],
            properties: {
              expression: { type: 'string' },
              step: { type: 'integer' },
              start: { type: 'string' },
              end: { type: 'string' },
            },
          },
        } as Tool,
      ];
    },
    async callTool(call) {
      calls.push(call);
      return { name: call.name, result: { ok: true } };
    },
  };

  const engine = makeEngine(llm, mcp);
  const answer = await engine.answer('check metrics');
  assert.equal(calls.length, 0, 'call should be skipped because required fields are missing');
  assert.ok(answer.conclusion.includes('No tool results'), 'answer should reflect missing tool outputs');
});

test('injects incident query when planner omits it for severity questions', async () => {
  const llm: LlmClient = {
    async chat(_messages: LlmMessage[] = [], tools: Tool[] = [], _opts?: { chatId?: string }) {
      if (tools.length) {
        return { content: 'plan', toolCalls: [{ name: 'health', arguments: {} }], chatId: 'conv-inject-plan' };
      }
      return { content: JSON.stringify({ conclusion: 'done' }), toolCalls: [], chatId: 'conv-inject-plan' };
    },
  };

  const calls: ToolCall[] = [];
  const mcp: StubMcp = {
    async listTools() {
      return [{ name: 'health' } as Tool, { name: 'query-incidents' } as Tool];
    },
    async callTool(call) {
      if (call.name === 'health') {
        throw new Error('health tool should never be executed');
      }
      calls.push(call);
      return { name: call.name, result: { ok: true } };
    },
  };

  const engine = makeEngine(llm, mcp);
  await engine.answer('Summarize the latest SEV1 incident');

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.name, 'query-incidents');
  assert.deepEqual(calls[0]?.arguments, { limit: 1, severities: ['sev1'] });
});

test('adds default logs and metrics calls when user explicitly asks for them', async () => {
  const llm: LlmClient = {
    async chat(_messages: LlmMessage[] = [], tools: Tool[] = [], _opts?: { chatId?: string }) {
      if (tools.length) {
        return { content: 'plan', toolCalls: [], chatId: 'conv-default-logs' };
      }
      return { content: JSON.stringify({ conclusion: 'done' }), toolCalls: [], chatId: 'conv-default-logs' };
    },
  };

  const calls: ToolCall[] = [];
  const mcp: StubMcp = {
    async listTools() {
      return [{ name: 'query-logs' } as Tool, { name: 'query-metrics' } as Tool];
    },
    async callTool(call) {
      calls.push(call);
      return { name: call.name, result: { ok: true } };
    },
  };

  const engine = makeEngine(llm, mcp);
  await engine.answer('Tell me more about 504s in logs and metrics');

  assert.equal(calls.length, 2);
  assert.equal(calls[0]?.name, 'query-logs');
  assert.ok(((calls[0]?.arguments as any).query as string).includes('504'));
  assert.ok(typeof (calls[0]?.arguments as any).start === 'string');
  assert.equal(calls[1]?.name, 'query-metrics');
  assert.equal((calls[1]?.arguments as any).step, 60);
});
