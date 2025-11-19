import { JsonObject, JsonValue, ToolCall, ToolResult } from '../types.js';

type IncidentContext = {
  id: string;
  service?: string;
  start?: string;
  end?: string;
};

type TimeRange = {
  start: string;
  end: string;
};

type HeuristicParams = {
  question: string;
  results: ToolResult[];
  proposed: ToolCall[];
  hasTool: (name: string) => boolean;
  maxToolCalls?: number;
};

export function applyFollowUpHeuristics({ question, results, proposed, hasTool, maxToolCalls }: HeuristicParams): ToolCall[] {
  if (!results.length) return proposed;
  const executedKeys = new Set(
    results.map((r) => callSignature({ name: r.name, arguments: (r.arguments ?? {}) as JsonObject }))
  );
  const scheduledKeys = new Set<string>();
  let deduped: ToolCall[] = [];
  const enqueue = (call: ToolCall) => {
    const key = callSignature(call);
    if (executedKeys.has(key) || scheduledKeys.has(key)) return;
    scheduledKeys.add(key);
    deduped.push(call);
  };
  proposed.forEach((call) => enqueue(call));

  const incidentContexts = extractIncidentContexts(results);
  const firstContextEntry = incidentContexts.values().next();
  const context = firstContextEntry.done ? undefined : firstContextEntry.value;

  if (context && hasTool('get-incident-timeline')) {
    const incidentId = context.id;
    const timelineAlreadyDone = results.some(
      (r) => r.name === 'get-incident-timeline' && ((r.arguments as any)?.id ?? '') === incidentId
    );
    const timelineScheduled = deduped.some(
      (c) => c.name === 'get-incident-timeline' && ((c.arguments as any)?.id ?? '') === incidentId
    );
    if (!timelineAlreadyDone && !timelineScheduled) {
      enqueue({ name: 'get-incident-timeline', arguments: { id: incidentId } });
    }
  }

  if (!shouldDrillIntoIncident(question)) {
    deduped = deduped.filter((call) => call.name.includes('incident'));
    return clamp(deduped, maxToolCalls);
  }

  if (!context) {
    return clamp(deduped, maxToolCalls);
  }

  const incidentId = context.id;
  const timelineRange = collectTimelineRange(results, incidentId);
  const combinedRange = {
    start: context.start ?? timelineRange?.start,
    end: context.end ?? timelineRange?.end,
  };
  const window = expandTimeRange(combinedRange);
  if (!window) {
    return clamp(deduped, maxToolCalls);
  }
  const scope: JsonObject | undefined = context.service ? { service: context.service } : undefined;

  if (hasTool('query-logs')) {
    const logArgs: JsonObject = {
      query: 'error OR exception OR failed OR 500',
      start: window.start,
      end: window.end,
    };
    if (scope) {
      logArgs.scope = scope;
    }
    enqueue({ name: 'query-logs', arguments: logArgs });
  }

  if (hasTool('query-metrics')) {
    const metricArgs: JsonObject = {
      expression: 'latency_p95, error_rate, cpu_usage, memory_usage',
      start: window.start,
      end: window.end,
      step: 60,
    };
    if (scope) {
      metricArgs.scope = scope;
    }
    enqueue({ name: 'query-metrics', arguments: metricArgs });
  }

  return clamp(deduped, maxToolCalls);
}

function clamp(calls: ToolCall[], maxToolCalls?: number): ToolCall[] {
  if (!maxToolCalls || maxToolCalls <= 0) return calls;
  return calls.slice(0, maxToolCalls);
}

function shouldDrillIntoIncident(question: string): boolean {
  const normalized = question.toLowerCase();
  return /root cause|\bwhy\b|trigger|escalat|diagnos|analysis|investigat|happened/.test(normalized);
}

