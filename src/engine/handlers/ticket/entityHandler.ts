/**
 * Ticket Entity Handler
 *
 * Field names match MCP ticketSchema:
 * - id: string
 * - key?: string
 * - title: string
 * - description?: string
 * - status: string
 * - assignees?: string[]
 * - reporter?: string
 * - createdAt: datetime
 * - updatedAt: datetime
 */

import type { EntityHandler } from "../handlers.js";
import type { Entity, JsonObject } from "../../../types.js";
import { HandlerUtils } from "../utils.js";

export const ticketEntityHandler: EntityHandler = async (
  _context,
  toolResult,
): Promise<Entity[]> => {
  const entities: Entity[] = [];

  if (!toolResult.result || typeof toolResult.result !== "object") {
    return entities;
  }

  let tickets: JsonObject[] = [];

  // Handle array of tickets (query-tickets returns z.array(ticketSchema))
  if (Array.isArray(toolResult.result)) {
    tickets = toolResult.result as JsonObject[];
  } else {
    // Single ticket (get-ticket returns ticketSchema)
    tickets = [toolResult.result as JsonObject];
  }

  for (const ticket of tickets) {
    // Extract ticket ID (MCP schema: id: z.string())
    const id = ticket.id;
    if (id && typeof id === "string" && HandlerUtils.validateEntityId(id)) {
      entities.push({
        type: "ticket",
        value: id,
        extractedAt: Date.now(),
        source: toolResult.name,
        prominence: 1.0,
      });
    }

    // Also extract key as secondary identifier (MCP schema: key: z.string().optional())
    const key = ticket.key;
    if (key && typeof key === "string" && HandlerUtils.validateEntityId(key)) {
      entities.push({
        type: "ticket",
        value: key,
        extractedAt: Date.now(),
        source: toolResult.name,
        prominence: 0.9,
      });
    }
  }

  return entities;
};
