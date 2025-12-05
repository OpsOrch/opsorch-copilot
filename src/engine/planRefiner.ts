import { ToolCall, ToolResult, Tool, ConversationTurn } from "../types.js";
import { McpClient } from "../mcpClient.js";
import { ScopeInferer } from "./scopeInferer.js";
import { validateToolCall } from "./toolsSchema.js";
import { validationRegistry, intentRegistry, queryBuilderRegistry } from "./capabilityRegistry.js";
import { HandlerContext } from "../types.js";

export class PlanRefiner {
  constructor(private scopeInferer: ScopeInferer) {
  }

  async refineCalls(
    calls: ToolCall[],
    tools: Tool[], // Pass tools explicitly to avoid extra calls
  ): Promise<ToolCall[]> {
    const validatedCalls: Array<{ call: ToolCall; valid: boolean }> = [];

    for (const call of calls) {
      const tool = tools.find((t) => t.name === call.name);
      if (!tool) {
        validatedCalls.push({ call, valid: false });
        continue;
      }

      // Create handler context
      const context: HandlerContext = {
        chatId: "plan-refinement",
        turnNumber: 0,
        conversationHistory: [],
        toolResults: [],
        userQuestion: "", // Context not strictly needed for this validation pass
      };

      // Use ValidationRegistry to validate and refine (fix) the call
      const validation = await validationRegistry.execute(
        context,
        tool.name,
        call.arguments,
      );

      // Also run basic schema validation as a fallback/safety check
      const schemaValidation = validateToolCall(call, tool);

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
      } else {
        // Validation failed
        validatedCalls.push({ call, valid: false });
      }
    }

    return validatedCalls.filter((v) => v.valid).map((v) => v.call);
  }

  async applyHeuristics(
    question: string,
    calls: ToolCall[],
    mcp: McpClient,
    conversationHistory: ConversationTurn[] = [],
    previousResults?: ToolResult[],
  ): Promise<ToolCall[]> {
    const tools = await mcp.listTools();

    // 1. Validate LLM Plan and strip null fields
    let augmented = await this.refineCalls(calls, tools);


    // 2. Explicit request checks (Missing Tools Heuristic) via Intent Registry
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

        // Only add if we successfully built args
        if (args && Object.keys(args).length > 0) {
          augmented.push({
            name: suggestedTool,
            arguments: args
          });
        }
      }
    }

    // 3. Apply scope inference if available (using conversation history for context)
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
