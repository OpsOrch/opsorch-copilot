import { LlmClient, LlmMessage, Tool, ToolCall, ToolResult } from "../types.js";
import {
  buildJsonPlannerPrompt,
  buildPlannerPrompt,
  buildRefinementPrompt,
  buildToolContext,
} from "../prompts.js";
import { inferPlanFromQuestion } from "./planFallback.js";
import { ContextManager } from "./contextManager.js";
import { PlannerResponse } from "../types.js";

const MAX_PLANNER_CALLS = 3;

export async function requestInitialPlan(
  question: string,
  llm: LlmClient,
  tools: Tool[],
  history: LlmMessage[] = [],
): Promise<PlannerResponse> {
  const toolContext = buildToolContext(tools);
  const messages: LlmMessage[] = [
    { role: "system", content: buildPlannerPrompt(toolContext) },
    ...history,
    { role: "user", content: question },
  ];

  try {
    const reply = await llm.chat(messages, tools);

    // Diagnostic logging for planner
    console.log(
      `[Planner] Initial plan: LLM returned ${reply.toolCalls?.length ?? 0} tool call(s)`,
    );
    if (reply.toolCalls?.length) {
      console.log(
        `[Planner] Initial plan: Tool names: ${reply.toolCalls.map((t) => t.name).join(", ")}`,
      );
      return {
        toolCalls: limitCalls(reply.toolCalls),
      };
    }

    console.log(
      `[Planner] Initial plan: No tool calls from LLM, falling back to JSON plan`,
    );
    // If the model didn't use tools directly, fall back to JSON-planned tool calls
    return await requestJsonPlan(question, llm, tools);
  } catch (err) {
    console.warn("LLM planning failed, falling back to heuristics:", err);
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
  const resultSummary = summarizeResults(results) || "No tool results yet.";

  const messages: LlmMessage[] = [
    {
      role: "system",
      content: buildRefinementPrompt(toolContext, results.length),
    },
    ...history,
    {
      role: "user",
      content:
        `Question: ${question}\n` +
        `Tool results (count=${results.length}):\n` +
        `${resultSummary}\n` +
        `Plan follow-up tool calls with concrete arguments.`,
    },
  ];

  try {
    const reply = await llm.chat(messages, tools);

    // Diagnostic logging for follow-up planner
    console.log(
      `[Planner] Follow-up plan: LLM returned ${reply.toolCalls?.length ?? 0} tool call(s)`,
    );
    if (reply.toolCalls?.length) {
      console.log(
        `[Planner] Follow-up plan: Tool names: ${reply.toolCalls.map((t) => t.name).join(", ")}`,
      );
    }

    if (!reply.toolCalls || reply.toolCalls.length === 0) {
      return { toolCalls: [] };
    }

    return {
      toolCalls: limitCalls(reply.toolCalls),
    };
  } catch (err) {
    console.error("LLM refinement failed; skipping follow-up plan:", err);
    return { toolCalls: [] };
  }
}

async function requestJsonPlan(
  question: string,
  llm: LlmClient,
  tools: Tool[],
): Promise<PlannerResponse> {
  const toolList = tools.map((t) => `- ${t.name}`).join("\n") || "No tools.";
  const messages: LlmMessage[] = [
    { role: "system", content: buildJsonPlannerPrompt(toolList) },
    { role: "user", content: `User request: ${question}\nReturn only JSON.` },
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
    console.warn("LLM JSON planner failed:", err);
  }

  return {
    toolCalls: inferPlan(question),
  };
}

import { HandlerUtils } from "./handlers/utils.js";

function parseToolCalls(raw?: string): ToolCall[] {
  const parsed = HandlerUtils.extractAndParseJson(raw);
  if (!parsed || typeof parsed !== 'object' || !('toolCalls' in parsed) || !Array.isArray(parsed.toolCalls)) {
    return [];
  }

  const calls = parsed.toolCalls as unknown[];
  return calls
    .map((call: unknown) => {
      if (!call || typeof call !== 'object' || !('name' in call)) return undefined;
      const c = call as Record<string, unknown>;
      if (typeof c.name !== "string") return undefined;
      const args =
        c.arguments &&
          typeof c.arguments === "object" &&
          !Array.isArray(c.arguments)
          ? c.arguments as Record<string, unknown>
          : {};
      return { name: c.name, arguments: args } as ToolCall;
    })
    .filter(Boolean) as ToolCall[];
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
