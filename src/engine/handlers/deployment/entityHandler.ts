/**
 * Deployment Entity Handler
 *
 * Field names match MCP deployment schema:
 * - id: string
 * - service?: string
 * - environment?: string
 * - version?: string
 * - status: string
 */

import type { EntityHandler } from "../handlers.js";
import type { Entity, JsonObject } from "../../../types.js";
import { HandlerUtils } from "../utils.js";

export const deploymentEntityHandler: EntityHandler = async (
    _context,
    toolResult,
): Promise<Entity[]> => {
    const entities: Entity[] = [];

    if (!toolResult.result || typeof toolResult.result !== "object") {
        return entities;
    }

    let deployments: JsonObject[] = [];

    // Handle array of deployments (query-deployments returns z.array(deploymentSchema))
    if (Array.isArray(toolResult.result)) {
        deployments = toolResult.result as JsonObject[];
    } else {
        // Single deployment (get-deployment returns deploymentSchema)
        deployments = [toolResult.result as JsonObject];
    }

    for (const deployment of deployments) {
        // Extract deployment ID (MCP schema: id: z.string())
        const id = deployment.id;
        if (id && typeof id === "string" && HandlerUtils.validateEntityId(id)) {
            entities.push({
                type: "deployment",
                value: id,
                extractedAt: Date.now(),
                source: toolResult.name,
                prominence: 1.0,
            });
        }
    }

    return entities;
};
