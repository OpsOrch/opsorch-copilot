import { domainRegistry } from './domainRegistry.js';
import { ToolResult } from '../types.js';
import { isValidISO8601 } from './timestampUtils.js';
/**
 * Represents an entity extracted from tool results or conversation
 */
export interface Entity {
  type: 'incident' | 'service' | 'timestamp' | 'ticket';
  value: string;
  extractedAt: number; // timestamp when extracted
  source: string; // tool name that provided it
  prominence?: number; // 0-1 score indicating importance/relevance in context
}

/**
 * Conversation context containing extracted entities
 */
export interface ConversationContext {
  entities: Map<string, Entity[]>; // type -> entities
  chatId: string;
}

/**
 * EntityExtractor extracts and resolves entity references from tool results
 * and user questions to enable natural conversation flow.
 * 
 * Now uses DomainRegistry for configuration-driven extraction.
 */
export class EntityExtractor {
  /**
   * Extract entities from tool results using domain configurations
   */
  extractFromResults(results: ToolResult[]): Entity[] {
    const entities: Entity[] = [];
    const now = Date.now();

    for (const result of results) {
      // Get domain for this tool
      const domain = domainRegistry.getDomainForTool(result.name);
      if (!domain) {
        // Skip tools without domain configuration
        continue;
      }

      // Extract entities using domain's entity configurations
      for (const entityConfig of domain.entities) {
        const extractedValues = this.extractEntitiesUsingConfig(
          result.result,
          entityConfig.idPaths,
          entityConfig.idPattern
        );

        for (const value of extractedValues) {
          entities.push({
            type: entityConfig.type as any,
            value,
            extractedAt: now,
            source: result.name,
          });
        }

        // Extract timestamps if configured
        if (entityConfig.timestampPaths) {
          const timestamps = this.extractEntitiesUsingConfig(
            result.result,
            entityConfig.timestampPaths
          );

          // Limit to 5 timestamps
          const limitedTimestamps = timestamps.slice(0, 5);

          for (const timestamp of limitedTimestamps) {
            if (isValidISO8601(timestamp)) {
              entities.push({
                type: 'timestamp' as any,
                value: timestamp,
                extractedAt: now,
                source: result.name,
              });
            }
          }
        }
      }
    }

    return entities;
  }

  /**
   * Extract entities using simple key matching (no JSONPath)
   */
  private extractEntitiesUsingConfig(
    payload: any,
    keyPatterns: string[],
    idPattern?: string
  ): string[] {
    const values = new Set<string>();

    // Convert $.key patterns to simple key names
    const keys = keyPatterns.map(p => p.replace(/^\$\./, '').replace(/^\$\[/, ''));

    this.traversePayload(payload, (value, key) => {
      if (key && keys.includes(key) && typeof value === 'string' && value.trim()) {
        // Validate against pattern if provided
        if (idPattern) {
          try {
            const regex = new RegExp(idPattern);
            if (regex.test(value.trim())) {
              values.add(value.trim());
            }
          } catch (error) {
            // Invalid regex, skip validation
            values.add(value.trim());
          }
        } else {
          values.add(value.trim());
        }
      }
    });

    return Array.from(values);
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
    allEntities: Entity[]
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
      const score = 1.0 - (index * decayFactor * 0.5); // Decay by 50% across all entities
      prominenceMap.set(item.entity.value, Math.max(0.1, score)); // Minimum 0.1
    });

    return prominenceMap;
  }

  /**
   * Traverse payload and call visitor for each value
   */
  private traversePayload(
    payload: any,
    visitor: (value: any, key?: string) => void,
    depth = 0
  ): void {
    if (depth > 10) return; // Prevent infinite recursion

    if (Array.isArray(payload)) {
      for (const item of payload) {
        this.traversePayload(item, visitor, depth + 1);
      }
    } else if (payload && typeof payload === 'object') {
      for (const [key, value] of Object.entries(payload)) {
        visitor(value, key);
        if (typeof value === 'object') {
          this.traversePayload(value, visitor, depth + 1);
        }
      }
    }
  }

}

