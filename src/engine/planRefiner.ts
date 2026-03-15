import { ToolCall, ToolResult, Tool, ConversationTurn } from "../types.js";
import { McpClient } from "../mcpClient.js";
import { ScopeInferer } from "./scopeInferer.js";
import { validateToolCall } from "./toolsSchema.js";
import { validationRegistry, intentRegistry, queryBuilderRegistry } from "./capabilityRegistry.js";
import { HandlerContext } from "../types.js";
import { getToolKey } from "./toolKeyExtractor.js";

export class PlanRefiner {
  constructor(private scopeInferer: ScopeInferer) { }

  /**
   * Extract keys of already-executed tools from conversation history and current turn results.
   * Used to skip re-suggesting tools that have already been executed.
   */
  private getExecutedToolKeys(
    previousResults: ToolResult[],
    conversationHistory: ConversationTurn[]
  ): Set<string> {
    const keys = new Set<string>();

    // Add tools from current turn's previous results
    for (const result of previousResults) {
      keys.add(getToolKey(result.name, result.arguments));
    }

    // Add tools from conversation history via executionTrace
    for (const turn of conversationHistory) {
      if (turn.executionTrace) {
        for (const iteration of turn.executionTrace.iterations) {
          for (const exec of iteration.toolExecutions) {
            keys.add(getToolKey(exec.toolName, exec.arguments));
          }
        }
      }
    }

    return keys;
  }

  async refineCalls(
    calls: ToolCall[],
    tools: Tool[],
    conversationHistory: ConversationTurn[] = [],
    previousResults: ToolResult[] = [],
  ): Promise<ToolCall[]> {
    const validatedCalls: Array<{ call: ToolCall; valid: boolean }> = [];
    const replacementCalls: ToolCall[] = [];

    for (const call of calls) {
      const tool = tools.find((t) => t.name === call.name);
      if (!tool) {
        validatedCalls.push({ call, valid: false });
        continue;
      }

      // Create handler context with conversation history for proper validation
      const context: HandlerContext = {
        chatId: "plan-refinement",
        turnNumber: conversationHistory.length,
        conversationHistory,
        toolResults: previousResults,
        userQuestion: "",
      };

      // Use ValidationRegistry to validate and refine (fix) the call
      const validation = await validationRegistry.execute(
        context,
        tool.name,
        call.arguments,
      );

      // Also run basic schema validation as a fallback/safety check
      // Use normalizedArgs if available (validation handler may have fixed the args)
      const argsForSchemaValidation = validation.normalizedArgs ?? call.arguments;
      const schemaValidation = validateToolCall({ ...call, arguments: argsForSchemaValidation }, tool);

      if (validation.valid && schemaValidation.valid) {
        // Use normalized (fixed) arguments if available
        if (validation.normalizedArgs) {
          validatedCalls.push({
            call: { ...call, arguments: validation.normalizedArgs },
            valid: true,
          });
        } else {
          validatedCalls.push({ call, valid: true });
        }
      } else if (validation.replacementCall) {
        // Validation failed but a replacement was suggested
        if (tools.some((candidate) => candidate.name === validation.replacementCall?.name)) {
          console.log(`[PlanRefiner] Replacing ${call.name} with ${validation.replacementCall.name}`);
          replacementCalls.push(validation.replacementCall);
        } else {
          console.log(
            `[PlanRefiner] Skipping replacement ${validation.replacementCall.name} for ${call.name} because the tool is unavailable`,
          );
        }
        validatedCalls.push({ call, valid: false });
      } else {
        // Validation failed with no replacement
        validatedCalls.push({ call, valid: false });
      }
    }

    // If any replacements were generated, return replacements + other valid calls.
    // Only the invalid call is replaced; other valid calls (e.g. query-logs) still run.
    const validCalls = validatedCalls.filter((v) => v.valid).map((v) => v.call);
    return [...replacementCalls, ...validCalls];
  }

  async applyHeuristics(
    question: string,
    calls: ToolCall[],
    mcp: McpClient,
    conversationHistory: ConversationTurn[] = [],
    previousResults?: ToolResult[],
  ): Promise<ToolCall[]> {
    const tools = await mcp.listTools();

    // 1. Validate LLM Plan, strip null fields, and handle replacements
    let augmented = await this.refineCalls(calls, tools, conversationHistory, previousResults || []);

    // 2. Get already-executed tool keys to avoid re-suggesting
    const executedKeys = this.getExecutedToolKeys(
      previousResults || [],
      conversationHistory
    );

    // 3. Explicit request checks (Missing Tools Heuristic) via Intent Registry
    // Only apply if no tools are currently planned (LLM returned empty)
    // If the LLM has already planned tools, we defer to its judgment to avoid "hijacking" the plan
    if (augmented.length === 0) {
      const context: HandlerContext = {
        chatId: "plan-refinement",
        turnNumber: conversationHistory.length,
        conversationHistory,
        toolResults: previousResults || [],
        userQuestion: question,
      };

      const intentResult = await intentRegistry.execute(context);

      // Process suggested tools from intent
      for (const suggestedTool of intentResult.suggestedTools) {
        // If suggested tool is available in toolbox but NOT in current plan
        if (
          tools.some((t) => t.name === suggestedTool) &&
          !augmented.some((c) => c.name === suggestedTool)
        ) {
          // Use QueryBuilder to generate arguments
          const args = await queryBuilderRegistry.execute(
            context,
            suggestedTool,
            question
          );

          console.log('[PlanRefiner] QueryBuilder returned args for', suggestedTool, ':', args ? Object.keys(args).length : 0, 'keys');

          // Only add if we successfully built args AND tool wasn't already executed
          if (args && Object.keys(args).length > 0) {
            const key = getToolKey(suggestedTool, args);
            if (executedKeys.has(key)) {
              console.log('[PlanRefiner] Skipping', suggestedTool, '- already executed with same args');
              continue;
            }
            augmented.push({
              name: suggestedTool,
              arguments: args
            });
          }
        }
      }
    }

    // 4. Apply scope inference if available (using conversation history for context)
    const scopeInference = await this.scopeInferer.inferScope(
      question,
      previousResults || [],
      conversationHistory,
      "default",
      conversationHistory.length,
    );
    if (scopeInference) {
      augmented = this.scopeInferer.applyScope(augmented, scopeInference);
    }

    console.log('[PlanRefiner] Returning', augmented.length, 'calls:', augmented.map(c => c.name).join(', '));

    return augmented;
  }
}
