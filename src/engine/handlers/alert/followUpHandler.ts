/**
 * Alert Follow-up Handler
 *
 * Field names match MCP alertSchema:
 * - id: string
 * - status: string
 * - severity: string
 * - service?: string
 * - createdAt: datetime
 */

import type { FollowUpHandler } from "../handlers.js";
import type { ToolCall, JsonObject } from "../../../types.js";

/**
 * Follow-up handler for alert-related tool results
 *
 * Suggests relevant next actions after querying alerts
 */
export const alertFollowUpHandler: FollowUpHandler = async (
  _context,
  toolResult,
): Promise<ToolCall[]> => {
  const suggestions: ToolCall[] = [];

  if (!toolResult.result || typeof toolResult.result !== "object") {
    return suggestions;
  }

  // query-alerts returns z.array(alertSchema)
  if (!Array.isArray(toolResult.result)) {
    return suggestions;
  }

  const alerts = toolResult.result as JsonObject[];

  // Suggest follow-ups for active alerts (MCP schema: status: z.string())
  const activeAlerts = alerts.filter((alert) => {
    const status = alert.status;
    return (
      typeof status === "string" &&
      (status.toLowerCase() === "active" || status.toLowerCase() === "firing")
    );
  });

  for (const alert of activeAlerts.slice(0, 3)) {
    // MCP schema: service: z.string().optional()
    const service = alert.service;

    if (service && typeof service === "string") {
      // Suggest checking logs for the affected service
      suggestions.push({
        name: "query-logs",
        arguments: {
          scope: { service },
          expression: { severityIn: ["error"] },
          limit: 30,
        },
      });

      // Suggest discovering available metrics for the service
      suggestions.push({
        name: "describe-metrics",
        arguments: {
          scope: { service },
        },
      });

      // Suggest checking for related incidents
      suggestions.push({
        name: "query-incidents",
        arguments: {
          scope: { service },
          statuses: ["active"],
        },
      });
    }
  }

  // If there are many alerts, suggest checking overall system health
  if (alerts.length > 5) {
    suggestions.push({
      name: "describe-metrics",
      arguments: {},
    });
  }

  return suggestions;
};
