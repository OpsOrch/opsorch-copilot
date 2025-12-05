import {
  CopilotReferences,
  LogReference,
  MetricReference,
  ToolResult,
  JsonValue,
  JsonObject,
} from "../types.js";
import { normalizeMetricStep } from "./metricUtils.js";

/**
 * Collect incident IDs from tool result payload.
 * Uses MCP incidentSchema field: id (z.string())
 */
function collectIncidentIds(payload: JsonValue): string[] {
  const ids = new Set<string>();
  const grabId = (candidate: JsonValue) => {
    if (
      candidate &&
      typeof candidate === "object" &&
      !Array.isArray(candidate)
    ) {
      const obj = candidate as JsonObject;
      // MCP incidentSchema: id is z.string()
      const maybeId = obj.id;
      if (typeof maybeId === "string" && maybeId.trim())
        ids.add(maybeId.trim());
    }
  };

  // Handle array of incidents directly (from MCP normalized results)
  if (Array.isArray(payload)) {
    payload.forEach((item: JsonValue) => grabId(item));
  }
  // Handle object with incidents property
  else if (payload && typeof payload === "object") {
    const obj = payload as JsonObject;
    if (Array.isArray(obj.incidents)) {
      obj.incidents.forEach((item: JsonValue) => grabId(item));
    }
  }

  return Array.from(ids);
}

/**
 * Determine capability type from tool name
 */
function getCapabilityType(toolName: string): string | null {
  if (toolName.includes("incident")) return "incident";
  if (toolName.includes("service")) return "service";
  if (toolName.includes("ticket")) return "ticket";
  if (toolName.includes("alert")) return "alert";
  if (toolName.includes("metric")) return "metric";
  if (toolName.includes("log")) return "log";
  return null;
}

/**
 * Build CopilotReferences from tool results using MCP schema field names.
 *
 * MCP schema fields used:
 * - incidentSchema: id (z.string())
 * - alertSchema: id (z.string())
 * - ticketSchema: id (z.string())
 * - serviceSchema: name (z.string())
 * - logQuerySchema: expression.search (z.string())
 * - metricQuerySchema: expression.metricName (z.string())
 */
