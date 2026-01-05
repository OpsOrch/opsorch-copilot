import { ToolCall, ToolResult, ConversationTurn } from "../types.js";
import { FollowUpRegistry } from "./handlers/index.js";
import { HandlerContext } from "../types.js";
import { getToolKey } from "./toolKeyExtractor.js";

/**
 * Handler-based FollowUpEngine that uses programmatic follow-up handlers
 * instead of configuration-driven follow-up suggestions.
 */
export class FollowUpEngine {
  constructor(private followUpRegistry: FollowUpRegistry) {}

  /**
   * Apply follow-up suggestions based on tool results using handlers
   */
  async applyFollowUps(
    toolResults: ToolResult[],
    chatId: string,
    conversationHistory: ConversationTurn[] = [],
    userQuestion: string = "",
  ): Promise<ToolCall[]> {
    const allSuggestions: ToolCall[] = [];

    for (const result of toolResults) {
      if (this.followUpRegistry.hasHandlers(result.name)) {
        const context = this.buildHandlerContext(
          result,
          chatId,
          conversationHistory,
          userQuestion,
        );

        try {
          const suggestions = await this.followUpRegistry.execute(
            context,
            result,
          );
          allSuggestions.push(...suggestions);
        } catch (error) {
          console.error(`Follow-up handler error for ${result.name}:`, error);
          // Continue with other handlers
        }
      }
    }

    return this.deduplicateAndPrioritize(
      allSuggestions,
      conversationHistory,
      toolResults,
    );
  }

  /**
   * Build handler context for follow-up handlers
   */
  private buildHandlerContext(
    result: ToolResult,
    chatId: string,
    conversationHistory: ConversationTurn[],
    userQuestion: string,
  ): HandlerContext {
    return {
      chatId,
      turnNumber: conversationHistory.length,
      conversationHistory,
      toolResults: [result],
      userQuestion,
    };
  }

  /**
   * Remove duplicate tool calls and prioritize based on relevance
   * Uses shared getToolKey for fuzzy timestamp matching to catch near-duplicates
   */
  private deduplicateAndPrioritize(
    suggestions: ToolCall[],
    history: ConversationTurn[],
    currentResults: ToolResult[],
  ): ToolCall[] {
    const seen = new Set<string>();

    // Mark existing calls from history as seen (using executionTrace)
    for (const turn of history) {
      if (turn.executionTrace) {
        for (const iteration of turn.executionTrace.iterations) {
          for (const exec of iteration.toolExecutions) {
            seen.add(getToolKey(exec.toolName, exec.arguments));
          }
        }
      }
    }

    // Mark current results as seen
    for (const res of currentResults) {
      seen.add(getToolKey(res.name, res.arguments));
    }

    const deduplicated: ToolCall[] = [];

    for (const suggestion of suggestions) {
      const key = getToolKey(suggestion.name, suggestion.arguments);
      if (!seen.has(key)) {
        seen.add(key);
        deduplicated.push(suggestion);
      }
    }

    return deduplicated;
  }
}
