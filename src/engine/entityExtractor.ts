import {
  ToolResult,
  Entity,
  ConversationTurn,
  HandlerContext,
} from "../types.js";
import { EntityRegistry } from "./handlers/index.js";

/**
 * EntityExtractor extracts and resolves entity references from tool results
 * and user questions to enable natural conversation flow.
 *
 * Now uses EntityRegistry for handler-driven extraction.
 */
export class EntityExtractor {
  constructor(private entityRegistry: EntityRegistry) { }

  /**
   * Extract entities from tool results using programmatic handlers
   */
  async extractFromResults(
    results: ToolResult[],
    chatId?: string,
    conversationHistory?: ConversationTurn[],
  ): Promise<Entity[]> {
    const allEntities: Entity[] = [];

    for (const result of results) {
      if (this.entityRegistry.hasHandlers(result.name)) {
        const context = this.buildHandlerContext(
          result,
          chatId,
          conversationHistory,
        );

        try {
          const entities = await this.entityRegistry.execute(context, result);
          allEntities.push(...entities);
        } catch (error) {
          console.error(`Entity handler error for ${result.name}:`, error);
          // Continue with other handlers
        }
      }
    }

    return allEntities;
  }

  /**
   * Extract primary entities from conclusion text and compute prominence scores.
   * Entities mentioned earlier in the conclusion are considered more prominent.
   *
   * @param conclusion - The synthesized conclusion text
   * @param allEntities - All extracted entities to check against
   * @returns Map of entity value to prominence score (0-1)
   */
  extractPrimaryEntitiesFromConclusion(
    conclusion: string,
    allEntities: Entity[],
  ): Map<string, number> {
    const prominenceMap = new Map<string, number>();

    if (!conclusion || !allEntities.length) return prominenceMap;

    const normalizedConclusion = conclusion.toLowerCase();

    // Find position of each entity in conclusion
    const entityPositions: Array<{ entity: Entity; position: number }> = [];

    for (const entity of allEntities) {
      const normalizedValue = entity.value.toLowerCase();
      const position = normalizedConclusion.indexOf(normalizedValue);

      if (position !== -1) {
        entityPositions.push({ entity, position });
      }
    }

    if (entityPositions.length === 0) return prominenceMap;

    // Sort by position (earlier = more prominent)
    entityPositions.sort((a, b) => a.position - b.position);

    // Assign prominence scores
    // First mention gets 1.0, subsequent mentions decay
    const decayFactor = 1.0 / entityPositions.length;
    entityPositions.forEach((item, index) => {
      const score = 1.0 - index * decayFactor * 0.5; // Decay by 50% across all entities
      prominenceMap.set(item.entity.value, Math.max(0.1, score)); // Minimum 0.1
    });

    return prominenceMap;
  }

  /**
   * Build handler context for entity handlers
   */
  private buildHandlerContext(
    result: ToolResult,
    chatId?: string,
    conversationHistory?: ConversationTurn[],
  ): HandlerContext {
    return {
      chatId: chatId || "unknown",
      turnNumber: conversationHistory?.length || 1,
      conversationHistory: conversationHistory || [],
      toolResults: [result],
      userQuestion: "", // Entity extraction doesn't typically need the user question
    };
  }
}
