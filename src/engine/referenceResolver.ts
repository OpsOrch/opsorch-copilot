import {
  ConversationTurn,
  HandlerContext,
} from "../types.js";
import type { ConversationContext } from "../types.js";
import { ReferenceRegistry } from "./handlers/index.js";

// Re-export for convenience
export type { ConversationContext };

/**
 * ReferenceResolver resolves references in user questions to actual entity values
 * using programmatic reference handlers.
 */
export class ReferenceResolver {
  constructor(private referenceRegistry: ReferenceRegistry) { }

  /**
   * Resolve references in user question to actual entity values using handlers
   */
  async resolveReferences(
    question: string,
    context: ConversationContext,
    conversationHistory?: ConversationTurn[],
  ): Promise<Map<string, string>> {
    const resolutions = new Map<string, string>();

    // Extract potential reference patterns from the original question
    // (handlers receive original casing; replacement uses case-insensitive regex)
    const referencePatterns = this.extractReferencePatterns(question);

    for (const { text, entityType } of referencePatterns) {
      if (this.referenceRegistry.hasHandlers(entityType)) {
        const handlerContext = this.buildHandlerContext(
          question,
          context,
          conversationHistory,
        );

        try {
          const resolution = await this.referenceRegistry.execute(
            handlerContext,
            entityType,
            text,
          );
          if (resolution) {
            resolutions.set(text, resolution);
          }
        } catch (error) {
          console.error(`Reference handler error for ${entityType}:`, error);
          // Continue with other patterns
        }
      }
    }

    return resolutions;
  }

  /**
   * Apply resolutions to question text
   */
  applyResolutions(question: string, resolutions: Map<string, string>): string {
    let resolved = question;

    for (const [placeholder, value] of resolutions.entries()) {
      // Case-insensitive replacement
      const regex = new RegExp(
        placeholder.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
        "gi",
      );
      resolved = resolved.replace(regex, value);
    }

    return resolved;
  }

  /**
   * Extract potential reference patterns from the question
   * This is a simple implementation that looks for common patterns
   */
  private extractReferencePatterns(
    question: string,
  ): Array<{ text: string; entityType: string }> {
    const patterns: Array<{ text: string; entityType: string }> = [];

    // Common reference patterns
    const referenceRegexes = [
      { regex: /(that|this|the) incident/gi, entityType: "incident" },
      { regex: /(that|this|the) ticket/gi, entityType: "ticket" },
      { regex: /(that|this|the) service/gi, entityType: "service" },
      { regex: /(those|these|the) logs/gi, entityType: "log_query" },
      {
        regex: /(since then|after that|before that)/gi,
        entityType: "timestamp",
      },
    ];

    for (const { regex, entityType } of referenceRegexes) {
      const matches = question.match(regex);
      if (matches) {
        for (const match of matches) {
          patterns.push({ text: match, entityType });
        }
      }
    }

    return patterns;
  }

  /**
   * Build handler context for reference handlers
   */
  private buildHandlerContext(
    question: string,
    context: ConversationContext,
    conversationHistory?: ConversationTurn[],
  ): HandlerContext {
    return {
      chatId: context.chatId,
      turnNumber: conversationHistory?.length || 1,
      conversationHistory: conversationHistory || [],
      toolResults: [], // Reference resolution doesn't typically need tool results
      userQuestion: question,
    };
  }
}
