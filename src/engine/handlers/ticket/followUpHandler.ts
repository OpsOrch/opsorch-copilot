/**
 * Ticket Follow-up Handler
 *
 * Field names match MCP ticketSchema:
 * - id: string
 * - key?: string
 * - title: string
 * - status: string
 * - assignees?: string[]
 * - reporter?: string
 * - createdAt: datetime
 * - updatedAt: datetime
 */

import type { FollowUpHandler } from "../handlers.js";
import type { ToolCall, JsonObject, HandlerContext } from "../../../types.js";

/**
 * Collects ticket IDs that have already been seen in conversation history.
 * Since query-tickets returns the same data as get-ticket, we skip suggesting
 * get-ticket for tickets we've already retrieved.
 */
function getSeenTicketIds(context: HandlerContext): Set<string> {
  const seenIds = new Set<string>();

  for (const turn of context.conversationHistory) {
    if (turn.toolResults) {
      for (const result of turn.toolResults) {
        if (result.name === "query-tickets" || result.name === "get-ticket") {
          if (Array.isArray(result.result)) {
            for (const ticket of result.result as JsonObject[]) {
              if (ticket.id && typeof ticket.id === "string") {
                seenIds.add(ticket.id);
              }
            }
          } else if (result.result && typeof result.result === "object") {
            const ticket = result.result as JsonObject;
            if (ticket.id && typeof ticket.id === "string") {
              seenIds.add(ticket.id);
            }
          }
        }
      }
    }
  }

  return seenIds;
}

export const ticketFollowUpHandler: FollowUpHandler = async (
  context,
  toolResult,
): Promise<ToolCall[]> => {
  const suggestions: ToolCall[] = [];

  if (!toolResult.result || typeof toolResult.result !== "object") {
    return suggestions;
  }

  // query-tickets returns z.array(ticketSchema), get-ticket returns ticketSchema
  let tickets: JsonObject[] = [];
  if (Array.isArray(toolResult.result)) {
    tickets = toolResult.result as JsonObject[];
  } else {
    tickets = [toolResult.result as JsonObject];
  }

  // Get IDs of tickets we've already seen - no need to suggest get-ticket for these
  // since query-tickets returns the same data as get-ticket
  const seenTicketIds = getSeenTicketIds(context);

  const question = context.userQuestion.toLowerCase();
  const drillDownPatterns = ["details", "status", "update"];
  const hasDrillDown = drillDownPatterns.some((pattern) =>
    question.includes(pattern),
  );

  if (
    tickets.length > 0 &&
    (hasDrillDown || toolResult.name === "query-tickets")
  ) {
    const firstTicket = tickets[0];
    // MCP schema: id: z.string()
    const ticketId = firstTicket.id;

    // Skip suggesting get-ticket if we've already seen this ticket
    if (ticketId && typeof ticketId === "string" && !seenTicketIds.has(ticketId)) {
      suggestions.push({
        name: "get-ticket",
        arguments: { id: ticketId },
      });
    }
  }

  return suggestions;
};
