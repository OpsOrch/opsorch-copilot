import { McpClient } from '../mcpClient.js';
import {
  CopilotAnswer,
  RuntimeConfig,
  ToolCall,
  ToolResult,
} from '../types.js';
import { applyFollowUpHeuristics } from './followUpHeuristics.js';
import {
  requestFollowUpPlan,
  requestInitialPlan,
} from './planner.js';
import { applyQuestionHeuristics } from './questionHeuristics.js';
import { synthesizeCopilotAnswer } from './synthesis.js';
import { runToolCalls } from './toolRunner.js';
import { createMissingArgChecker } from './toolsSchema.js';

const MAX_TOOL_CALLS_PER_ITERATION = 3;

export class CopilotEngine {
  private readonly mcp: McpClient;
  private toolsLoaded = false;
  private toolsCache =
    [] as ReturnType<McpClient['listTools']> extends Promise<infer T> ? T : never;

  constructor(private readonly config: RuntimeConfig) {
    this.mcp = new McpClient(config.mcpUrl);
  }

  async ensureTools(): Promise<void> {
    if (this.toolsLoaded) return;
    this.toolsCache = await this.mcp.listTools();
    this.toolsLoaded = true;
  }

  private hasTool(toolName: string): boolean {
    return this.toolsCache.some((t) => t.name === toolName);
  }

  private limitToolCalls(calls: ToolCall[]): ToolCall[] {
    if (calls.length <= MAX_TOOL_CALLS_PER_ITERATION) return calls;
    console.warn(
      `Trimming tool plan to first ${MAX_TOOL_CALLS_PER_ITERATION} calls (received ${calls.length}).`,
    );
    return calls.slice(0, MAX_TOOL_CALLS_PER_ITERATION);
  }

  async answer(question: string, opts?: { chatId?: string }): Promise<CopilotAnswer> {
    await this.ensureTools();
    let chatId = opts?.chatId;
    
    console.log(`Received question: ${question}`);

    const initialPlan = chatId
      ? await requestFollowUpPlan(
          question,
          this.config.llm,
          this.toolsCache,
          [],
          chatId,
        )
      : await requestInitialPlan(
          question,
          this.config.llm,
          this.toolsCache,
          chatId,
        );

    chatId = chatId ?? initialPlan.chatId;
    const log = (msg: string) => console.log(`[Copilot][${chatId}] ${msg}`);

    const missingArgChecker = createMissingArgChecker(this.toolsCache);
    let firstCalls = applyQuestionHeuristics(
      question,
      initialPlan.toolCalls ?? [],
      (name) => this.hasTool(name),
    );
    firstCalls = this.limitToolCalls(firstCalls);

    log(`Initial plan has ${firstCalls.length} tool call(s).`);
    const allResults: ToolResult[] = await runToolCalls(
      firstCalls,
      this.mcp,
      chatId,
      missingArgChecker,
    );

    if (allResults.length) {
      const followUpPlan = await requestFollowUpPlan(
        question,
        this.config.llm,
        this.toolsCache,
        allResults,
        chatId,
      );
      chatId = followUpPlan.chatId ?? chatId;

      const allFollowUpCalls = followUpPlan.toolCalls ?? [];
      let followUpCalls = applyFollowUpHeuristics({
        question,
        results: allResults,
        proposed: allFollowUpCalls,
        hasTool: (name) => this.hasTool(name),
        maxToolCalls: MAX_TOOL_CALLS_PER_ITERATION,
      });
      followUpCalls = this.limitToolCalls(followUpCalls);

      if (followUpCalls.length) {
        log(`Follow-up plan has ${followUpCalls.length} tool call(s).`);
        const followUpResults = await runToolCalls(
          followUpCalls,
          this.mcp,
          chatId,
          missingArgChecker,
        );
        allResults.push(...followUpResults);
      } else if (allFollowUpCalls.length) {
        log('Follow-up plan produced no runnable tool calls.');
      } else {
        log('Follow-up plan produced no tool calls.');
      }
    } else {
      log('No tool results produced; skipping follow-up planning.');
    }

    const answer = await synthesizeCopilotAnswer(
      question,
      allResults,
      chatId,
      this.config.llm,
    );

    return answer;
  }
}
