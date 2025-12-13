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
import { HandlerUtils } from "../utils.js";

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

  // Extract search query from original tool call if available
  // This allows propagating search terms (e.g., "kafka") to related entity queries
  const originalQuery = toolResult.arguments?.query as string | undefined;

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
      if (!HandlerUtils.isDuplicateToolCall(_context, "query-logs", service)) {
        suggestions.push({
          name: "query-logs",
          arguments: {
            scope: { service },
            expression: { severityIn: ["error"] },
            limit: 30,
          },
        });
      }

      // Suggest discovering available metrics for the service
      // Deduplicate against existing results and history
      const alreadyDiscovered = HandlerUtils.isDuplicateToolCall(
        _context,
        "describe-metrics",
        service,
      );

      if (!alreadyDiscovered) {
        suggestions.push({
          name: "describe-metrics",
          arguments: {
            scope: { service },
          },
        });
      }

      // Suggest checking for related incidents
      // Propagate the original search query if present
      if (!HandlerUtils.isDuplicateToolCall(_context, "query-incidents", service)) {
        suggestions.push({
          name: "query-incidents",
          arguments: {
            scope: { service },
            statuses: ["active"],
            ...(originalQuery && { query: originalQuery }),
          },
        });
      }

      // Check for high-severity or latency-related alerts - suggest deployments
      const alertSeverity = alert.severity;
      const alertName = alert.name;
      const isHighSeverity =
        typeof alertSeverity === "string" &&
        (alertSeverity.toLowerCase() === "critical" ||
          alertSeverity.toLowerCase() === "error" ||
          alertSeverity.toLowerCase().includes("sev1") ||
          alertSeverity.toLowerCase().includes("sev2"));
      const isLatencyRelated =
        (typeof alertName === "string" &&
          (alertName.toLowerCase().includes("latency") ||
            alertName.toLowerCase().includes("timeout") ||
            alertName.toLowerCase().includes("slow") ||
            alertName.toLowerCase().includes("response"))) ||
        (typeof originalQuery === "string" &&
          (originalQuery.toLowerCase().includes("latency") ||
            originalQuery.toLowerCase().includes("slow")));

      if ((isHighSeverity || isLatencyRelated) &&
        !HandlerUtils.isDuplicateToolCall(_context, "query-deployments", service)) {
        suggestions.push({
          name: "query-deployments",
          arguments: {
            scope: { service },
            limit: 5,
          },
        });
      }
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
