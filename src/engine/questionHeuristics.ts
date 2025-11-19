import { ToolCall } from '../types.js';

function hasPlaceholders(args?: Record<string, any>): boolean {
  return Object.values(args ?? {}).some((value) => typeof value === 'string' && value.includes('{{'));
}

export function applyQuestionHeuristics(
  question: string,
  calls: ToolCall[],
  hasTool: (name: string) => boolean
): ToolCall[] {
  let augmented = [...calls];
  const normalized = question.toLowerCase();
  const inserted: ToolCall[] = [];

  const wantsIncident =
    /incident/.test(normalized) || /\bsev\s*\d/.test(normalized) || normalized.includes('severity');
  const hasIncidentCall = augmented.some((call) => call.name.includes('incident'));
  let incidentInserted = false;
  if (wantsIncident && !hasIncidentCall && hasTool('query-incidents')) {
    const incidentArgs: Record<string, any> = {};
    incidentArgs.limit = /latest|last|recent/.test(normalized) ? 1 : 2;
    const severityMatch = normalized.match(/\bsev\s*(\d)/);
    if (severityMatch) {
      incidentArgs.severities = [`sev${severityMatch[1]}`];
    }
    inserted.push({ name: 'query-incidents', arguments: incidentArgs });
    incidentInserted = true;
  }

  const windowEnd = new Date();
  const windowStart = new Date(windowEnd.getTime() - 30 * 60 * 1000);
  const startIso = windowStart.toISOString();
  const endIso = windowEnd.toISOString();

  const errorCodeMatch = question.match(/(\b\d{3})(?:s|\b)/i);
  const errorCode = errorCodeMatch ? errorCodeMatch[1] : undefined;
  const mentions5xx = /\b5\d{2}/.test(normalized) || /5xx/.test(normalized) || Boolean(errorCode);

  const wantsLogs = /log/.test(normalized) || /error/.test(normalized) || mentions5xx;
  const hasLogCall = augmented.some((call) => call.name === 'query-logs' && !hasPlaceholders(call.arguments));
  if (wantsLogs && !hasLogCall && hasTool('query-logs')) {
    const logQuery = errorCode ? `status:${errorCode} OR "${errorCode}"` : question;
    const logArgs: Record<string, any> = {
      query: logQuery,
      start: startIso,
      end: endIso,
    };
    inserted.push({ name: 'query-logs', arguments: logArgs });
  }

  const wantsMetrics =
    /metric/.test(normalized) ||
    /latency/.test(normalized) ||
    /cpu/.test(normalized) ||
    /memory/.test(normalized) ||
    /traffic/.test(normalized) ||
    /throughput/.test(normalized) ||
    /rps/.test(normalized) ||
    /error/.test(normalized) ||
    mentions5xx;
  const hasMetricCall = augmented.some((call) => call.name === 'query-metrics' && !hasPlaceholders(call.arguments));
  if (wantsMetrics && !hasMetricCall && hasTool('query-metrics')) {
    const expressions: string[] = [];
    if (/latency/.test(normalized)) expressions.push('latency_p95');
    if (/cpu/.test(normalized)) expressions.push('cpu_usage');
    if (/memory/.test(normalized)) expressions.push('memory_usage');
    if (/traffic|throughput|rps/.test(normalized)) expressions.push('rps');
    if (/error/.test(normalized) || errorCode) expressions.push('error_rate');
    if (!expressions.length) {
      expressions.push('latency_p95', 'error_rate');
    }
    const metricArgs: Record<string, any> = {
      expression: expressions.join(', '),
      start: startIso,
      end: endIso,
      step: 60,
    };
    inserted.push({ name: 'query-metrics', arguments: metricArgs });
  }

  if (incidentInserted) {
    augmented = augmented.filter((call) => call.name.includes('incident'));
  }

  return inserted.length ? [...inserted, ...augmented] : augmented;
}
