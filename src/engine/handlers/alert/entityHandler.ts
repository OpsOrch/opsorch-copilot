/**
 * Alert Entity Handler
 *
 * Field names match MCP alertSchema:
 * - id: string
 * - title: string
 * - description?: string
 * - status: string
 * - severity: string
 * - service?: string
 * - createdAt: datetime
 * - updatedAt: datetime
 */

import type { EntityHandler } from "../handlers.js";
import type { Entity, JsonObject } from "../../../types.js";
import { HandlerUtils } from "../utils.js";

/**
 * Entity handler for alert-related tool results
 *
 * Extracts alert IDs and related entities from query-alerts tool results
 */
export const alertEntityHandler: EntityHandler = async (
  _context,
  toolResult,
): Promise<Entity[]> => {
  const entities: Entity[] = [];

  if (!toolResult.result || typeof toolResult.result !== "object") {
    return entities;
  }

  let alerts: JsonObject[] = [];

  // Handle array of alerts (query-alerts returns z.array(alertSchema))
  if (Array.isArray(toolResult.result)) {
    alerts = toolResult.result as JsonObject[];
  } else {
    // Single alert object
    alerts = [toolResult.result as JsonObject];
  }

  // Extract entities from alerts using MCP schema field names
  for (const alert of alerts) {
    // Extract alert ID (MCP schema: id: z.string())
    const alertId = alert.id;
    if (alertId && typeof alertId === "string" && HandlerUtils.validateEntityId(alertId)) {
      entities.push({
        type: "alert",
        value: alertId,
        extractedAt: Date.now(),
        source: toolResult.name,
        prominence: 1.0,
      });
    }

    // Extract service (MCP schema: service: z.string().optional())
    const service = alert.service;
    if (service && typeof service === "string" && HandlerUtils.validateEntityId(service)) {
      entities.push({
        type: "service",
        value: service,
        extractedAt: Date.now(),
        source: toolResult.name,
        prominence: 0.8,
      });
    }

    // Extract timestamp (MCP schema: createdAt: z.string().datetime())
    const createdAt = alert.createdAt;
    if (createdAt && typeof createdAt === "string" && HandlerUtils.parseTimestamp(createdAt)) {
      entities.push({
        type: "timestamp",
        value: createdAt,
        extractedAt: Date.now(),
        source: toolResult.name,
        prominence: 0.3,
      });
    }
  }

  return entities;
};