function stableStringify(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, JsonValue>).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([key, val]) => `${JSON.stringify(key)}:${stableStringify(val)}`).join(',')}}`;
  }
  if (typeof value === 'string') return JSON.stringify(value);
  return String(value);
}

function callSignature(call: { name: string; arguments?: JsonObject }): string {
  return `${call.name}:${stableStringify(call.arguments ?? {})}`;
}

function extractIncidentContexts(results: ToolResult[]): Map<string, IncidentContext> {
  const contexts = new Map<string, IncidentContext>();
  const visit = (payload: any) => {
    if (!payload) return;
    if (Array.isArray(payload)) {
      payload.forEach((item) => visit(item));
      return;
    }
    if (typeof payload !== 'object') return;
    const id = extractIncidentId(payload);
    if (id) {
      const ctx = contexts.get(id) ?? { id };
      const service = pickString(payload, ['service', 'serviceId', 'serviceSlug', 'serviceName']);
      if (service && !ctx.service) ctx.service = service;
      const start = pickIsoString(payload, ['start', 'startTime', 'startedAt', 'detectedAt', 'createdAt', 'openedAt']);
      if (start && !ctx.start) ctx.start = start;
      const end = pickIsoString(payload, ['end', 'endTime', 'endedAt', 'resolvedAt', 'closedAt', 'updatedAt']);
      if (end && !ctx.end) ctx.end = end;
      contexts.set(id, ctx);
    }
    for (const value of Object.values(payload)) {
      visit(value);
    }
  };
  for (const result of results) {
    visit(result.result);
  }
  return contexts;
}

function extractIncidentId(payload: any): string | undefined {
  const candidate =
    typeof payload?.id === 'string'
      ? payload.id
      : typeof payload?.incidentId === 'string'
        ? payload.incidentId
        : typeof payload?.incident_id === 'string'
          ? payload.incident_id
          : undefined;
  return candidate && candidate.trim() ? candidate.trim() : undefined;
}

function pickString(payload: any, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = payload?.[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function pickIsoString(payload: any, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = payload?.[key];
    if (isIsoDateString(value)) {
      return value.trim();
    }
  }
  return undefined;
}

function isIsoDateString(value: unknown): value is string {
  return typeof value === 'string' && /\d{4}-\d{2}-\d{2}T/.test(value);
}

function collectTimelineRange(results: ToolResult[], incidentId: string): { start?: string; end?: string } | undefined {
  for (const r of results) {
    if (!r.name.includes('timeline')) continue;
    const argsId = typeof (r.arguments as any)?.id === 'string' ? (r.arguments as any).id : extractIncidentId(r.result);
    if (argsId && incidentId && argsId !== incidentId) continue;
    const timestamps = collectIsoTimestamps(r.result);
    if (timestamps.length) {
      return { start: timestamps[0], end: timestamps[timestamps.length - 1] };
    }
  }
  return undefined;
}

function collectIsoTimestamps(payload: any, limit = 200): string[] {
  const found = new Set<string>();
  const stack = [payload];
  while (stack.length && found.size < limit) {
    const item = stack.pop();
    if (!item) continue;
    if (typeof item === 'string') {
      if (isIsoDateString(item)) {
        found.add(item);
      }
      continue;
    }
    if (Array.isArray(item)) {
      item.forEach((child) => stack.push(child));
      continue;
    }
    if (typeof item === 'object') {
      Object.values(item).forEach((child) => {
        if (typeof child === 'string') {
          if (isIsoDateString(child)) {
            found.add(child);
          }
        } else if (child && (typeof child === 'object' || Array.isArray(child))) {
          stack.push(child);
        }
      });
    }
  }
  return Array.from(found).sort();
}

function expandTimeRange(range: { start?: string; end?: string }): TimeRange | undefined {
  const padMs = 15 * 60 * 1000;
  const hourMs = 60 * 60 * 1000;
  const startMs = range.start ? Date.parse(range.start) : undefined;
  const endMs = range.end ? Date.parse(range.end) : undefined;
  const startValid = typeof startMs === 'number' && !Number.isNaN(startMs);
  const endValid = typeof endMs === 'number' && !Number.isNaN(endMs);
  if (!startValid && !endValid) {
    return undefined;
  }
  const fallbackNow = Date.now();
  let start = startValid ? startMs! : endValid ? endMs! - hourMs : fallbackNow - hourMs;
  let end = endValid ? endMs! : start + hourMs;
  start -= padMs;
  end += padMs;
  if (start >= end) {
    end = start + padMs;
  }
  return { start: new Date(start).toISOString(), end: new Date(end).toISOString() };
}
