/**
 * Incident Follow-up Handler
 *
 * Field names match MCP incidentSchema:
 * - id: string
 * - title: string
 * - status: string
 * - severity: string
 * - service?: string
 * - createdAt: datetime
 * - updatedAt: datetime
 */

import type { FollowUpHandler } from "../handlers.js";
import type { ToolCall, JsonObject } from "../../../types.js";
import { HandlerUtils } from "../utils.js";

/**
 * Follow-up handler for incident-related tool results
 *
 * Suggests relevant next actions after querying incidents
 */
export const incidentFollowUpHandler: FollowUpHandler = async (
  context,
  toolResult,
): Promise<ToolCall[]> => {
  const suggestions: ToolCall[] = [];

  if (!toolResult.result || typeof toolResult.result !== "object") {
    return suggestions;
  }

  // query-incidents returns z.array(incidentSchema), get-incident returns incidentSchema
  let incidents: JsonObject[] = [];
  if (Array.isArray(toolResult.result)) {
    incidents = toolResult.result as JsonObject[];
  } else {
    incidents = [toolResult.result as JsonObject];
  }

  // Check for drill-down patterns
  const question = context.userQuestion.toLowerCase();
  const drillDownPatterns = [
    "root cause",
    "\\bwhy\\b",
    "trigger",
    "diagnos",
    "timeline",
    "before",
    "after",
    "since",
  ];
  const hasDrillDown = drillDownPatterns.some((pattern) => {
    const regex = new RegExp(pattern, "i");
    return regex.test(question);
  });

  // Auto-inject logic
  const autoInjectConditions = ["root cause", "why", "timeline"];
  const shouldAutoInject = autoInjectConditions.some((condition) =>
    question.includes(condition),
  );

  if (incidents.length > 0) {
    const firstIncident = incidents[0];

    // MCP schema: id: z.string()
    const incidentId = firstIncident.id;
    // MCP schema: service: z.string().optional()
    const service = firstIncident.service;
    // MCP schema: createdAt: z.string().datetime()
    const createdAt = firstIncident.createdAt;
    // MCP schema: updatedAt: z.string().datetime()
    const updatedAt = firstIncident.updatedAt;

    if (incidentId && typeof incidentId === "string") {
      // Auto-inject timeline if conditions are met
      if (shouldAutoInject || question.includes("timeline")) {
        suggestions.push({
          name: "get-incident-timeline",
          arguments: {
            id: incidentId,
          },
        });

        // For root cause analysis, check logs and metrics if service is known
        if (shouldAutoInject && service && typeof service === "string") {
          // Use incident time window if available
          const timeWindow = HandlerUtils.expandTimeWindow(
            typeof createdAt === "string" ? createdAt : undefined,
            typeof updatedAt === "string" ? updatedAt : undefined,
            15,
          );

          // Suggest discovering available metrics for the service
          suggestions.push({
            name: "describe-metrics",
            arguments: {
              scope: { service },
            },
          });

          suggestions.push({
            name: "query-logs",
            arguments: {
              scope: { service },
              expression: { search: "error OR exception" },
              start: timeWindow.start.toISOString(),
              end: timeWindow.end.toISOString(),
              limit: 100,
            },
          });

          // Fetch related alerts for the service - alerts provide critical context
          // about what monitoring detected during the incident
          suggestions.push({
            name: "query-alerts",
            arguments: {
              scope: { service },
              statuses: ["firing", "acknowledged"],
              limit: 10,
            },
          });
        }
      } else if (hasDrillDown) {
        // Suggest getting incident timeline for drill-down
        // (get-incident is redundant since query-incidents returns the same data)
        suggestions.push({
          name: "get-incident-timeline",
          arguments: { id: incidentId },
        });
      }
    }

    // Extract keywords for priority terms
    const keywords = HandlerUtils.extractKeywords(context.userQuestion, [
      "the",
      "a",
      "an",
      "incident",
      "issue",
    ]);
    const priorityTerms = ["timeout", "latency", "database"];
    const hasPriorityTerms = priorityTerms.some((term) =>
      keywords.includes(term),
    );

    // If priority terms are mentioned, suggest related investigations
    if (hasPriorityTerms) {
      const services = incidents
        .map((inc) => inc.service)
        .filter((s): s is string => typeof s === "string")
        .slice(0, 2);

      for (const serviceValue of services) {
        if (keywords.includes("timeout") || keywords.includes("latency")) {
          suggestions.push({
            name: "describe-metrics",
            arguments: {
              scope: { service: serviceValue },
            },
          });
        }

        if (keywords.includes("database")) {
          suggestions.push({
            name: "query-logs",
            arguments: {
              scope: { service: serviceValue },
              expression: { search: "database OR db" },
              limit: 100,
            },
          });
        }
      }
    }

    // If incidents are recent and no specific drill-down, suggest broader investigation
    if (!hasDrillDown && !shouldAutoInject) {
      const services = incidents
        .map((inc) => inc.service)
        .filter((s): s is string => typeof s === "string")
        .slice(0, 1);

      const timeWindow = HandlerUtils.expandTimeWindow(undefined, undefined, 15);

      for (const serviceValue of services) {
        suggestions.push({
          name: "query-logs",
          arguments: {
            scope: { service: serviceValue },
            expression: { search: "error OR exception" },
            start: timeWindow.start.toISOString(),
            end: timeWindow.end.toISOString(),
            limit: 100,
          },
        });

        suggestions.push({
          name: "describe-metrics",
          arguments: {
            scope: { service: serviceValue },
          },
        });

        suggestions.push({
          name: "query-alerts",
          arguments: {
            scope: { service: serviceValue },
            statuses: ["firing", "pending"],
            limit: 20,
          },
        });
      }
    }
  }

  return suggestions;
};
