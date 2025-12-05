import { ToolCall } from "../types.js";

/**
 * Simple heuristic-based fallback plan when LLM planning fails.
 * This is intentionally kept simple and doesn't use QueryBuilder
 * since it's only used as a last resort fallback.
 *
 * MCP schema fields used:
 * - incidentQuerySchema: severities (z.array(z.string()))
 * - logQuerySchema: expression.search (z.string())
 * - metricQuerySchema: expression.metricName (z.string())
 * - alertQuerySchema: scope.service (z.string())
 */
export function inferPlanFromQuestion(question: string): ToolCall[] {
  const q = question.toLowerCase();
  const calls: ToolCall[] = [];

  if (q.includes("incident") || q.includes("impactful")) {
    // MCP incidentQuerySchema: severities is z.array(z.string()).optional()
    calls.push({
      name: "query-incidents",
      arguments: { limit: 2, severities: ["sev1", "sev2"] },
    });
  }
  if (q.includes("severity") || q.includes("escalation")) {
    // MCP: get-incident-timeline expects id: z.string()
    calls.push({
      name: "get-incident-timeline",
      arguments: { id: "{{incidentId}}" },
    });
  }
  if (q.includes("log")) {
    // MCP logQuerySchema: expression is object with search field
    calls.push({
      name: "query-logs",
      arguments: {
        expression: { search: "error OR 500" },
        start: "{{start}}",
        end: "{{end}}",
      },
    });
  }
  if (
    q.includes("metric") ||
    q.includes("latency") ||
    q.includes("cpu") ||
    q.includes("memory") ||
    q.includes("traffic")
  ) {
    // MCP metricQuerySchema: expression is object with metricName field
    // Note: In fallback mode, we suggest using describe-metrics first
    // but keep a simple fallback for common metrics
    calls.push({
      name: "query-metrics",
      arguments: {
        expression: { metricName: "latency_p95" },
        start: "{{start}}",
        end: "{{end}}",
        step: 60,
      },
    });
  }
  if (q.includes("ticket") || q.includes("jira")) {
    // MCP ticketQuerySchema uses expression.search for text queries
    calls.push({
      name: "query-tickets",
      arguments: {},
    });
  }
  if (
    q.includes("alert") ||
    q.includes("page") ||
    q.includes("pagerduty") ||
    q.includes("detector")
  ) {
    // MCP alertQuerySchema: scope is object with service field
    calls.push({
      name: "query-alerts",
      arguments: { scope: { service: "{{service}}" }, limit: 5 },
    });
  }
  if (q.includes("service")) {
    calls.push({ name: "query-services", arguments: {} });
  }
  return calls;
}

