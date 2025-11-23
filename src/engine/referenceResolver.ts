import { domainRegistry } from './domainRegistry.js';
import type { Entity } from './entityExtractor.js';

/**
 * Conversation context containing extracted entities
 */
export interface ConversationContext {
  entities: Map<string, Entity[]>; // type -> entities
  chatId: string;
}

/**
 * ReferenceResolver resolves references in user questions to actual entity values
 * using domain configurations.
 */
export class ReferenceResolver {
  /**
   * Resolve references in user question to actual entity values using domain configurations
   */
  resolveReferences(
    question: string,
    context: ConversationContext
  ): Map<string, string> {
    const resolutions = new Map<string, string>();
    const normalized = question.toLowerCase();

    // Get all domains and their reference patterns
    const domains = domainRegistry.getAllDomains();
    const patterns: Array<{ pattern: string; entityType: string; priority: number }> = [];

    for (const domain of domains) {
      for (const ref of domain.references) {
        patterns.push({
          pattern: ref.pattern,
          entityType: ref.entityType,
          priority: ref.priority ?? 0,
        });
      }
    }

    // Sort by priority (higher first)
    patterns.sort((a, b) => b.priority - a.priority);

    // Try to match patterns
    for (const { pattern, entityType } of patterns) {
      const regex = new RegExp(pattern, 'i');
      if (regex.test(normalized)) {
        const entity = this.getMostRecentEntity(context, entityType as any);
        if (entity) {
          // Extract the matched text from the pattern
          const match = normalized.match(regex);
          if (match && match[0]) {
            resolutions.set(match[0], entity.value);
          }

          // Also add common placeholder formats
          resolutions.set(`{{${entityType}}}`, entity.value);
          resolutions.set(`that ${entityType}`, entity.value);
          resolutions.set(`this ${entityType}`, entity.value);
          resolutions.set(`the ${entityType}`, entity.value);
        }
      }
    }

    // Handle time references specially
    if (this.hasTimeReference(normalized)) {
      const timestamp = this.getMostRecentEntity(context, 'timestamp');
      if (timestamp) {
        const resolvedTime = this.resolveTimeReference(normalized, timestamp.value);
        if (resolvedTime) {
          resolutions.set('{{time}}', resolvedTime);
          resolutions.set('since then', resolvedTime);
          resolutions.set('after that', resolvedTime);
          resolutions.set('before that', resolvedTime);
        }
      }
    }

    return resolutions;
  }

  /**
   * Apply resolutions to question text
   */
  applyResolutions(
    question: string,
    resolutions: Map<string, string>
  ): string {
    let resolved = question;

    for (const [placeholder, value] of resolutions.entries()) {
      // Case-insensitive replacement
      const regex = new RegExp(placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      resolved = resolved.replace(regex, value);
    }

    return resolved;
  }

  /**
   * Get most recent entity of a given type.
   * Uses prominence as a tiebreaker when multiple entities have the same timestamp.
   */
  private getMostRecentEntity(
    context: ConversationContext,
    type: string
  ): Entity | undefined {
    const entities = context.entities.get(type);
    if (!entities || entities.length === 0) return undefined;

    // Find entity with highest timestamp, using prominence as tiebreaker
    return entities.reduce((best, current) => {
      // Compare timestamps first
      if (current.extractedAt > best.extractedAt) return current;
      if (current.extractedAt < best.extractedAt) return best;

      // Timestamps are equal - use prominence as tiebreaker
      const currentProm = current.prominence ?? 0;
      const bestProm = best.prominence ?? 0;
      return currentProm > bestProm ? current : best;
    });
  }

  /**
   * Check if question has time reference
   */
  private hasTimeReference(question: string): boolean {
    return /(since then|after that|before that|around that time)/i.test(question);
  }

  /**
   * Resolve time reference relative to a timestamp
   */
  private resolveTimeReference(
    question: string,
    baseTimestamp: string
  ): string | undefined {
    try {
      const baseTime = new Date(baseTimestamp).getTime();

      if (/since then|after that/i.test(question)) {
        // Return the base timestamp as the start time
        return baseTimestamp;
      }

      if (/before that/i.test(question)) {
        // Return a time before the base timestamp (e.g., 1 hour before)
        const beforeTime = new Date(baseTime - 60 * 60 * 1000);
        return beforeTime.toISOString();
      }

      return baseTimestamp;
    } catch {
      return undefined;
    }
  }
}

