import {
  CopilotReferences,
  LogReference,
  MetricReference,
  ToolResult,
} from '../types.js';
import { DomainRegistry, domainRegistry } from './domainRegistry.js';
import { normalizeMetricStep } from './metricUtils.js';

function collectIncidentIds(payload: any): string[] {
  const ids = new Set<string>();
  const grabId = (candidate: any) => {
    const maybeId = candidate?.id ?? candidate?.incidentId ?? candidate?.incident_id;
    if (typeof maybeId === 'string' && maybeId.trim()) ids.add(maybeId.trim());
  };

  if (Array.isArray(payload)) {
    payload.forEach((item) => grabId(item));
    return Array.from(ids);
  }

  if (payload && typeof payload === 'object') {
    grabId(payload);
    if (Array.isArray((payload as any).incidents)) {
      (payload as any).incidents.forEach((item: any) => grabId(item));
    }
  }

  return Array.from(ids);
}



export function buildReferences(results: ToolResult[], registry: DomainRegistry = domainRegistry): CopilotReferences | undefined {
  if (!results.length) return undefined;

  const incidents = new Set<string>();
  const services = new Set<string>();
  const tickets = new Set<string>();
  const metrics: MetricReference[] = [];
  const logs: LogReference[] = [];

  for (const r of results) {
    const args = (r.arguments ?? {}) as Record<string, any>;

    // Extract incident IDs from results
    collectIncidentIds(r.result).forEach((id) => incidents.add(id));

    // Get domain for this tool
    const domain = registry.getDomainForTool(r.name);
    if (!domain) continue;

    // Extract from arguments based on domain name
    if (domain.name === 'incident') {
      if (args.id) incidents.add(String(args.id).trim());
      if (args.incidentId) incidents.add(String(args.incidentId).trim());
    }

    if (domain.name === 'service') {
      if (args.service) services.add(String(args.service).trim());
      if (Array.isArray(args.services)) {
        args.services.forEach((s: any) => {
          if (typeof s === 'string' && s.trim()) services.add(s.trim());
        });
      }
    }

    if (domain.name === 'ticket') {
      if (args.id) tickets.add(String(args.id).trim());
      if (args.ticketId) tickets.add(String(args.ticketId).trim());
    }

    if (domain.name === 'metric') {
      const expression = typeof args.expression === 'string' && args.expression.trim() ? args.expression.trim() : undefined;
      if (expression) {
        // Construct a simple MetricExpression from the string
        const metric: MetricReference = {
          expression: { metricName: expression }
        };
        if (typeof args.start === 'string' && args.start.trim()) metric.start = args.start.trim();
        if (typeof args.end === 'string' && args.end.trim()) metric.end = args.end.trim();
        const step = normalizeMetricStep(args.step);
        if (step !== undefined) metric.step = step;
        if (typeof args.service === 'string' && args.service.trim()) metric.scope = { service: args.service.trim() };
        if (typeof args.scope === 'string' && args.scope.trim()) metric.scope = metric.scope ?? { service: args.scope.trim() };
        metrics.push(metric);
      }
    }

    if (domain.name === 'log') {
      const query = typeof args.query === 'string' && args.query.trim() ? args.query.trim() : undefined;
      if (query) {
        // Construct a simple LogExpression from the string
        const log: LogReference = {
          expression: { search: query }
        };
        if (typeof args.start === 'string' && args.start.trim()) log.start = args.start.trim();
        if (typeof args.end === 'string' && args.end.trim()) log.end = args.end.trim();
        if (typeof args.service === 'string' && args.service.trim()) log.scope = { service: args.service.trim() };
        if (typeof args.scope === 'string' && args.scope.trim()) log.scope = log.scope ?? { service: args.scope.trim() };
        logs.push(log);
      }
    }
  }

  const refs: CopilotReferences = {};
  if (incidents.size) refs.incidents = Array.from(incidents);
  if (services.size) refs.services = Array.from(services);
  if (tickets.size) refs.tickets = Array.from(tickets);
  if (metrics.length) refs.metrics = metrics;
  if (logs.length) refs.logs = logs;

  return Object.keys(refs).length ? refs : undefined;
}
