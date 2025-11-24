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
import { ContextManager } from './contextManager.js';

export type PlannerResponse = {
  toolCalls: ToolCall[];
};

const MAX_PLANNER_CALLS = 3;

export async function requestInitialPlan(
  question: string,
  llm: LlmClient,
  tools: Tool[],
  history: LlmMessage[] = [],
): Promise<PlannerResponse> {
  const toolContext = buildToolContext(tools);
  const messages: LlmMessage[] = [
    { role: 'system', content: buildPlannerPrompt(toolContext) },
    ...history,
    { role: 'user', content: question },
  ];

  try {
    const reply = await llm.chat(
      messages,
      tools,
    );

    if (reply.toolCalls?.length) {
      return {
        toolCalls: limitCalls(reply.toolCalls),
      };
    }

    // If the model didn't use tools directly, fall back to JSON-planned tool calls
    return await requestJsonPlan(
      question,
      llm,
      tools,
    );
  } catch (err) {
    console.warn('LLM planning failed, falling back to heuristics:', err);
    return {
      toolCalls: inferPlan(question),
    };
  }
}

export async function requestFollowUpPlan(
  question: string,
  llm: LlmClient,
  tools: Tool[],
  results: ToolResult[],
  history: LlmMessage[] = [],
): Promise<PlannerResponse> {
  const toolContext = buildToolContext(tools);
  const resultSummary = summarizeResults(results) || 'No tool results yet.';

  const messages: LlmMessage[] = [
    {
      role: 'system',
      content: buildRefinementPrompt(toolContext, results.length),
    },
    ...history,
    {
      role: 'user',
      content:
        `Question: ${question}\n` +
        `Tool results (count=${results.length}):\n` +
        `${resultSummary}\n` +
        `Plan follow-up tool calls with concrete arguments.`,
    },
  ];

  try {
    const reply = await llm.chat(messages, tools);

    if (!reply.toolCalls || reply.toolCalls.length === 0) {
      return { toolCalls: [] };
    }

    return {
      toolCalls: limitCalls(reply.toolCalls),
    };
  } catch (err) {
    console.error('LLM refinement failed; skipping follow-up plan:', err);
    return { toolCalls: [] };
  }
}

async function requestJsonPlan(
  question: string,
  llm: LlmClient,
  tools: Tool[],
): Promise<PlannerResponse> {
  const toolList = tools.map((t) => `- ${t.name}`).join('\n') || 'No tools.';
  const messages: LlmMessage[] = [
    { role: 'system', content: buildJsonPlannerPrompt(toolList) },
    { role: 'user', content: `User request: ${question}\nReturn only JSON.` },
  ];

  try {
    const reply = await llm.chat(messages, []);
    const parsed = parseToolCalls(reply.content);
    if (parsed.length) {
      return {
        toolCalls: limitCalls(parsed),
      };
    }
    return { toolCalls: [] };
  } catch (err) {
    console.warn('LLM JSON planner failed:', err);
  }

  return {
    toolCalls: inferPlan(question),
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

const contextManager = new ContextManager();

function summarizeResults(results: ToolResult[]): string {
  // Use ContextManager for intelligent condensation that preserves structure
  // Allocate ~2000 tokens for results (leaves room for prompts and conversation history)
  return contextManager.condenseResults(results, 2000);
}
