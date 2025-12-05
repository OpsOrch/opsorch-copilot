import { randomUUID } from "node:crypto";
import { McpFactory } from "../mcpFactory.js";
import type { McpClient } from "../mcpClient.js";
import {
  CopilotAnswer,
  Entity,
  JsonObject,
  RuntimeConfig,
  Tool, // Added Tool import
  ToolCall,
  ToolResult,
} from "../types.js";
import { requestFollowUpPlan, requestInitialPlan } from "./planner.js";
import { synthesizeCopilotAnswer } from "./synthesis.js";
import { runToolCalls } from "./toolRunner.js";

import { ResultCache } from "./resultCache.js";
import { ConversationManager } from "./conversationManager.js";
import { ChatNamer } from "./chatNamer.js";
import { ExecutionTracer } from "./executionTracer.js";
import { ExecutionTrace } from "../types.js";
import { EntityExtractor } from "./entityExtractor.js";
import { ParallelToolRunner } from "./parallelToolRunner.js";
import { ReferenceResolver } from "./referenceResolver.js";
import { FollowUpEngine } from "./followUpEngine.js";
import { PlanRefiner } from "./planRefiner.js";
import { ScopeInferer } from "./scopeInferer.js";
import {
  entityRegistry,
  followUpRegistry,
  referenceRegistry,
} from "./capabilityRegistry.js";

