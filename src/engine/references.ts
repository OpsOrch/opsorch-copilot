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

export function sanitizeReferences(raw: any): CopilotReferences | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const toStrings = (value: any) =>
    (Array.isArray(value) ? value.map((v) => (typeof v === 'string' ? v.trim() : '')).filter(Boolean) : []) as string[];
  const refs: CopilotReferences = {};

  const metrics: MetricReference[] = Array.isArray((raw as any).metrics)
    ? ((raw as any).metrics as any[])
      .map((m) => {
        if (!m || typeof m !== 'object') return undefined;
        const expression = typeof m.expression === 'string' ? m.expression.trim() : '';
        if (!expression) return undefined;
        const metric: MetricReference = { expression };
        if (typeof m.start === 'string' && m.start.trim()) metric.start = m.start.trim();
        if (typeof m.end === 'string' && m.end.trim()) metric.end = m.end.trim();
        const step = normalizeMetricStep(m.step);
        if (step !== undefined) metric.step = step;
        if (typeof m.scope === 'string' && m.scope.trim()) metric.scope = m.scope.trim();
        return metric;
      })
      .filter(Boolean) as MetricReference[]
    : [];

  const logs: LogReference[] = Array.isArray((raw as any).logs)
    ? ((raw as any).logs as any[])
      .map((l) => {
        if (!l || typeof l !== 'object') return undefined;
        const query = typeof l.query === 'string' ? l.query.trim() : '';
        if (!query) return undefined;
        const log: LogReference = { query };
        if (typeof l.start === 'string' && l.start.trim()) log.start = l.start.trim();
        if (typeof l.end === 'string' && l.end.trim()) log.end = l.end.trim();
        if (typeof l.service === 'string' && l.service.trim()) log.service = l.service.trim();
        if (typeof l.scope === 'string' && l.scope.trim()) log.scope = l.scope.trim();
        return log;
      })
      .filter(Boolean) as LogReference[]
    : [];

  const incidents = toStrings((raw as any).incidents);
  const services = toStrings((raw as any).services);
  const tickets = toStrings((raw as any).tickets);

  if (incidents.length) refs.incidents = incidents;
  if (services.length) refs.services = services;
  if (tickets.length) refs.tickets = tickets;
  if (metrics.length) refs.metrics = metrics;
  if (logs.length) refs.logs = logs;

  return Object.keys(refs).length ? refs : undefined;
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
        const metric: MetricReference = { expression };
        if (typeof args.start === 'string' && args.start.trim()) metric.start = args.start.trim();
        if (typeof args.end === 'string' && args.end.trim()) metric.end = args.end.trim();
        const step = normalizeMetricStep(args.step);
        if (step !== undefined) metric.step = step;
        if (typeof args.service === 'string' && args.service.trim()) metric.scope = args.service.trim();
        if (typeof args.scope === 'string' && args.scope.trim()) metric.scope = metric.scope ?? args.scope.trim();
        metrics.push(metric);
      }
    }

    if (domain.name === 'log') {
      const query = typeof args.query === 'string' && args.query.trim() ? args.query.trim() : undefined;
      if (query) {
        const log: LogReference = { query };
        if (typeof args.start === 'string' && args.start.trim()) log.start = args.start.trim();
        if (typeof args.end === 'string' && args.end.trim()) log.end = args.end.trim();
        if (typeof args.service === 'string' && args.service.trim()) log.service = args.service.trim();
        if (typeof args.scope === 'string' && args.scope.trim()) log.scope = args.scope.trim();
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
