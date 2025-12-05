/**
 * Service Entity Handler
 *
 * Field names match MCP serviceSchema:
 * - id: string
 * - name: string
 * - tags?: Record<string, string>
 */

import type { EntityHandler } from "../handlers.js";
import type { Entity, JsonObject } from "../../../types.js";
import { HandlerUtils } from "../utils.js";

export const serviceEntityHandler: EntityHandler = async (
  _context,
  toolResult,
): Promise<Entity[]> => {
  const entities: Entity[] = [];

  if (!toolResult.result || typeof toolResult.result !== "object") {
    return entities;
  }

  let services: JsonObject[] = [];

  // Handle array of services (query-services returns z.array(serviceSchema))
  if (Array.isArray(toolResult.result)) {
    services = toolResult.result as JsonObject[];
  } else {
    // Single service
    services = [toolResult.result as JsonObject];
  }

  for (const service of services) {
    // Extract service name (MCP schema: name: z.string())
    const name = service.name;
    if (name && typeof name === "string" && HandlerUtils.validateEntityId(name)) {
      entities.push({
        type: "service",
        value: name,
        extractedAt: Date.now(),
        source: toolResult.name,
        prominence: 1.0,
      });
    }

    // Also extract id as secondary identifier (MCP schema: id: z.string())
    const id = service.id;
    if (id && typeof id === "string" && HandlerUtils.validateEntityId(id)) {
      entities.push({
        type: "service",
        value: id,
        extractedAt: Date.now(),
        source: toolResult.name,
        prominence: 0.9,
      });
    }
  }

  return entities;
};
