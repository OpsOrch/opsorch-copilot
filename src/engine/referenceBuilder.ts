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
 * Collect deployment IDs from tool result payload.
 * Uses MCP deploymentSchema field: id (z.string())
 */
function collectDeploymentIds(payload: JsonValue): string[] {
  const ids = new Set<string>();
  const grabId = (candidate: JsonValue) => {
    if (
      candidate &&
      typeof candidate === "object" &&
      !Array.isArray(candidate)
    ) {
      const obj = candidate as JsonObject;
      // MCP deploymentSchema: id is z.string()
      const maybeId = obj.id;
      if (typeof maybeId === "string" && maybeId.trim())
        ids.add(maybeId.trim());
    }
  };

  // Handle array of deployments directly (from MCP normalized results)
  if (Array.isArray(payload)) {
    payload.forEach((item: JsonValue) => grabId(item));
  }
  // Handle object with deployments property
  else if (payload && typeof payload === "object") {
    const obj = payload as JsonObject;
    if (Array.isArray(obj.deployments)) {
      obj.deployments.forEach((item: JsonValue) => grabId(item));
    }
  }

  return Array.from(ids);
}

/**
 * Collect team IDs and names from tool result payload.
 * Uses MCP teamSchema fields: id (z.string()), name (z.string())
 */
