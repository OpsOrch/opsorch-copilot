import { JsonObject, JsonValue, ToolCall, ToolResult } from '../types.js';
import { McpClient } from '../mcpClient.js';
import { ScopeInferenceEngine } from './scopeInferenceEngine.js';

type IncidentContext = {
  id: string;
  service?: string;
  start?: string;
  end?: string;
  title?: string;
  summary?: string;
};

type TimeRange = {
  start: string;
  end: string;
};

type HeuristicParams = {
  question: string;
  results: ToolResult[];
  proposed: ToolCall[];
  mcp: McpClient;
  maxToolCalls?: number;
};

const CONSTANTS = {
  PAD_MS: 15 * 60 * 1000,
  HOUR_MS: 60 * 60 * 1000,
  TIMELINE_LIMIT: 200,
  METRIC_STEP: 60,
  TOOLS: {
    TIMELINE: 'get-incident-timeline',
    LOGS: 'query-logs',
    METRICS: 'query-metrics',
  },
  PATTERNS: {
    DRILL_DOWN: /root cause|\bwhy\b|trigger|escalat|diagnos|analysis|investigat|happened|debug|trace|timeline|before|after|since|during/,
    COMPARISON: /compar|baseline|before|after|vs|versus|differ/,
    TEMPORAL: /since then|after that|following|preceding|around that time/,
    OBSERVABILITY: /\b(logs?|metrics?|telemetry|data|details?|numbers?|show\s+me|give\s+me)\b/i,
  },
};

export function applyFollowUpHeuristics({ question, results, proposed, mcp, maxToolCalls }: HeuristicParams): ToolCall[] {
  const hasTool = (name: string) => mcp.hasTool(name);

  if (!results.length) return proposed;

  // 1. Deduplicate proposed calls against executed and already scheduled calls
  const executedKeys = new Set(
    results.map((r) => callSignature({ name: r.name, arguments: (r.arguments ?? {}) as JsonObject }))
  );
  const scheduledKeys = new Set<string>();
  let deduped: ToolCall[] = [];

  const enqueue = (call: ToolCall, source?: string) => {
    const key = callSignature(call);
    if (executedKeys.has(key)) {
      return;
    }
    if (scheduledKeys.has(key)) {
      return;
    }
    scheduledKeys.add(key);
    deduped.push(call);
  };

  proposed.forEach((call) => enqueue(call, 'Kept LLM proposal'));

  // 2. Extract incident context from results
  const incidentContexts = extractIncidentContexts(results);
  const firstContextEntry = incidentContexts.values().next();
  const context = firstContextEntry.done ? undefined : firstContextEntry.value;

  // 3. Handle Timeline Follow-up
  if (context && hasTool(CONSTANTS.TOOLS.TIMELINE)) {
    handleTimelineFollowUp(context.id, results, deduped, enqueue);
  }

  // 4. Check if we should drill down further
  const drillDown = shouldDrillIntoIncident(question);
  if (!drillDown) {
    // Check if question directly requests observability data
    const directObservability = /^(show|get|what|give|tell).*(log|metric|latency|cpu|memory)/i.test(question);

    if (!directObservability) {
      // If not drilling down, only keep incident-related calls
      deduped = deduped.filter((call) => call.name.includes('incident'));
    }
    // else: Keep all calls including logs/metrics for direct observability requests

    return clamp(deduped, maxToolCalls);
  }

  if (!context) {
    return clamp(deduped, maxToolCalls);
  }

  // 5. Calculate time window for logs and metrics
  const window = calculateTimeWindow(results, context);
  if (!window) {
    return clamp(deduped, maxToolCalls);
  }

  const scope: JsonObject | undefined = context.service ? { service: context.service } : undefined;

  // 6. Handle Logs Follow-up
  if (hasTool(CONSTANTS.TOOLS.LOGS)) {
    handleLogsFollowUp(window, scope, context, enqueue);
  }

  // 7. Handle Metrics Follow-up
  if (hasTool(CONSTANTS.TOOLS.METRICS)) {
    handleMetricsFollowUp(window, scope, context, enqueue);
  }

  // 8. Apply scope inference to unscoped queries
  const scopeEngine = new ScopeInferenceEngine();
  const inference = scopeEngine.inferScope(question, results);

  if (inference) {
    console.log(`[ScopeInference] ${inference.reason} (confidence: ${inference.confidence})`);
    deduped = scopeEngine.applyScope(deduped, inference);
  }

  return clamp(deduped, maxToolCalls);
}

function handleTimelineFollowUp(
  incidentId: string,
  results: ToolResult[],
  deduped: ToolCall[],
  enqueue: (call: ToolCall, source?: string) => void
) {
  const timelineAlreadyDone = results.some(
    (r) => r.name === CONSTANTS.TOOLS.TIMELINE && ((r.arguments as any)?.id ?? '') === incidentId
  );
  const timelineScheduled = deduped.some(
    (c) => c.name === CONSTANTS.TOOLS.TIMELINE && ((c.arguments as any)?.id ?? '') === incidentId
  );

  if (!timelineAlreadyDone && !timelineScheduled) {
    enqueue({ name: CONSTANTS.TOOLS.TIMELINE, arguments: { id: incidentId } }, 'Injected timeline');
  }
}

