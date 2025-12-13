/**
 * Log Follow-up Handler
 *
 * Field names match MCP logEntrySchema:
 * - timestamp: datetime
 * - message: string
 * - severity?: string
 * - service?: string
 * - labels?: Record<string, string>
 */

import type { FollowUpHandler } from "../handlers.js";
import type { ToolCall, JsonObject } from "../../../types.js";
import { HandlerUtils } from "../utils.js";

export const logFollowUpHandler: FollowUpHandler = async (
  context,
  toolResult,
): Promise<ToolCall[]> => {
  const suggestions: ToolCall[] = [];

  if (!toolResult.result || typeof toolResult.result !== "object") {
    return suggestions;
  }

  // query-logs returns z.array(logEntrySchema)
  if (!Array.isArray(toolResult.result)) {
    return suggestions;
  }

  const logs = toolResult.result as JsonObject[];

  // Filter for error logs using MCP schema fields
  const errorLogs = logs.filter((log) => {
    // MCP schema: severity: z.string().optional()
    const severity = log.severity;
    // MCP schema: message: z.string()
    const message = log.message;
    return (
      severity === "error" ||
      severity === "ERROR" ||
      (typeof message === "string" && message.toLowerCase().includes("error"))
    );
  });

  if (errorLogs.length > 0) {
    const services = new Set<string>();
    const errorPatterns = new Set<string>();

    for (const log of errorLogs.slice(0, 10)) {
      // MCP schema: message: z.string()
      const message = log.message;
      if (typeof message === "string") {
        const serviceNames = HandlerUtils.extractServiceNames(message);
        serviceNames.forEach((name) => services.add(name));
        const patterns = HandlerUtils.extractErrorPatterns(message);
        patterns.forEach((pattern) => errorPatterns.add(pattern));
      }

      // Also capture service from the log entry itself
      // MCP schema: service: z.string().optional()
      const logService = log.service;
      if (typeof logService === "string") {
        services.add(logService);
      }
    }

    // Check if error patterns suggest deployment-related issues
    const deploymentRelatedPatterns = [
      "timeout",
      "connection",
      "gateway timeout",
      "service unavailable",
      "500",
      "502",
      "503",
      "504",
    ];
    const hasDeploymentRelatedErrors = deploymentRelatedPatterns.some(
      (pattern) => errorPatterns.has(pattern)
    );

    // Also check for explicit deployment mentions in error logs
    const hasDeploymentMention = errorLogs.some((log) => {
      const message = log.message;
      if (typeof message !== "string") return false;
      const lower = message.toLowerCase();
      return (
        lower.includes("deploy") ||
        lower.includes("version") ||
        lower.includes("rollback") ||
        lower.includes("release") ||
        lower.includes("new build")
      );
    });

    // Also check user question for latency/performance context
    const questionLower = context.userQuestion.toLowerCase();
    const questionHasLatencyContext =
      questionLower.includes("latency") ||
      questionLower.includes("slow") ||
      questionLower.includes("timeout") ||
      questionLower.includes("performance");

    // Suggest discovering available metrics for affected services
    for (const service of Array.from(services).slice(0, 2)) {
      // Deduplicate against existing results and history
      const alreadyDiscovered = HandlerUtils.isDuplicateToolCall(
        context,
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

      // Suggest deployments when error patterns indicate possible deployment issues
      if (
        (hasDeploymentRelatedErrors || hasDeploymentMention || questionHasLatencyContext) &&
        !HandlerUtils.isDuplicateToolCall(context, "query-deployments", service)
      ) {
        suggestions.push({
          name: "query-deployments",
          arguments: {
            scope: { service },
            limit: 5,
          },
        });
      }
    }

    if (services.size > 0) {
      if (!HandlerUtils.isDuplicateToolCall(context, "query-incidents")) {
        suggestions.push({
          name: "query-incidents",
          arguments: {
            statuses: ["active"],
            limit: 10,
          },
        });
      }
    }
  }

  return suggestions;
};
