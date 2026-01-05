/**
 * Incident Reference Handler
 *
 * Resolves references like "that incident", "this issue", etc.
 *
 * MCP incidentSchema field used:
 * - id: string
 */

import type { ReferenceHandler } from "../handlers.js";

/**
 * Reference handler for incident-related references
 * Uses entities extracted and stored per turn instead of raw toolResults
 */
export const incidentReferenceHandler: ReferenceHandler = async (
  context,
  referenceText,
): Promise<string | null> => {
  let incidentEntities: Array<{
    value: string;
    timestamp: number;
    prominence?: number;
  }> = [];

  // Extract incidents from conversation turn entities
  for (const turn of context.conversationHistory) {
    if (turn.entities) {
      for (const entity of turn.entities) {
        if (entity.type === "incident") {
          incidentEntities.push({
            value: entity.value,
            timestamp: entity.extractedAt || turn.timestamp || Date.now(),
            prominence: entity.prominence || 1.0,
          });
        }
      }
    }
  }

  // Also check current turn's tool results for immediate context
  for (const result of context.toolResults) {
    if (
      result.name === "query-incidents" ||
      result.name === "get-incident" ||
      result.name === "get-incident-timeline"
    ) {
      // Check argument paths - MCP uses 'id' for get-incident
      if (result.arguments) {
        const args = result.arguments as Record<string, unknown>;
        const argId = args.id;
        if (argId && typeof argId === "string") {
          incidentEntities.push({
            value: argId,
            timestamp: Date.now(),
            prominence: 1.0,
          });
        }
      }

      const content = result.result;
      if (content) {
        if (Array.isArray(content)) {
          for (const item of content) {
            const incident = item as Record<string, unknown>;
            const id = incident.id;
            if (id && typeof id === "string") {
              incidentEntities.push({
                value: id,
                timestamp: Date.now(),
                prominence: 1.0,
              });
            }
          }
        } else if (typeof content === "object" && content !== null) {
          const incident = content as Record<string, unknown>;
          const id = incident.id;
          if (id && typeof id === "string") {
            incidentEntities.push({
              value: id,
              timestamp: Date.now(),
              prominence: 1.0,
            });
          }
        }
      }
    }
  }

  if (incidentEntities.length === 0) {
    return null;
  }

  // Refine using reference text
  if (referenceText) {
    const lowerRef = referenceText.toLowerCase();

    // Check for domain mismatch
    if (
      (lowerRef.includes("service") ||
        lowerRef.includes("log") ||
        lowerRef.includes("metric") ||
        lowerRef.includes("alert")) &&
      !lowerRef.includes("incident") &&
      !lowerRef.includes("issue")
    ) {
      return null;
    }

    // Prioritize exact matches if reference text contains an ID
    const matchingEntities = incidentEntities.filter((entity) =>
      lowerRef.includes(entity.value.toLowerCase()),
    );

    if (matchingEntities.length > 0) {
      incidentEntities = matchingEntities;
    }
  }

  // Sort by recency and prominence
  incidentEntities.sort((a, b) => {
    const prominenceDiff = (b.prominence || 0) - (a.prominence || 0);
    if (prominenceDiff !== 0) return prominenceDiff;
    return b.timestamp - a.timestamp;
  });

  return incidentEntities[0].value;
};

/**
 * Extract timestamps from incident timeline - now uses entities
 */
export function extractTimelineTimestamps(
  conversationHistory: Array<{ entities?: Array<{ type: string; value: string; extractedAt: number }>; timestamp?: number }>,
): Array<{ value: string; timestamp: number }> {
  const timestamps: Array<{ value: string; timestamp: number }> = [];

  for (const turn of conversationHistory) {
    if (turn.entities) {
      for (const entity of turn.entities) {
        if (entity.type === "timestamp") {
          timestamps.push({
            value: entity.value,
            timestamp: entity.extractedAt || turn.timestamp || Date.now(),
          });
        }
      }
    }
  }

  return timestamps;
}