function handleLogsFollowUp(
  window: TimeRange,
  scope: JsonObject | undefined,
  context: IncidentContext,
  enqueue: (call: ToolCall, source?: string) => void
) {
  let query = 'error OR exception OR failed OR 500';

  // Enhance query with context keywords
  const keywords = extractKeywords(context.title || context.summary || '');
  if (keywords.length) {
    query += ` OR (${keywords.join(' AND ')})`;
  }

  const logArgs: JsonObject = {
    query,
    start: window.start,
    end: window.end,
  };
  if (scope) {
    logArgs.scope = scope;
  }
  enqueue({ name: CONSTANTS.TOOLS.LOGS, arguments: logArgs }, 'Injected logs');
}

function handleMetricsFollowUp(
  window: TimeRange,
  scope: JsonObject | undefined,
  context: IncidentContext,
  enqueue: (call: ToolCall, source?: string) => void
) {
  const metrics = ['latency_p95', 'error_rate', 'cpu_usage', 'memory_usage'];
  const addedMetrics: string[] = [];

  // Add targeted metrics based on context
  const text = (context.title || '' + ' ' + context.summary || '').toLowerCase();
  if (text.includes('database') || text.includes('db') || text.includes('sql')) {
    metrics.push('db_connections', 'db_latency');
    addedMetrics.push('database');
  }
  if (text.includes('disk') || text.includes('volume') || text.includes('storage')) {
    metrics.push('disk_usage');
    addedMetrics.push('disk');
  }
  if (text.includes('network') || text.includes('timeout')) {
    metrics.push('network_in', 'network_out');
    addedMetrics.push('network');
  }

  const metricArgs: JsonObject = {
    expression: metrics.join(', '),
    start: window.start,
    end: window.end,
    step: CONSTANTS.METRIC_STEP,
  };
  if (scope) {
    metricArgs.scope = scope;
  }
  enqueue({ name: CONSTANTS.TOOLS.METRICS, arguments: metricArgs }, 'Injected metrics');
}

function extractKeywords(text: string): string[] {
  // Enhanced keyword extraction with better filtering
  const stopWords = new Set([
    'the', 'a', 'an', 'in', 'on', 'at', 'for', 'to', 'of', 'is', 'are', 'was', 'were',
    'and', 'or', 'incident', 'issue', 'problem', 'failure', 'error', 'service',
    'system', 'when', 'then', 'from', 'with', 'has', 'have', 'had', 'been'
  ]);

  const words = text
    .toLowerCase()
    .split(/\W+/)
    .filter(word => {
      // Filter out stop words, short words, and numbers
      if (word.length <= 2 || stopWords.has(word)) return false;
      if (/^\d+$/.test(word)) return false; // Skip pure numbers
      return true;
    });

  // Prioritize domain-specific terms
  const priorityWords = words.filter(w =>
    w.includes('timeout') || w.includes('latency') || w.includes('database') ||
    w.includes('api') || w.includes('payment') || w.includes('webhook')
  );

  const selectedWords = priorityWords.length > 0
    ? priorityWords.slice(0, 3)
    : words.slice(0, 3);

  return selectedWords;
}

function calculateTimeWindow(results: ToolResult[], context: IncidentContext): TimeRange | undefined {
  const timelineRange = collectTimelineRange(results, context.id);
  const combinedRange = {
    start: context.start ?? timelineRange?.start,
    end: context.end ?? timelineRange?.end,
  };
  return expandTimeRange(combinedRange);
}

function clamp(calls: ToolCall[], maxToolCalls?: number): ToolCall[] {
  if (!maxToolCalls || maxToolCalls <= 0) return calls;
  return calls.slice(0, maxToolCalls);
}

function shouldDrillIntoIncident(question: string): boolean {
  const normalized = question.toLowerCase();
  const drillDown = CONSTANTS.PATTERNS.DRILL_DOWN.test(normalized);
  const comparison = CONSTANTS.PATTERNS.COMPARISON.test(normalized);
  const temporal = CONSTANTS.PATTERNS.TEMPORAL.test(normalized);
  const observability = CONSTANTS.PATTERNS.OBSERVABILITY.test(normalized);

  const result = drillDown || comparison || temporal || observability;

  if (result) {
    const reasons: string[] = [];
    if (drillDown) reasons.push('drill-down');
    if (comparison) reasons.push('comparison');
    if (temporal) reasons.push('temporal');
    if (observability) reasons.push('observability');
    console.log(`[FollowUpHeuristics] Drill-down enabled: ${reasons.join(', ')} (question: "${question}")`);
  } else {
    console.log(`[FollowUpHeuristics] Drill-down disabled, filtering to incident-only calls (question: "${question}")`);
  }

  return result;
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

      const title = pickString(payload, ['title', 'summary', 'description', 'name']);
      if (title && !ctx.title) ctx.title = title;

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

function collectIsoTimestamps(payload: any, limit = CONSTANTS.TIMELINE_LIMIT): string[] {
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
  const startMs = range.start ? Date.parse(range.start) : undefined;
  const endMs = range.end ? Date.parse(range.end) : undefined;
  const startValid = typeof startMs === 'number' && !Number.isNaN(startMs);
  const endValid = typeof endMs === 'number' && !Number.isNaN(endMs);

  if (!startValid && !endValid) {
    return undefined;
  }

  const fallbackNow = Date.now();
  let start = startValid ? startMs! : endValid ? endMs! - CONSTANTS.HOUR_MS : fallbackNow - CONSTANTS.HOUR_MS;
  let end = endValid ? endMs! : start + CONSTANTS.HOUR_MS;

  start -= CONSTANTS.PAD_MS;
  end += CONSTANTS.PAD_MS;

  if (start >= end) {
    end = start + CONSTANTS.PAD_MS;
  }

  return { start: new Date(start).toISOString(), end: new Date(end).toISOString() };
}
