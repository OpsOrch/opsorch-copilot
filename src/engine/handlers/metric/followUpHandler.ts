/**
 * Metric Follow-up Handler
 *
 * Field names match MCP metricSeriesSchema:
 * - name: string
 * - service?: string
 * - labels?: Record<string, any>
 * - points: Array<{ timestamp: datetime, value: number }>
 */

import type { FollowUpHandler } from "../handlers.js";
import type { ToolCall, JsonObject } from "../../../types.js";

export const metricFollowUpHandler: FollowUpHandler = async (
  _context,
  toolResult,
): Promise<ToolCall[]> => {
  const suggestions: ToolCall[] = [];

  if (!toolResult.result || typeof toolResult.result !== "object") {
    return suggestions;
  }

  // query-metrics returns z.array(metricSeriesSchema)
  if (!Array.isArray(toolResult.result)) {
    return suggestions;
  }

  const series = toolResult.result as JsonObject[];

  for (const metricSeries of series.slice(0, 3)) {
    // MCP schema: service: z.string().optional()
    const service = metricSeries.service;
    // MCP schema: name: z.string()
    const metricName = metricSeries.name;

    if (service && typeof service === "string") {
      // If metric shows latency or errors, suggest checking logs
      if (
        typeof metricName === "string" &&
        (metricName.toLowerCase().includes("latency") ||
          metricName.toLowerCase().includes("error"))
      ) {
        suggestions.push({
          name: "query-logs",
          arguments: {
            scope: { service },
            expression: { severityIn: ["error"] },
            limit: 50,
          },
        });

        suggestions.push({
          name: "query-alerts",
          arguments: {
            scope: { service },
            statuses: ["firing"],
            limit: 10,
          },
        });
      }
    }
  }

  return suggestions;
};