export function buildReferences(
  results: ToolResult[],
): CopilotReferences | undefined {
  if (!results.length) return undefined;

  const incidents = new Set<string>();
  const services = new Set<string>();
  const tickets = new Set<string>();
  const alerts = new Set<string>();
  const metrics: MetricReference[] = [];
  const logs: LogReference[] = [];

  for (const r of results) {
    const args = (r.arguments ?? {}) as JsonObject;

    // Extract incident IDs from results
    collectIncidentIds(r.result).forEach((id) => incidents.add(id));

    // Get capability type for this tool
    const capabilityType = getCapabilityType(r.name);
    if (!capabilityType) continue;

    // Extract from arguments based on capability type
    if (capabilityType === "incident") {
      // MCP incidentQuerySchema: id is z.string().optional()
      if (args.id) incidents.add(String(args.id).trim());
    }

    if (capabilityType === "service") {
      // MCP serviceQuerySchema: service scope field
      if (args.service) services.add(String(args.service).trim());
      // MCP serviceQuerySchema: ids is z.array(z.string()).optional()
      if (Array.isArray(args.ids)) {
        args.ids.forEach((s: JsonValue) => {
          if (typeof s === "string" && s.trim()) services.add(s.trim());
        });
      }
      // Extract service names from results (MCP serviceSchema: name)
      if (Array.isArray(r.result)) {
        r.result.forEach((svc: JsonValue) => {
          if (svc && typeof svc === "object" && !Array.isArray(svc)) {
            const svcObj = svc as JsonObject;
            if (typeof svcObj.name === "string" && svcObj.name.trim()) {
              services.add(svcObj.name.trim());
            }
          }
        });
      }
    }

    if (capabilityType === "ticket") {
      // MCP ticketQuerySchema: id is z.string().optional()
      if (args.id) tickets.add(String(args.id).trim());

      // Extract ticket IDs from results (MCP ticketSchema: id)
      if (Array.isArray(r.result)) {
        r.result.forEach((ticket: JsonValue) => {
          if (ticket && typeof ticket === "object" && !Array.isArray(ticket)) {
            const ticketObj = ticket as JsonObject;
            if (typeof ticketObj.id === "string" && ticketObj.id.trim()) {
              tickets.add(ticketObj.id.trim());
            }
          }
        });
      }
    }

    if (capabilityType === "alert") {
      // MCP alertQuerySchema: id is z.string().optional()
      if (args.id) alerts.add(String(args.id).trim());

      // For query-alerts, extract alert IDs from the result
      // Handle array result (query-alerts returns array directly)
      // MCP alertSchema: id is z.string()
      if (Array.isArray(r.result)) {
        r.result.forEach((alert: JsonValue) => {
          if (alert && typeof alert === "object" && !Array.isArray(alert)) {
            const alertObj = alert as JsonObject;
            if (typeof alertObj.id === "string" && alertObj.id.trim()) {
              alerts.add(alertObj.id.trim());
            }
          }
        });
      }
      // Handle object result with alerts property
      else if (r.result && typeof r.result === "object") {
        const resultObj = r.result as JsonObject;
        if (Array.isArray(resultObj.alerts)) {
          resultObj.alerts.forEach((alert: JsonValue) => {
            if (alert && typeof alert === "object" && !Array.isArray(alert)) {
              const alertObj = alert as JsonObject;
              if (typeof alertObj.id === "string" && alertObj.id.trim()) {
                alerts.add(alertObj.id.trim());
              }
            }
          });
        }
      }
    }

    if (capabilityType === "metric") {
      let expression: string | undefined;

      // MCP metricQuerySchema: expression can be string or object with metricName
      if (typeof args.expression === "string" && args.expression.trim()) {
        expression = args.expression.trim();
      } else if (
        args.expression &&
        typeof args.expression === "object" &&
        !Array.isArray(args.expression)
      ) {
        const metricName = (args.expression as JsonObject).metricName;
        if (typeof metricName === "string" && metricName.trim()) {
          expression = metricName.trim();
        }
      }

      if (expression) {
        // Construct a simple MetricExpression from the string
        const metric: MetricReference = {
          expression: { metricName: expression },
        };
        if (typeof args.start === "string" && args.start.trim())
          metric.start = args.start.trim();
        if (typeof args.end === "string" && args.end.trim())
          metric.end = args.end.trim();
        const step = normalizeMetricStep(args.step);
        if (step !== undefined) metric.step = step;
        if (typeof args.service === "string" && args.service.trim())
          metric.scope = { service: args.service.trim() };

        // Handle object scope (MCP uses scope object)
        if (
          args.scope &&
          typeof args.scope === "object" &&
          !Array.isArray(args.scope) &&
          (args.scope as JsonObject).service
        ) {
          metric.scope = metric.scope ?? {
            service: (args.scope as JsonObject).service as string,
          };
        }

        metrics.push(metric);
      }
    }

    if (capabilityType === "log") {
      let query: string | undefined;

      // MCP logQuerySchema: expression is object with search field
      if (args.expression && typeof args.expression === "object" && !Array.isArray(args.expression)) {
        const expr = args.expression as JsonObject;
        // MCP logExpressionSchema: search is z.string().optional()
        if (typeof expr.search === "string") query = expr.search;
      }

      if (query) {
        // Construct a simple LogExpression from the string
        const log: LogReference = {
          expression: { search: query },
        };
        if (typeof args.start === "string" && args.start.trim())
          log.start = args.start.trim();
        if (typeof args.end === "string" && args.end.trim())
          log.end = args.end.trim();
        if (typeof args.service === "string" && args.service.trim())
          log.scope = { service: args.service.trim() };

        // Handle object scope (MCP uses scope object)
        if (
          args.scope &&
          typeof args.scope === "object" &&
          !Array.isArray(args.scope) &&
          (args.scope as JsonObject).service
        ) {
          log.scope = log.scope ?? { service: (args.scope as JsonObject).service as string };
        }

        logs.push(log);
      }
    }
  }

  const refs: CopilotReferences = {};
  if (incidents.size) refs.incidents = Array.from(incidents);
  if (services.size) refs.services = Array.from(services);
  if (tickets.size) refs.tickets = Array.from(tickets);
  if (alerts.size) refs.alerts = Array.from(alerts);
  if (metrics.length) refs.metrics = metrics;
  if (logs.length) refs.logs = logs;

  return Object.keys(refs).length ? refs : undefined;
}