function collectTeamIds(payload: JsonValue): string[] {
  const ids = new Set<string>();
  const grabTeamInfo = (candidate: JsonValue) => {
    if (
      candidate &&
      typeof candidate === "object" &&
      !Array.isArray(candidate)
    ) {
      const obj = candidate as JsonObject;
      // MCP teamSchema: id is z.string()
      const maybeId = obj.id;
      if (typeof maybeId === "string" && maybeId.trim())
        ids.add(maybeId.trim());
      // MCP teamSchema: name is z.string()
      const maybeName = obj.name;
      if (typeof maybeName === "string" && maybeName.trim())
        ids.add(maybeName.trim());
    }
  };

  // Handle array of teams directly (from MCP normalized results)
  if (Array.isArray(payload)) {
    payload.forEach((item: JsonValue) => grabTeamInfo(item));
  }
  // Handle object with teams property
  else if (payload && typeof payload === "object") {
    const obj = payload as JsonObject;
    if (Array.isArray(obj.teams)) {
      obj.teams.forEach((item: JsonValue) => grabTeamInfo(item));
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
  if (toolName.includes("deployment")) return "deployment";
  if (toolName.includes("team")) return "team";
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
  const deployments = new Set<string>();
  const teams = new Set<string>();
  const metrics: MetricReference[] = [];
  const logs: LogReference[] = [];

  for (const r of results) {
    const args = (r.arguments ?? {}) as JsonObject;

    // Extract services and teams from scope for ALL tools (universal extraction)
    if (
      args.scope &&
      typeof args.scope === "object" &&
      !Array.isArray(args.scope)
    ) {
      const scopeService = (args.scope as JsonObject).service;
      if (typeof scopeService === "string" && scopeService.trim()) {
        services.add(scopeService.trim());
      }
      const scopeTeam = (args.scope as JsonObject).team;
      if (typeof scopeTeam === "string" && scopeTeam.trim()) {
        teams.add(scopeTeam.trim());
      }
    }

    // Get capability type for this tool
    const capabilityType = getCapabilityType(r.name);
    if (!capabilityType) continue;

    // Skip discovery tools for references (they return metadata, not data)
    if (r.name === "describe-metrics") continue;

    // Extract from arguments based on capability type
    if (capabilityType === "incident") {
      // MCP incidentQuerySchema: id is z.string().optional()
      if (args.id) incidents.add(String(args.id).trim());
      // Extract incident IDs from results (only for incident tools, not alerts!)
      collectIncidentIds(r.result).forEach((id) => incidents.add(id));
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

      // For query-alerts, extract alert IDs and services from the result
      // Handle array result (query-alerts returns array directly)
      // MCP alertSchema: id is z.string()
      if (Array.isArray(r.result)) {
        r.result.forEach((alert: JsonValue) => {
          if (alert && typeof alert === "object" && !Array.isArray(alert)) {
            const alertObj = alert as JsonObject;
            if (typeof alertObj.id === "string" && alertObj.id.trim()) {
              alerts.add(alertObj.id.trim());
            }
            // Extract service from alert scope
            if (alertObj.scope && typeof alertObj.scope === "object" && !Array.isArray(alertObj.scope)) {
              const alertService = (alertObj.scope as JsonObject).service;
              if (typeof alertService === "string" && alertService.trim()) {
                services.add(alertService.trim());
              }
            }
            // Extract services from alert fields
            if (alertObj.fields && typeof alertObj.fields === "object" && !Array.isArray(alertObj.fields)) {
              const fields = alertObj.fields as JsonObject;
              if (typeof fields.service === "string" && fields.service.trim()) {
                services.add(fields.service.trim());
              }
              // Extract affectedServices array
              if (Array.isArray(fields.affectedServices)) {
                fields.affectedServices.forEach((svc: JsonValue) => {
                  if (typeof svc === "string" && svc.trim()) {
                    services.add(svc.trim());
                  }
                });
              }
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
              // Extract service from alert scope
              if (alertObj.scope && typeof alertObj.scope === "object" && !Array.isArray(alertObj.scope)) {
                const alertService = (alertObj.scope as JsonObject).service;
                if (typeof alertService === "string" && alertService.trim()) {
                  services.add(alertService.trim());
                }
              }
              // Extract services from alert fields
              if (alertObj.fields && typeof alertObj.fields === "object" && !Array.isArray(alertObj.fields)) {
                const fields = alertObj.fields as JsonObject;
                if (typeof fields.service === "string" && fields.service.trim()) {
                  services.add(fields.service.trim());
                }
                if (Array.isArray(fields.affectedServices)) {
                  fields.affectedServices.forEach((svc: JsonValue) => {
                    if (typeof svc === "string" && svc.trim()) {
                      services.add(svc.trim());
                    }
                  });
                }
              }
            }
          });
        }
      }
    }

    if (capabilityType === "deployment") {
      // MCP deploymentQuerySchema: id is z.string().optional()
      if (args.id) deployments.add(String(args.id).trim());
      // Extract deployment IDs from results (only for deployment tools!)
      collectDeploymentIds(r.result).forEach((id) => deployments.add(id));
    }

    if (capabilityType === "team") {
      // MCP teamQuerySchema: id is z.string().optional()
      if (args.id) teams.add(String(args.id).trim());
      // Extract team IDs and names from results (only for team tools!)
      collectTeamIds(r.result).forEach((id) => teams.add(id));
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

      // Extract metric scope info for reuse
      let metricScope: { service: string } | undefined;
      if (typeof args.service === "string" && args.service.trim()) {
        metricScope = { service: args.service.trim() };
      } else if (
        args.scope &&
        typeof args.scope === "object" &&
        !Array.isArray(args.scope) &&
        (args.scope as JsonObject).service
      ) {
        metricScope = { service: (args.scope as JsonObject).service as string };
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
        if (metricScope) metric.scope = metricScope;

        metrics.push(metric);
      } else {
        // No expression in args - try to extract metric names from result
        // This handles cases where query-metrics is called without explicit expression
        if (Array.isArray(r.result)) {
          r.result.forEach((series: JsonValue) => {
            if (series && typeof series === "object" && !Array.isArray(series)) {
              const seriesObj = series as JsonObject;
              // Check for metricName or name field in result
              const name = seriesObj.metricName ?? seriesObj.name;
              if (typeof name === "string" && name.trim()) {
                const metric: MetricReference = {
                  expression: { metricName: name.trim() },
                };
                if (typeof args.start === "string" && args.start.trim())
                  metric.start = args.start.trim();
                if (typeof args.end === "string" && args.end.trim())
                  metric.end = args.end.trim();
                const step = normalizeMetricStep(args.step);
                if (step !== undefined) metric.step = step;
                if (metricScope) metric.scope = metricScope;

                metrics.push(metric);
              }
            }
          });
        }
      }
    }

    // Only extract log references from log tools
    if (capabilityType === "log") {
      let query: string | undefined;

      // MCP logQuerySchema: expression is object with search field
      if (args.expression && typeof args.expression === "object" && !Array.isArray(args.expression)) {
        const expr = args.expression as JsonObject;
        // MCP logExpressionSchema: search is z.string().optional()
        if (typeof expr.search === "string") query = expr.search;
      }

      // Check if we have enough to make a reference (search OR filters)
      const hasSearch = typeof query === "string";
      const exprObj = (args.expression as JsonObject) || {};
      const hasFilters = Array.isArray(exprObj.filters) && exprObj.filters.length > 0;

      if (hasSearch || hasFilters) {
        // Construct a simple LogReference
        const log: LogReference = {
          expression: {},
        };
        if (hasSearch) log.expression.search = query;

        // Copy filters if present
        if (hasFilters) {
          log.expression.filters = exprObj.filters as { field: string; operator: string; value: string }[];
        }

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
  if (deployments.size) refs.deployments = Array.from(deployments);
  if (teams.size) refs.teams = Array.from(teams);
  if (metrics.length) refs.metrics = metrics;
  if (logs.length) refs.logs = logs;

  return Object.keys(refs).length ? refs : undefined;
}

