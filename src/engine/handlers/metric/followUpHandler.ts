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
import { generateSearchExpression } from "../logQueryParser.js";
import { HandlerUtils } from "../utils.js";

// Metric patterns that indicate latency/performance issues
const LATENCY_METRIC_PATTERNS = [
  "latency",
  "duration",
  "response_time",
  "request_time",
  "p50",
  "p90",
  "p95",
  "p99",
  "http_request",
  "grpc_",
  "slow",
  "timeout",
];

export const metricFollowUpHandler: FollowUpHandler = async (
  context,
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
  const suggestedDeploymentServices = new Set<string>();

  for (const metricSeries of series.slice(0, 3)) {
    // MCP schema: service: z.string().optional()
    const service = metricSeries.service;
    // MCP schema: name: z.string()
    const metricName = metricSeries.name;

    if (service && typeof service === "string") {
      // If metric shows latency or errors, suggest checking logs
      if (typeof metricName === "string") {

        // Use smart search expression based on metric name
        // e.g. "http_request_latency" -> "latency OR lag"
        // "error_count" -> "error"
        // vocabulary handles many other cases (cpu, memory, etc.)
        const searchExpression = generateSearchExpression(metricName);

        suggestions.push({
          name: "query-logs",
          arguments: {
            scope: { service },
            expression: { search: searchExpression },
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

        // Check if this is a latency/performance metric
        const metricNameLower = metricName.toLowerCase();
        const isLatencyMetric = LATENCY_METRIC_PATTERNS.some(
          (pattern) => metricNameLower.includes(pattern)
        );

        // Suggest deployments for latency/performance metrics (common root cause)
        if (
          isLatencyMetric &&
          !suggestedDeploymentServices.has(service) &&
          !HandlerUtils.isDuplicateToolCall(context, "query-deployments", service)
        ) {
          suggestedDeploymentServices.add(service);
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
  }

  // Suggest describe-metrics for any services found in the results
  // This helps the LLM know what other metrics are available for investigation
  for (const service of suggestedDeploymentServices) {
    if (
      !HandlerUtils.isDuplicateToolCall(context, "describe-metrics", service)
    ) {
      suggestions.push({
        name: "describe-metrics",
        arguments: {
          scope: { service },
        },
      });
    }
  }

  // Also check services from the results that weren't necessarily latency related
  // We want to discover metrics for ANY service we see data for
  const allServices = new Set<string>();
  for (const metricSeries of series) {
    const service = metricSeries.service;
    if (service && typeof service === "string") {
      allServices.add(service);
    }
  }

  for (const service of allServices) {
    // Skip if we already suggested it via the latency block above (heuristic optimization)
    // Actually the duplicate check handles this, but we can be explicit or just rely on the util.
    // relying on util is safer.
    if (!HandlerUtils.isDuplicateToolCall(context, "describe-metrics", service)) {
      // Check if we already added it to suggestions in this turn
      const alreadySuggested = suggestions.some(s =>
        s.name === "describe-metrics" &&
        (s.arguments.scope as any)?.service === service
      );

      if (!alreadySuggested) {
        suggestions.push({
          name: "describe-metrics",
          arguments: {
            scope: { service },
          },
        });
      }
    }
  }

  return suggestions;
};

