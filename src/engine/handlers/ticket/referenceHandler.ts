/**
 * Ticket Reference Handler
 *
 * Resolves references like "that ticket", "this issue", etc.
 *
 * MCP ticketSchema field used:
 * - id: string
 */

import type { ReferenceHandler } from "../handlers.js";
import type { JsonObject } from "../../../types.js";

export const ticketReferenceHandler: ReferenceHandler = async (
  context,
  referenceText,
): Promise<string | null> => {
  let ticketEntities: Array<{
    value: string;
    timestamp: number;
    prominence?: number;
  }> = [];

  for (const turn of context.conversationHistory) {
    if (turn.toolResults) {
      for (const result of turn.toolResults) {
        // MCP tool names: query-tickets, get-ticket
        if (result.name === "query-tickets" || result.name === "get-ticket") {
          const content = result.result;
          if (content) {
            // query-tickets returns z.array(ticketSchema)
            if (Array.isArray(content)) {
              for (const item of content) {
                const ticket = item as JsonObject;
                // MCP schema: id: z.string()
                const id = ticket.id;
                if (id && typeof id === "string") {
                  ticketEntities.push({
                    value: id,
                    timestamp: turn.timestamp || Date.now(),
                    prominence: 1.0,
                  });
                }
              }
            } else if (typeof content === "object" && content !== null) {
              // get-ticket returns ticketSchema directly
              const ticket = content as JsonObject;
              // MCP schema: id: z.string()
              const id = ticket.id;
              if (id && typeof id === "string") {
                ticketEntities.push({
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

  if (ticketEntities.length === 0) return null;

  // Refine using reference text
  if (referenceText) {
    const lowerRef = referenceText.toLowerCase();

    // Check for domain mismatch
    if (
      (lowerRef.includes("incident") ||
        lowerRef.includes("issue") ||
        lowerRef.includes("log") ||
        lowerRef.includes("metric") ||
        lowerRef.includes("alert") ||
        lowerRef.includes("service")) &&
      !lowerRef.includes("ticket")
    ) {
      return null;
    }

    // Prioritize exact matches if reference text contains a ticket ID
    const matchingEntities = ticketEntities.filter((entity) =>
      lowerRef.includes(entity.value.toLowerCase()),
    );

    if (matchingEntities.length > 0) {
      ticketEntities = matchingEntities;
    }
  }

  ticketEntities.sort((a, b) => {
    const prominenceDiff = (b.prominence || 0) - (a.prominence || 0);
    if (prominenceDiff !== 0) return prominenceDiff;
    return b.timestamp - a.timestamp;
  });

  return ticketEntities[0].value;
};