const DEFAULT_MAX_ITERATIONS = 3;
const MAX_TOOL_CALLS_PER_ITERATION = 5;

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
  private readonly resultCache: ResultCache;
  private readonly conversationManager: ConversationManager;
  private readonly chatNamer: ChatNamer;
  private readonly executionTracer: ExecutionTracer;
  private readonly entityExtractor: EntityExtractor;
  private readonly referenceResolver: ReferenceResolver;
  private readonly parallelToolRunner: ParallelToolRunner;
  private readonly followUpEngine: FollowUpEngine;
  private readonly planRefiner: PlanRefiner;
  private readonly scopeInferer: ScopeInferer;
  private readonly maxIterations: number;

  constructor(private readonly config: RuntimeConfig) {
    this.mcp = McpFactory.create(config);
    this.resultCache = new ResultCache();
    this.conversationManager = new ConversationManager();
    this.chatNamer = new ChatNamer();
    this.executionTracer = new ExecutionTracer();
    this.entityExtractor = new EntityExtractor(entityRegistry);
    this.referenceResolver = new ReferenceResolver(referenceRegistry);
    this.parallelToolRunner = new ParallelToolRunner();
    this.scopeInferer = new ScopeInferer();
    this.followUpEngine = new FollowUpEngine(followUpRegistry);
    this.planRefiner = new PlanRefiner(this.scopeInferer);
    this.maxIterations = config.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  }

  /**
   * Ensure MCP tools are loaded and cached.
   * This is called once per session to avoid repeated tool list requests.
   */
  async ensureTools(): Promise<void> {
    await this.mcp.ensureTools();
  }

  /**
   * Filter out internal diagnostic tools that shouldn't be called by the LLM.
   * These tools are for system health checks, not for answering user questions.
   */
  private filterToolsForLLM(tools: Tool[]): Tool[] {
    const INTERNAL_TOOLS = ["health"];
    return tools.filter((tool) => !INTERNAL_TOOLS.includes(tool.name));
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
   * Format tool results for LLM planning context, including error information.
   * This helps the LLM learn from failures and adjust strategy.
   */
  private formatResultsForPlanning(results: ToolResult[]): ToolResult[] {
    return results.map((result) => {
      const isError =
        typeof result.result === "object" &&
        result.result !== null &&
        "error" in result.result;

      if (!isError) {
        return result; // Pass successful results as-is
      }

      // Format error results with helpful context
      const errorObj = result.result as { error: string | JsonObject };
      const errorMessage =
        typeof errorObj.error === "string"
          ? errorObj.error
          : JSON.stringify(errorObj.error);

      return {
        ...result,
        result: {
          error: errorMessage,
          context: `Tool '${result.name}' failed. Consider trying an alternative approach or adjusting parameters.`,
          originalArguments: result.arguments || {},
        },
      };
    });
  }

  /**
   * Execute tool calls with caching support to avoid redundant requests.
   */
  private async runToolCallsWithCache(
    calls: ToolCall[],
    chatId: string,
    tools: Tool[],
    trace?: ExecutionTrace,
  ): Promise<ToolResult[]> {
    const results: ToolResult[] = [];
    const callsToExecute: ToolCall[] = [];

    // Step 1: Check cache for each call
    for (const call of calls) {
      const cached = this.resultCache.get(call);
      if (cached) {
        console.log(
          `[Copilot][${chatId}] Using cached result for ${call.name}`,
        );
        results.push(cached);

        // Record cache hit in trace
        if (trace) {
          const resultSize = JSON.stringify(cached.result).length;
          this.executionTracer.recordToolExecution(trace, {
            toolName: call.name,
            cacheHit: true,
            executionTimeMs: 0,
            resultSizeBytes: resultSize,
            success: true,
          });
        }
      } else {
        callsToExecute.push(call);
      }
    }

    // Step 2: Execute uncached calls (with parallel execution where possible)
    if (callsToExecute.length > 0) {
      const executionStart = Date.now();

      // Analyze dependencies and execute in parallel where possible
      const dependencies =
        this.parallelToolRunner.analyzeDependencies(callsToExecute);
      const canParallelize = dependencies.every(
        (d) => d.dependsOn.length === 0,
      );

      let freshResults: ToolResult[];
      if (canParallelize && callsToExecute.length > 1) {
        console.log(
          `[Copilot][${chatId}] Executing ${callsToExecute.length} tools in parallel (no dependencies)`,
        );
        freshResults = await this.parallelToolRunner.executeWithDependencies(
          dependencies,
          this.mcp,
          chatId,
          tools,
        );
      } else if (callsToExecute.length > 1) {
        console.log(
          `[Copilot][${chatId}] Executing ${callsToExecute.length} tools with dependency ordering`,
        );
        freshResults = await this.parallelToolRunner.executeWithDependencies(
          dependencies,
          this.mcp,
          chatId,
          tools,
        );
      } else {
        // Single tool - execute directly
        freshResults = await runToolCalls(
          callsToExecute,
          this.mcp,
          chatId,
          tools,
        );
      }

      const executionTime = Date.now() - executionStart;

      // Step 3: Cache successful results and add to results array
      for (let i = 0; i < callsToExecute.length; i++) {
        const result = freshResults[i];
        if (!result) continue; // Skip if somehow undefined

        const isError =
          typeof result.result === "object" &&
          result.result !== null &&
          "error" in result.result;

        // Only cache if not an error
        if (!isError) {
          this.resultCache.set(callsToExecute[i], result);
        }

        // Record tool execution in trace
        if (trace) {
          const resultSize = JSON.stringify(result.result).length;
          this.executionTracer.recordToolExecution(trace, {
            toolName: callsToExecute[i].name,
            cacheHit: false,
            executionTimeMs: Math.round(executionTime / callsToExecute.length), // Approximate per-tool time
            resultSizeBytes: resultSize,
            success: !isError,
            error: isError ? String((result.result as { error: string }).error) : undefined,
          });
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
  async answer(
    question: string,
    opts?: { chatId?: string },
  ): Promise<CopilotAnswer> {
    // Step 1: Ensure tools are loaded
    await this.ensureTools();

    // Step 2: Generate or use provided chatId
    const chatId = opts?.chatId ?? randomUUID();

    // Step 3: Start execution trace
    const trace = this.executionTracer.startTrace(chatId);

    console.log(`[Copilot][${chatId}] Received question: ${question}`);

    // Periodic cache cleanup
    this.resultCache.clearExpired();
    await this.conversationManager.clearExpired();

    // Step 3: Retrieve conversation history
    const conversationHistory =
      await this.conversationManager.buildMessageHistory(chatId);
    const conversation = await this.conversationManager.getConversation(chatId);
    const conversationTurns = conversation?.turns || [];
    const isNewConversation = conversationHistory.length === 0;

    if (!isNewConversation) {
      console.log(
        `[Copilot][${chatId}] Continuing conversation with ${conversationHistory.length} previous messages`,
      );
    } else {
      console.log(`[Copilot][${chatId}] Starting new conversation`);
    }

    // Step 4: Get entities from conversation and resolve references in question
    const entityContext = await this.conversationManager.getEntities(chatId);
    const resolutions = await this.referenceResolver.resolveReferences(
      question,
      entityContext,
    );
    const resolvedQuestion = this.referenceResolver.applyResolutions(
      question,
      resolutions,
    );

    if (resolutions.size > 0) {
      console.log(
        `[Copilot][${chatId}] Resolved ${resolutions.size} entity reference(s) in question`,
      );
    }

    // Use resolved question for planning
    const questionForPlanning = resolvedQuestion;

    const allResults: ToolResult[] = [];
    const allExtractedEntities: Entity[] = [];
    let iteration = 0;
    let isFirstIteration = true;

    // Step 4: Reasoning Loop
    while (iteration < this.maxIterations) {
      iteration++;
      console.log(
        `[Copilot][${chatId}] Starting iteration ${iteration}/${this.maxIterations}`,
      );

      let plannedCalls: ToolCall[] = [];

      // A. Plan
      if (isFirstIteration) {
        // Initial plan (whether new or continued conversation)
        // We treat the start of any turn as an "initial plan" for that specific question,
        // utilizing conversation history for context.
        const plan = await requestInitialPlan(
          questionForPlanning,
          this.config.llm,
          this.filterToolsForLLM(this.mcp.getTools()),
          conversationHistory,
        );
        plannedCalls = plan.toolCalls ?? [];

        // Record iteration start with planned tools
        this.executionTracer.startIteration(trace, plannedCalls);

        // Apply heuristics only on initial plan
        const beforeHeuristics = plannedCalls.length;
        plannedCalls = await this.planRefiner.applyHeuristics(
          questionForPlanning,
          plannedCalls,
          this.mcp,
          conversationTurns,
          allResults, // Pass accumulated results for entity extraction
        );

        // Record heuristic modifications
        if (plannedCalls.length !== beforeHeuristics) {
          this.executionTracer.recordHeuristic(trace, {
            heuristicName: "questionHeuristics",
            action: "inject",
            reason: "Applied question pattern matching heuristics",
            affectedTools: plannedCalls.map((c) => c.name),
          });
        }
      } else {
        // Follow-up plan (or initial plan for continued conversation)
        // Format all results (including errors) for LLM context
        const formattedResults = this.formatResultsForPlanning(allResults);

        const plan = await requestFollowUpPlan(
          questionForPlanning,
          this.config.llm,
          this.filterToolsForLLM(this.mcp.getTools()),
          formattedResults,
          conversationHistory,
        );
        plannedCalls = plan.toolCalls ?? [];

        // Record iteration start with planned tools
        this.executionTracer.startIteration(trace, plannedCalls);

        // Apply follow-up heuristics
        const beforeHeuristics = plannedCalls.length;
        const followUpSuggestions = await this.followUpEngine.applyFollowUps(
          formattedResults,
          chatId,
          conversationTurns,
          questionForPlanning,
        );
        plannedCalls.push(...followUpSuggestions);

        // Record heuristic modifications
        if (plannedCalls.length !== beforeHeuristics) {
          this.executionTracer.recordHeuristic(trace, {
            heuristicName: "followUpHeuristics",
            action: "modify",
            reason: "Applied context-aware follow-up heuristics",
            affectedTools: plannedCalls.map((c) => c.name),
          });
        }
      }

      // Validate and fix calls (ensures required args like start/end/step are present for metrics)
      plannedCalls = await this.planRefiner.refineCalls(
        plannedCalls,
        this.mcp.getTools(),
      );

      // Limit calls
      plannedCalls = this.limitToolCalls(plannedCalls);

      // B. Check Stop Condition
      if (plannedCalls.length === 0) {
        console.log(
          `[Copilot][${chatId}] Planner produced no tool calls. Stopping loop.`,
        );
        console.log(
          `[Copilot][${chatId}] Diagnostic: Iteration ${iteration}, isFirstIteration=${isFirstIteration}, accumulated results=${allResults.length}`,
        );
        break;
      }

      console.log(
        `[Copilot][${chatId}] Planner proposed ${plannedCalls.length} call(s): ${plannedCalls.map((c) => c.name).join(", ")}`,
      );
      console.log(
        `[Copilot][${chatId}] Diagnostic: About to execute ${plannedCalls.length} tool call(s)`,
      );

      // C. Execute
      const results = await this.runToolCallsWithCache(
        plannedCalls,
        chatId,
        this.mcp.getTools(),
        trace,
      );

      // D. Accumulate
      allResults.push(...results);
      isFirstIteration = false;

      // E. Extract entities from results
      const extractedEntities = await this.entityExtractor.extractFromResults(
        results,
        chatId,
        conversationTurns,
      );

      // On the first iteration of a follow-up question, boost prominence of entities
      // mentioned in the previous conversation turn's conclusion
      if (iteration === 1 && !isNewConversation) {
        const conversation =
          await this.conversationManager.getConversation(chatId);
        const lastTurn = conversation?.turns[conversation.turns.length - 1];

        if (lastTurn?.assistantResponse) {
          const prominenceBoosts =
            this.entityExtractor.extractPrimaryEntitiesFromConclusion(
              lastTurn.assistantResponse,
              extractedEntities,
            );

          // Apply prominence scores to extracted entities
          for (const entity of extractedEntities) {
            const boost = prominenceBoosts.get(entity.value);
            if (boost !== undefined) {
              entity.prominence = boost;
            }
          }

          if (prominenceBoosts.size > 0) {
            console.log(
              `[Copilot][${chatId}] Applied prominence boosts to ${prominenceBoosts.size} entity/entities based on previous conclusion`,
            );
          }
        }
      }

      if (extractedEntities.length > 0) {
        console.log(
          `[Copilot][${chatId}] Extracted ${extractedEntities.length} entity/entities from iteration ${iteration}`,
        );
        allExtractedEntities.push(...extractedEntities);
      }

      // F. Complete iteration trace
      this.executionTracer.completeIteration(trace);

      // If all tools failed, we might want to stop or let the planner try again.
      // For now, we continue and let the planner see the errors in the next iteration (if we passed them).
      // Note: We currently filter errors out of the planner context in the next loop,
      // so the planner might just retry or give up.
      // Improvement: We could pass errors to the planner so it knows what failed.
      // But per current logic, we only pass successful results to requestFollowUpPlan.

      const successfulCount = results.filter(
        (r) =>
          !(r.result && typeof r.result === "object" && "error" in r.result),
      ).length;
      if (successfulCount === 0 && results.length > 0) {
        console.log(`[Copilot][${chatId}] All tools in this iteration failed.`);
        // If everything failed, maybe we should stop to avoid infinite error loops?
        // Or maybe the heuristics will try something else?
        // For safety, if we have 0 successes in this batch, let's break to avoid thrashing,
        // UNLESS we want to allow retries.
        // Let's stick to the loop limit for safety.
      }
    }

    if (iteration >= this.maxIterations) {
      console.log(
        `[Copilot][${chatId}] Reached maximum iterations (${this.maxIterations}). Stopping.`,
      );
    }

    // Step 5: Synthesize final answer
    const answer = await synthesizeCopilotAnswer(
      question,
      allResults,
      chatId,
      this.config.llm,
    );

    // Step 6: Save conversation turn with extracted entities
    await this.conversationManager.addTurn(
      chatId,
      question,
      allResults,
      answer.conclusion,
      allExtractedEntities,
    );

    // Step 7: Generate conversation name for new conversations only
    if (isNewConversation) {
      try {
        const conversationName = this.chatNamer.generateName(
          question,
          answer.conclusion,
          Date.now(),
          allExtractedEntities,
        );
        await this.conversationManager.setConversationName(
          chatId,
          conversationName,
        );
        console.log(
          `[Copilot][${chatId}] Generated conversation name: "${conversationName}"`,
        );
      } catch (error) {
        console.log(
          `[Copilot][${chatId}] Failed to generate conversation name: ${error}`,
        );
        // Continue even if naming fails - conversation is still valid
      }
    }

    console.log(
      `[Copilot][${chatId}] Conversation stats: ${JSON.stringify(await this.conversationManager.stats())}`,
    );

    // Step 8: Complete execution trace
    this.executionTracer.completeTrace(trace, {
      ...answer,
      chatId,
    });

    const finalAnswer = {
      ...answer,
      chatId,
    };
    console.log(
      `[Copilot][${chatId}] Returning answer with chatId: ${finalAnswer.chatId}`,
    );

    return finalAnswer;
  }
}
