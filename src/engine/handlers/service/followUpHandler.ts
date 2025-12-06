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
import { generateSearchExpression } from "../logQueryParser.js";

export const serviceFollowUpHandler: FollowUpHandler = async (
  context,
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
      // Suggest discovering available metrics for the service, but only if not already discovered
      // Check existing tool results (current turn) and history
      const alreadyDiscovered =
        context.toolResults.some(
          (r) =>
            r.name === "describe-metrics" &&
            (r.arguments as JsonObject)?.scope &&
            ((r.arguments as JsonObject).scope as JsonObject).service ===
            serviceName,
        ) ||
        context.conversationHistory.some((turn) =>
          turn.toolResults?.some(
            (r) =>
              r.name === "describe-metrics" &&
              (r.arguments as JsonObject)?.scope &&
              ((r.arguments as JsonObject).scope as JsonObject).service ===
              serviceName,
          ),
        );

      if (!alreadyDiscovered) {
        suggestions.push({
          name: "describe-metrics",
          arguments: {
            scope: { service: serviceName },
          },
        });
      }

      // Use user question to determine intent for log search
      // e.g. "why is checkout slow?" -> "slow OR latency"
      const searchExpression = generateSearchExpression(
        context.userQuestion || ""
      );

      suggestions.push({
        name: "query-logs",
        arguments: {
          scope: { service: serviceName },
          expression: { search: searchExpression },
          limit: 20,
        },
      });
    }
  }

  return suggestions;
};
