/**
 * Team Entity Handler
 *
 * Field names match MCP teamSchema:
 * - id: string
 * - name: string
 * - parent?: string
 * - tags?: Record<string, string>
 * - metadata?: Record<string, unknown>
 */

import type { EntityHandler } from "../handlers.js";
import type { Entity, JsonObject } from "../../../types.js";
import { HandlerUtils } from "../utils.js";

export const teamEntityHandler: EntityHandler = async (
  _context,
  toolResult,
): Promise<Entity[]> => {
  const entities: Entity[] = [];

  if (!toolResult.result || typeof toolResult.result !== "object") {
    return entities;
  }

  let teams: JsonObject[] = [];

  // Handle array of teams (query-teams returns z.array(teamSchema))
  if (Array.isArray(toolResult.result)) {
    teams = toolResult.result as JsonObject[];
  } else {
    // Single team
    teams = [toolResult.result as JsonObject];
  }

  for (const team of teams) {
    // Calculate prominence based on team characteristics
    const baseProminence = calculateTeamProminence(team, toolResult.name);
    
    // Extract team name (MCP schema: name: z.string())
    const name = team.name;
    if (name && typeof name === "string" && HandlerUtils.validateEntityId(name)) {
      entities.push({
        type: "team",
        value: name,
        extractedAt: Date.now(),
        source: toolResult.name,
        prominence: baseProminence,
      });
    }

    // Also extract id as secondary identifier (MCP schema: id: z.string())
    const id = team.id;
    if (id && typeof id === "string" && HandlerUtils.validateEntityId(id) && id !== name) {
      entities.push({
        type: "team",
        value: id,
        extractedAt: Date.now(),
        source: toolResult.name,
        prominence: baseProminence * 0.9, // Slightly lower for ID vs name
      });
    }

    // Extract parent team if present (MCP schema: parent?: string)
    const parent = team.parent;
    if (parent && typeof parent === "string" && HandlerUtils.validateEntityId(parent)) {
      entities.push({
        type: "team",
        value: parent,
        extractedAt: Date.now(),
        source: toolResult.name,
        prominence: baseProminence * 0.7, // Lower prominence for parent references
      });
    }
  }

  return entities;
};

/**
 * Calculate prominence score for a team based on its characteristics
 */
function calculateTeamProminence(team: JsonObject, toolName: string): number {
  let prominence = 1.0;

  // Higher prominence for direct team queries vs bulk queries
  if (toolName === "get-team" || toolName === "get-team-members") {
    prominence = 1.0; // Direct team lookup
  } else if (toolName === "query-teams") {
    prominence = 0.8; // Bulk query result
  }

  // Boost prominence for teams with service associations
  if (team.metadata && typeof team.metadata === "object") {
    const metadata = team.metadata as JsonObject;
    if (metadata.services && Array.isArray(metadata.services) && metadata.services.length > 0) {
      prominence += 0.1; // Teams with services are more prominent
    }
  }

  // Boost prominence for parent teams (they're organizational anchors)
  if (team.parent && typeof team.parent === "string") {
    prominence += 0.05; // Child teams get slight boost
  } else {
    prominence += 0.1; // Root teams get more boost
  }

  // Boost prominence based on team tags indicating importance
  if (team.tags && typeof team.tags === "object") {
    const tags = team.tags as Record<string, string>;
    if (tags.critical === "true" || tags.priority === "high") {
      prominence += 0.1;
    }
    if (tags.oncall === "true") {
      prominence += 0.05;
    }
  }

  return Math.min(prominence, 1.0); // Cap at 1.0
}

