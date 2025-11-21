import { randomUUID } from 'node:crypto';
import { McpClient } from '../mcpClient.js';
import {
  CopilotAnswer,
  RuntimeConfig,
  Tool, // Added Tool import
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

import { ResultCache } from './resultCache.js';
import { ConversationManager } from './conversationManager.js';
import { ChatNamer } from './chatNamer.js';

const DEFAULT_MAX_ITERATIONS = 3;
const MAX_TOOL_CALLS_PER_ITERATION = 3;

/**
 * CopilotEngine orchestrates the end-to-end flow of answering operational questions.
 *
 * Flow:
 * 1. Load available MCP tools
 * 2. Generate or retrieve chatId for conversation tracking
 * 3. Retrieve conversation history (if continuing conversation)
 * 4. Enter Reasoning Loop (Agentic Loop):
 *    a. Plan tools (Initial or Follow-up)
 *    b. Apply heuristics
 *    c. Execute tools
 *    d. Accumulate results
 *    e. Repeat until no more tools needed or max iterations reached
 * 5. Synthesize final answer from all tool results
 * 6. Save conversation turn for future reference
 */
export class CopilotEngine {
  private readonly mcp: McpClient;
  private toolsLoaded = false;
  private toolsCache =
    [] as ReturnType<McpClient['listTools']> extends Promise<infer T> ? T : never;
  private readonly resultCache: ResultCache;
  private readonly conversationManager: ConversationManager;
  private readonly chatNamer: ChatNamer;
  private readonly maxIterations: number;

  constructor(private readonly config: RuntimeConfig) {
    this.mcp = new McpClient(config.mcpUrl);
    this.resultCache = new ResultCache();
    this.conversationManager = new ConversationManager();
    this.chatNamer = new ChatNamer();
    this.maxIterations = config.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  }

  /**
   * Ensure MCP tools are loaded and cached.
   * This is called once per session to avoid repeated tool list requests.
   */
  async ensureTools(): Promise<void> {
    if (this.toolsLoaded) return;
    this.toolsCache = await this.mcp.listTools();
    this.toolsLoaded = true;
  }

  /**
   * Check if a specific tool is available.
   */
  private hasTool(toolName: string): boolean {
    return this.toolsCache.some((t) => t.name === toolName);
  }

  /**
   * Limit tool calls per iteration to prevent excessive MCP requests.
   */
  private limitToolCalls(calls: ToolCall[]): ToolCall[] {
    if (calls.length <= MAX_TOOL_CALLS_PER_ITERATION) return calls;
    console.warn(
      `Trimming tool plan to first ${MAX_TOOL_CALLS_PER_ITERATION} calls (received ${calls.length}).`,
    );
    return calls.slice(0, MAX_TOOL_CALLS_PER_ITERATION);
  }

  /**
   * Execute tool calls with caching support to avoid redundant requests.
   */
  private async runToolCallsWithCache(
    calls: ToolCall[],
    chatId: string,
    tools: Tool[]
  ): Promise<ToolResult[]> {
    const results: ToolResult[] = [];
    const callsToExecute: ToolCall[] = [];

    // Step 1: Check cache for each call
    for (const call of calls) {
      const cached = this.resultCache.get(call);
      if (cached) {
        console.log(`[Copilot][${chatId}] Using cached result for ${call.name}`);
        results.push(cached);
      } else {
        callsToExecute.push(call);
      }
    }

    // Step 2: Execute uncached calls
    if (callsToExecute.length > 0) {
      const freshResults = await runToolCalls(
        callsToExecute,
        this.mcp,
        chatId,
        tools,
      );

      // Step 3: Cache successful results and add to results array
      for (let i = 0; i < callsToExecute.length; i++) {
        const result = freshResults[i];
        if (!result) continue; // Skip if somehow undefined

        // Only cache if not an error
        if (
          typeof result.result === 'object' &&
          result.result !== null &&
          !('error' in result.result)
        ) {
          this.resultCache.set(callsToExecute[i], result);
        }
        results.push(result);
      }
    }

    return results;
  }

  /**
   * Expose conversation manager for API access to chat history.
   */
  getConversationManager(): ConversationManager {
    return this.conversationManager;
  }

  /**
   * Main entry point: answer a user question using MCP tools.
   */
  async answer(question: string, opts?: { chatId?: string }): Promise<CopilotAnswer> {
    // Step 1: Ensure tools are loaded
    await this.ensureTools();

    // Step 2: Generate or use provided chatId
    const chatId = opts?.chatId ?? randomUUID();

    console.log(`[Copilot][${chatId}] Received question: ${question}`);

    // Periodic cache cleanup
    this.resultCache.clearExpired();
    await this.conversationManager.clearExpired();

    // Step 3: Retrieve conversation history
    const conversationHistory = await this.conversationManager.buildMessageHistory(chatId);
    const isNewConversation = conversationHistory.length === 0;

    if (!isNewConversation) {
      console.log(`[Copilot][${chatId}] Continuing conversation with ${conversationHistory.length} previous messages`);
    } else {
      console.log(`[Copilot][${chatId}] Starting new conversation`);
    }

    const log = (msg: string) => console.log(`[Copilot][${chatId}] ${msg}`);

    const allResults: ToolResult[] = [];
    let iteration = 0;
    let isFirstIteration = true;

    // Step 4: Reasoning Loop
    while (iteration < this.maxIterations) {
      iteration++;
      log(`Starting iteration ${iteration}/${this.maxIterations}`);

      let plannedCalls: ToolCall[] = [];

      // A. Plan
      if (isFirstIteration && isNewConversation) {
        // Initial plan for new conversation
        const plan = await requestInitialPlan(
          question,
          this.config.llm,
          this.toolsCache,
          conversationHistory,
        );
        plannedCalls = plan.toolCalls ?? [];

        // Apply heuristics only on initial plan
        plannedCalls = applyQuestionHeuristics(
          question,
          plannedCalls,
          (name) => this.hasTool(name),
          conversationHistory,
          (msg) => log(msg)
        );
      } else {
        // Follow-up plan (or initial plan for continued conversation)
        // Filter out error results for planning context to avoid confusing the LLM
        const successfulResults = allResults.filter(r => r && !(r.result && typeof r.result === 'object' && 'error' in r.result));

        const plan = await requestFollowUpPlan(
          question,
          this.config.llm,
          this.toolsCache,
          successfulResults,
          conversationHistory,
        );
        plannedCalls = plan.toolCalls ?? [];

        // Apply follow-up heuristics
        plannedCalls = applyFollowUpHeuristics({
          question,
          results: successfulResults,
          proposed: plannedCalls,
          hasTool: (name) => this.hasTool(name),
          maxToolCalls: MAX_TOOL_CALLS_PER_ITERATION,
          logger: (msg) => log(msg),
        });
      }

      // Limit calls
      plannedCalls = this.limitToolCalls(plannedCalls);

      // B. Check Stop Condition
      if (plannedCalls.length === 0) {
        log('Planner produced no tool calls. Stopping loop.');
        break;
      }

      log(`Planner proposed ${plannedCalls.length} call(s): ${plannedCalls.map(c => c.name).join(', ')}`);

      // C. Execute
      const results = await this.runToolCallsWithCache(
        plannedCalls,
        chatId,
        this.toolsCache,
      );

      // D. Accumulate
      allResults.push(...results);
      isFirstIteration = false;

      // If all tools failed, we might want to stop or let the planner try again.
      // For now, we continue and let the planner see the errors in the next iteration (if we passed them).
      // Note: We currently filter errors out of the planner context in the next loop, 
      // so the planner might just retry or give up. 
      // Improvement: We could pass errors to the planner so it knows what failed.
      // But per current logic, we only pass successful results to requestFollowUpPlan.

      const successfulCount = results.filter(
        (r) =>
          !(
            r.result &&
            typeof r.result === 'object' &&
            'error' in r.result
          ),
      ).length;
      if (successfulCount === 0 && results.length > 0) {
        log('All tools in this iteration failed.');
        // If everything failed, maybe we should stop to avoid infinite error loops?
        // Or maybe the heuristics will try something else?
        // For safety, if we have 0 successes in this batch, let's break to avoid thrashing,
        // UNLESS we want to allow retries. 
        // Let's stick to the loop limit for safety.
      }
    }

    if (iteration >= this.maxIterations) {
      log(`Reached maximum iterations (${this.maxIterations}). Stopping.`);
    }

    // Step 5: Synthesize final answer
    const answer = await synthesizeCopilotAnswer(
      question,
      allResults,
      chatId,
      this.config.llm,
    );

    // Step 6: Save conversation turn
    await this.conversationManager.addTurn(
      chatId,
      question,
      allResults,
      answer.conclusion
    );

    // Step 7: Generate or update conversation name
    // Always regenerate name to reflect the evolving conversation
    try {
      const conversationName = this.chatNamer.generateName(question, Date.now());
      await this.conversationManager.setConversationName(chatId, conversationName);
      log(`${isNewConversation ? 'Generated' : 'Updated'} conversation name: "${conversationName}"`);
    } catch (error) {
      log(`Failed to ${isNewConversation ? 'generate' : 'update'} conversation name: ${error}`);
      // Continue even if naming fails - conversation is still valid
    }

    log(`Conversation stats: ${JSON.stringify(await this.conversationManager.stats())}`);

    return {
      ...answer,
      chatId,
    };
  }
}
