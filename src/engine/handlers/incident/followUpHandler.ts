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
import type { ToolCall, JsonObject, HandlerContext } from "../../../types.js";
import { HandlerUtils } from "../utils.js";
import { generateSearchExpression } from "../logQueryParser.js";

/**
 * Helper to track and deduplicate suggestions within a handler.
 * Prevents the same tool+scope combination from being suggested multiple times.
 */
class SuggestionTracker {
  private seen = new Set<string>();
  private context: HandlerContext;

  constructor(context: HandlerContext) {
    this.context = context;
  }

  add(call: ToolCall): boolean {
    // Create a key based on tool name and service scope (if present)
    const scope = call.arguments?.scope as JsonObject | undefined;
    const service = (scope?.service as string) ?? "_no_service_";
    const key = `${call.name}:${service}`;

    if (this.seen.has(key)) {
      return false; // Duplicate within this suggestion batch
    }

    // Check history/results using generalized utility
    if (service !== "_no_service_") {
      if (HandlerUtils.isDuplicateToolCall(this.context, call.name, service)) {
        return false;
      }
    }

    this.seen.add(key);
    return true;
  }

  filter(calls: ToolCall[]): ToolCall[] {
    return calls.filter((call) => this.add(call));
  }
}

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
  const tracker = new SuggestionTracker(context);

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

  // Extract search query from original tool call if available
  // This allows propagating search terms (e.g., "kafka") to related entity queries
  const originalQuery = toolResult.arguments?.query as string | undefined;

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
      // Always suggest timeline when an incident is found, as it provides
      // critical progression data that static incident text lacks.
      suggestions.push({
        name: "get-incident-timeline",
        arguments: {
          id: incidentId,
        },
      });

      // Auto-inject drill-down tools if conditions are met
      if (shouldAutoInject || question.includes("timeline")) {
        // For root cause analysis, check logs and metrics if service is known
        if (service && typeof service === "string") {
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

          // Extract smarter search terms from title if available
          const title = firstIncident.title;
          const searchExpression =
            typeof title === "string"
              ? generateSearchExpression(title)
              : "error OR exception";

          suggestions.push({
            name: "query-logs",
            arguments: {
              scope: { service },
              expression: { search: searchExpression },
              start: timeWindow.start.toISOString(),
              end: timeWindow.end.toISOString(),
              limit: 100,
            },
          });

          // Fetch related alerts for the service - alerts provide critical context
          // about what monitoring detected during the incident
          // Propagate the original search query if present
          suggestions.push({
            name: "query-alerts",
            arguments: {
              scope: { service },
              statuses: ["firing", "acknowledged"],
              limit: 10,
              ...(originalQuery && { query: originalQuery }),
            },
          });
        }
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

      const timeWindow = HandlerUtils.expandTimeWindow(
        undefined,
        undefined,
        15,
      );

      for (const serviceValue of services) {
        // Extract smarter search terms from title if available
        // Find the incident object corresponding to this service
        const incident = incidents.find((inc) => inc.service === serviceValue);
        const searchExpression =
          incident && typeof incident.title === "string"
            ? generateSearchExpression(incident.title as string)
            : "error OR exception";

        suggestions.push({
          name: "query-logs",
          arguments: {
            scope: { service: serviceValue },
            expression: { search: searchExpression },
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

        // Propagate the original search query if present
        suggestions.push({
          name: "query-alerts",
          arguments: {
            scope: { service: serviceValue },
            statuses: ["firing", "pending"],
            limit: 20,
            ...(originalQuery && { query: originalQuery }),
          },
        });
      }
    }
  }

  // Deduplicate suggestions before returning
  return tracker.filter(suggestions);
};
