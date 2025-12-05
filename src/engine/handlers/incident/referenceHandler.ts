/**
 * Incident Reference Handler
 *
 * Resolves references like "that incident", "this issue", etc.
 *
 * MCP incidentSchema field used:
 * - id: string
 */

import type { ReferenceHandler } from "../handlers.js";
import type { JsonObject } from "../../../types.js";

/**
 * Reference handler for incident-related references
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

  // Extract incidents from conversation turns
  for (const turn of context.conversationHistory) {
    if (turn.toolResults) {
      for (const result of turn.toolResults) {
        // Check MCP tool names
        if (
          result.name === "query-incidents" ||
          result.name === "get-incident" ||
          result.name === "get-incident-timeline"
        ) {
          // Check argument paths - MCP uses 'id' for get-incident
          if (result.arguments) {
            const args = result.arguments as JsonObject;
            // MCP schema: id: z.string()
            const argId = args.id;
            if (argId && typeof argId === "string") {
              incidentEntities.push({
                value: argId,
                timestamp: turn.timestamp || Date.now(),
                prominence: 1.0,
              });
            }
          }

          const content = result.result;
          if (content) {
            // query-incidents returns z.array(incidentSchema)
            if (Array.isArray(content)) {
              for (const item of content) {
                const incident = item as JsonObject;
                // MCP schema: id: z.string()
                const id = incident.id;
                if (id && typeof id === "string") {
                  incidentEntities.push({
                    value: id,
                    timestamp: turn.timestamp || Date.now(),
                    prominence: 1.0,
                  });
                }
              }
            } else if (typeof content === "object" && content !== null) {
              // get-incident returns incidentSchema directly
              const incident = content as JsonObject;
              // MCP schema: id: z.string()
              const id = incident.id;
              if (id && typeof id === "string") {
                incidentEntities.push({
                  value: id,
                  timestamp: turn.timestamp || Date.now(),
                  prominence: 1.0,
                });
              }
            }
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
 * Extract timestamps from incident timeline results
 *
 * MCP timelineEntrySchema field used:
 * - at: datetime
 */
export function extractTimelineTimestamps(
  conversationHistory: Array<{ toolResults?: Array<{ name: string; result: unknown }>; timestamp?: number }>,
): Array<{ value: string; timestamp: number }> {
  const timestamps: Array<{ value: string; timestamp: number }> = [];

  for (const turn of conversationHistory) {
    if (turn.toolResults) {
      for (const result of turn.toolResults) {
        if (result.name === "get-incident-timeline") {
          const content = result.result;

          // MCP returns z.array(timelineEntrySchema) directly
          if (content && Array.isArray(content)) {
            for (const entry of content) {
              if (typeof entry === "object" && entry !== null && !Array.isArray(entry)) {
                const entryObj = entry as JsonObject;
                // MCP schema: at: z.string().datetime()
                const at = entryObj.at;
                if (at && typeof at === "string") {
                  timestamps.push({
                    value: at,
                    timestamp: turn.timestamp || Date.now(),
                  });
                }
              }
            }
          }
        }
      }
    }
  }

  return timestamps;
}
