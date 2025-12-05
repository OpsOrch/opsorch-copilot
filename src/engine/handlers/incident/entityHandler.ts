/**
 * Incident Entity Handler
 *
 * Field names match MCP incidentSchema:
 * - id: string
 * - title: string
 * - description?: string
 * - status: string
 * - severity: string
 * - service?: string
 * - createdAt: datetime
 * - updatedAt: datetime
 *
 * Timeline entries match MCP timelineEntrySchema:
 * - id: string
 * - incidentId: string
 * - at: datetime
 * - kind: string
 * - body: string
 */

import type { EntityHandler } from "../handlers.js";
import type { Entity, JsonObject } from "../../../types.js";
import { HandlerUtils } from "../utils.js";

/**
 * Entity handler for incident-related tool results
 *
 * Extracts incident IDs from query-incidents and get-incident tool results
 */
export const incidentEntityHandler: EntityHandler = async (
  _context,
  toolResult,
): Promise<Entity[]> => {
  const entities: Entity[] = [];

  if (!toolResult.result || typeof toolResult.result !== "object") {
    return entities;
  }

  // Handle array of incidents (query-incidents returns z.array(incidentSchema))
  if (Array.isArray(toolResult.result)) {
    for (const item of toolResult.result as JsonObject[]) {
      // Extract incident ID (MCP schema: id: z.string())
      const id = item.id;
      if (id && typeof id === "string") {
        entities.push({
          type: "incident",
          value: id,
          extractedAt: Date.now(),
          source: toolResult.name,
          prominence: 1.0,
        });
      }

      // Extract service (MCP schema: service: z.string().optional())
      const service = item.service;
      if (service && typeof service === "string") {
        entities.push({
          type: "service",
          value: service,
          extractedAt: Date.now(),
          source: toolResult.name,
          prominence: 0.8,
        });
      }
    }
  }
  // Handle single incident (get-incident returns incidentSchema)
  else {
    const content = toolResult.result as JsonObject;

    // Extract incident ID
    const id = content.id;
    if (id && typeof id === "string") {
      entities.push({
        type: "incident",
        value: id,
        extractedAt: Date.now(),
        source: toolResult.name,
        prominence: 1.0,
      });
    }

    // Extract service
    const service = content.service;
    if (service && typeof service === "string") {
      entities.push({
        type: "service",
        value: service,
        extractedAt: Date.now(),
        source: toolResult.name,
        prominence: 0.8,
      });
    }
  }

  // Handle timeline results (get-incident-timeline returns z.array(timelineEntrySchema))
  if (toolResult.name === "get-incident-timeline" && Array.isArray(toolResult.result)) {
    for (const timelineItem of toolResult.result as JsonObject[]) {
      // Extract timestamp (MCP schema: at: z.string().datetime())
      const at = timelineItem.at;
      if (at && typeof at === "string" && HandlerUtils.parseTimestamp(at)) {
        entities.push({
          type: "timestamp",
          value: at,
          extractedAt: Date.now(),
          source: toolResult.name,
          prominence: 0.6,
        });
      }
    }
  }

  return entities;
};
