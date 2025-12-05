import {
  ToolResult,
  LlmMessage,
  IntentResult,
  IntentContext,
} from "../types.js";
import { IntentRegistry } from "./handlers/index.js";
import { HandlerContext } from "../types.js";

/**
 * Handler-based IntentClassifier that uses programmatic intent handlers
 * instead of configuration-driven intent classification.
 */
export class IntentClassifier {
  constructor(private intentRegistry: IntentRegistry) { }

  /**
   * Classify user intent based on question and conversation context
   */
  async classifyIntent(
    question: string,
    context: IntentContext,
  ): Promise<IntentResult> {
    // Get handlers from registry and execute them
    const handlers = this.intentRegistry.getHandlers();

    if (handlers.length === 0) {
      return {
        intent: "unknown",
        confidence: 0.0,
        suggestedTools: [],
        reasoning: "No intent handlers registered",
      };
    }

    // Build handler context
    const handlerContext = this.buildHandlerContext(question, context);

    // Execute registry's execute method which finds the best result
    return await this.intentRegistry.execute(handlerContext);
  }

  /**
   * Build handler context from intent context
   */
  private buildHandlerContext(
    question: string,
    context: IntentContext,
  ): HandlerContext {
    return {
      chatId: "unknown", // IntentContext doesn't have chatId, would need to be passed separately
      turnNumber: context.turnNumber,
      conversationHistory: [], // Would need to be passed in from higher level
      toolResults: [], // Would need to be passed in from higher level
      userQuestion: question,
    };
  }
}

/**
 * Extract conversation context from history and previous tool results.
 * Simplified version - just tracks tool usage and basic metadata.
 * Entity extraction is handled by EntityExtractor and passed in.
 */
export function extractConversationContext(
  history: LlmMessage[],
  previousResults?: ToolResult[],
  entities?: { type: string; value: string }[],
): IntentContext {
  const context: IntentContext = {
    lastToolsUsed: [],
    lastToolArgs: [],
    turnNumber: history.length,
    isFollowUp: history.length > 0,
  };

  // Track tool usage from results in reverse order (newest first)
  if (previousResults && previousResults.length > 0) {
    // Reverse to get most recent tools first
    for (let i = previousResults.length - 1; i >= 0; i--) {
      const result = previousResults[i];
      context.lastToolsUsed.push(result.name);
      context.lastToolArgs.push(result.arguments || {});
    }
  }

  // Populate context from provided entities generically
  const recentEntities: Record<string, string> = {};
  if (entities && entities.length > 0) {
    // Process entities to find most recent for each type
    // Assuming entities are ordered oldest to newest (from extractFromResults)
    for (const entity of entities) {
      recentEntities[entity.type] = entity.value;
    }
  }

  context.recentEntities = recentEntities;

  return context;
}

/**
 * Classify user intent based on question and conversation context.
 * This is a convenience function that creates an IntentClassifier instance.
 */
export async function classifyIntent(
  question: string,
  context: IntentContext,
  registry: IntentRegistry,
): Promise<IntentResult> {
  const classifier = new IntentClassifier(registry);
  return await classifier.classifyIntent(question, context);
}
