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
import type { ToolCall, ToolResult, JsonObject } from "../../../types.js";
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

function extractMetricNames(result: ToolResult["result"]): string[] {
  if (Array.isArray(result)) {
    return result
      .map((entry) => {
        if (typeof entry === "string") return entry;
        if (entry && typeof entry === "object" && "name" in entry) {
          const name = (entry as JsonObject).name;
          return typeof name === "string" ? name : undefined;
        }
        return undefined;
      })
      .filter((name): name is string => typeof name === "string" && name.length > 0);
  }

  if (result && typeof result === "object") {
    const metrics = (result as JsonObject).metrics;
    if (Array.isArray(metrics)) {
      return extractMetricNames(metrics);
    }
  }

  return [];
}

function shouldQueryDiscoveredMetrics(question: string): boolean {
  const lower = question.toLowerCase();
  const discoveryOnlyPatterns = [
    "available metrics",
    "list metrics",
    "what metrics",
    "which metrics",
  ];
  if (discoveryOnlyPatterns.some((pattern) => lower.includes(pattern))) {
    return false;
  }

  const investigationTerms = [
    "metric",
    "metrics",
    "cpu",
    "memory",
    "latency",
    "p95",
    "p99",
    "throughput",
    "request",
    "error",
  ];
  const actionTerms = [
    "check",
    "show",
    "inspect",
    "analy",
    "graph",
    "trend",
    "root cause",
    "why",
    "high",
  ];

  return (
    investigationTerms.some((term) => lower.includes(term)) &&
    actionTerms.some((term) => lower.includes(term))
  );
}

function selectMetricName(question: string, metricNames: string[]): string | undefined {
  const lower = question.toLowerCase();
  const preferredTokens = [
    "cpu",
    "memory",
    "latency",
    "p99",
    "p95",
    "throughput",
    "request",
    "error",
  ];

  for (const token of preferredTokens) {
    if (!lower.includes(token)) continue;
    const match = metricNames.find((name) => name.toLowerCase().includes(token));
    if (match) return match;
  }

  return metricNames[0];
}

function getIncidentTimeWindow(context: Parameters<FollowUpHandler>[0]): {
  start: string;
  end: string;
} | null {
  for (const result of context.toolResults) {
    if (result.name !== "query-incidents" && result.name !== "get-incident") {
      continue;
    }

    const incident = Array.isArray(result.result)
      ? result.result[0]
      : result.result;
    if (!incident || typeof incident !== "object") {
      continue;
    }

    const incidentObject = incident as JsonObject;
    const startValue = incidentObject.startTime ?? incidentObject.createdAt;
    const endValue = incidentObject.endTime ?? incidentObject.updatedAt;
    if (typeof startValue !== "string" && typeof endValue !== "string") {
      continue;
    }

    const expanded = HandlerUtils.expandTimeWindow(
      typeof startValue === "string" ? startValue : undefined,
      typeof endValue === "string" ? endValue : undefined,
      15,
    );
    return {
      start: expanded.start.toISOString(),
      end: expanded.end.toISOString(),
    };
  }

  return null;
}

export const metricFollowUpHandler: FollowUpHandler = async (
  context,
  toolResult,
): Promise<ToolCall[]> => {
  const suggestions: ToolCall[] = [];

  if (toolResult.name === "describe-metrics") {
    const metricNames = extractMetricNames(toolResult.result);
    const scope = toolResult.arguments?.scope as JsonObject | undefined;
    const service = scope?.service;

    if (
      typeof service === "string" &&
      metricNames.length > 0 &&
      shouldQueryDiscoveredMetrics(context.userQuestion) &&
      !HandlerUtils.isDuplicateToolCall(context, "query-metrics", service)
    ) {
      const metricName = selectMetricName(context.userQuestion, metricNames);
      if (metricName) {
        const incidentWindow = getIncidentTimeWindow(context);
        const end = incidentWindow?.end ?? new Date().toISOString();
        const start = incidentWindow?.start ?? new Date(Date.now() - 60 * 60 * 1000).toISOString();

        suggestions.push({
          name: "query-metrics",
          arguments: {
            scope: { service },
            expression: { metricName },
            step: 60,
            start,
            end,
          },
        });
      }
    }

    return suggestions;
  }

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
