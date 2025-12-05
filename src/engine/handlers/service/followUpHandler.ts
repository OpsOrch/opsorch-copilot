/**
 * Service Follow-up Handler
 *
 * Field names match MCP serviceSchema:
 * - id: string
 * - name: string
 * - tags?: Record<string, string>
 */

import type { FollowUpHandler } from "../handlers.js";
import type { ToolCall, JsonObject } from "../../../types.js";

export const serviceFollowUpHandler: FollowUpHandler = async (
  _context,
  toolResult,
): Promise<ToolCall[]> => {
  const suggestions: ToolCall[] = [];

  if (!toolResult.result || typeof toolResult.result !== "object") {
    return suggestions;
  }

  // query-services returns z.array(serviceSchema)
  let services: JsonObject[] = [];
  if (Array.isArray(toolResult.result)) {
    services = toolResult.result as JsonObject[];
  } else {
    services = [toolResult.result as JsonObject];
  }

  for (const service of services.slice(0, 3)) {
    // MCP schema: name: z.string()
    const serviceName = service.name;

    if (serviceName && typeof serviceName === "string") {
      // Suggest discovering available metrics for the service
      suggestions.push({
        name: "describe-metrics",
        arguments: {
          scope: { service: serviceName },
        },
      });
      suggestions.push({
        name: "query-logs",
        arguments: {
          scope: { service: serviceName },
          expression: { severityIn: ["error"] },
          limit: 20,
        },
      });
    }
  }

  return suggestions;
};
