import { ToolCall } from '../types.js';

/**
 * Simple heuristic-based fallback plan when LLM planning fails.
 * This is intentionally kept simple and doesn't use QueryBuilder
 * since it's only used as a last resort fallback.
 */
export function inferPlanFromQuestion(question: string): ToolCall[] {
  const q = question.toLowerCase();
  const calls: ToolCall[] = [];

  if (q.includes('incident') || q.includes('impactful')) {
    calls.push({ name: 'query-incidents', arguments: { limit: 2, severities: ['sev1', 'sev2'] } });
  }
  if (q.includes('severity') || q.includes('escalation')) {
    calls.push({ name: 'get-incident-timeline', arguments: { id: '{{incidentId}}' } });
  }
  if (q.includes('log')) {
    calls.push({ name: 'query-logs', arguments: { query: 'error OR 500', start: '{{start}}', end: '{{end}}' } });
  }
  if (q.includes('metric') || q.includes('latency') || q.includes('cpu') || q.includes('memory') || q.includes('traffic')) {
    calls.push({
      name: 'query-metrics',
      arguments: { expression: 'latency_p95, cpu_usage, memory_usage, rps', start: '{{start}}', end: '{{end}}', step: 60 },
    });
  }
  if (q.includes('ticket') || q.includes('jira') || q.includes('alert')) {
    calls.push({ name: 'query-tickets', arguments: { query: '{{incidentId}}' } });
  }
  if (q.includes('service')) {
    calls.push({ name: 'query-services', arguments: {} });
  }
  return calls;
}
