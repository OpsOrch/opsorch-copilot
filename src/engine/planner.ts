import { randomUUID } from 'node:crypto';
import {
  LlmClient,
  LlmMessage,
  Tool,
  ToolCall,
  ToolResult,
} from '../types.js';
import {
  buildJsonPlannerPrompt,
  buildPlannerPrompt,
  buildRefinementPrompt,
  buildToolContext,
} from '../prompts.js';
import { inferPlanFromQuestion } from './planFallback.js';

export type PlannerResponse = {
  toolCalls: ToolCall[];
  chatId: string;
};

const MAX_PLANNER_CALLS = 3;

export async function requestInitialPlan(
  question: string,
  llm: LlmClient,
  tools: Tool[],
  chatId?: string,
): Promise<PlannerResponse> {
  const toolContext = buildToolContext(tools);
  const messages: LlmMessage[] = [
    { role: 'system', content: buildPlannerPrompt(toolContext) },
    { role: 'user', content: question },
  ];

  try {
    const reply = await llm.chat(
      messages,
      tools,
      chatId ? { chatId } : undefined,
    );

    if (reply.toolCalls?.length) {
      return {
        toolCalls: limitCalls(reply.toolCalls),
        chatId: reply.chatId
      };
    }

    // If the model didn't use tools directly, fall back to JSON-planned tool calls
    return await requestJsonPlan(
      question,
      llm,
      tools,
      reply.chatId
    );
  } catch (err) {
    console.warn('LLM planning failed, falling back to heuristics:', err);
    return {
      toolCalls: inferPlan(question),
      chatId: randomUUID(),
    };
  }
}

export async function requestFollowUpPlan(
  question: string,
  llm: LlmClient,
  tools: Tool[],
  priorResults: ToolResult[],
  chatId: string,
): Promise<PlannerResponse> {
  const toolContext = buildToolContext(tools);
  const resultSummary = summarizeResults(priorResults) || 'No tool results yet.';

  const messages: LlmMessage[] = [
    {
      role: 'system',
      content: buildRefinementPrompt(toolContext, priorResults.length),
    },
    {
      role: 'user',
      content:
        `Question: ${question}\n` +
        `Tool results (count=${priorResults.length}):\n` +
        `${resultSummary}\n` +
        `Plan follow-up tool calls with concrete arguments.`,
    },
  ];

  try {
    const reply = await llm.chat(
      messages,
      tools,
      { chatId },
    );

    return {
      toolCalls: limitCalls(reply.toolCalls ?? []),
      chatId: reply.chatId,
    };
  } catch (err) {
    console.warn('LLM refinement failed; skipping follow-up plan:', err);
    return { toolCalls: [], chatId };
  }
}

async function requestJsonPlan(
  question: string,
  llm: LlmClient,
  tools: Tool[],
  chatId: string,
): Promise<PlannerResponse> {
  const toolList = tools.map((t) => `- ${t.name}`).join('\n') || 'No tools.';
  const messages: LlmMessage[] = [
    { role: 'system', content: buildJsonPlannerPrompt(toolList) },
    { role: 'user', content: `User request: ${question}\nReturn only JSON.` },
  ];

    try {
    const reply = await llm.chat(
      messages,
      [],
      { chatId },
    );

    const parsedCalls = parseToolCalls(reply.content);
    if (parsedCalls.length) {
      return {
        toolCalls: limitCalls(parsedCalls),
        chatId: reply.chatId,
      }
    }
  } catch (err) {
    console.warn('LLM JSON planner failed:', err);
  }

  return {
    toolCalls: inferPlan(question),
    chatId
  };
}

function parseToolCalls(raw?: string): ToolCall[] {
  if (!raw) return [];
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return [];

  try {
    const parsed = JSON.parse(jsonMatch[0] || '{}') as {
      toolCalls?: Array<{ name?: string; arguments?: any }>;
    };

    const calls = Array.isArray(parsed.toolCalls) ? parsed.toolCalls : [];
    return calls
      .map((call) => {
        if (!call?.name || typeof call.name !== 'string') return undefined;
        const args =
          call.arguments &&
          typeof call.arguments === 'object' &&
          !Array.isArray(call.arguments)
            ? call.arguments
            : {};
        return { name: call.name, arguments: args } as ToolCall;
      })
      .filter(Boolean) as ToolCall[];
  } catch {
    return [];
  }
}

function limitCalls(calls: ToolCall[]): ToolCall[] {
  if (!calls.length) return [];
  return calls.slice(0, MAX_PLANNER_CALLS);
}

function inferPlan(question: string): ToolCall[] {
  return inferPlanFromQuestion(question).slice(0, MAX_PLANNER_CALLS);
}

function summarizeResults(results: ToolResult[]): string {
  return results
    .map((r) => {
      const payload =
        typeof r.result === 'string' ? r.result : JSON.stringify(r.result);
      const trimmed = payload.length > 600 ? `${payload.slice(0, 600)}…` : payload;
      return `${r.name}: ${trimmed}`;
    })
    .join('\n');
}

