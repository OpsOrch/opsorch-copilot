import { ToolCall, LlmMessage } from '../types.js';

// Constants for regex patterns and magic strings
const PATTERNS = {
  INCIDENT: /incident/,
  SEVERITY: /\bsev\s*\d/,
  SEVERITY_CAPTURE: /\bsev\s*(\d)/,
  SEVERITY_KEYWORD: /severity/,
  LATEST: /latest|last|recent/,
  ERROR_CODE: /(\b\d{3})(?:s|\b)/i,
  ERROR_5XX: /\b5\d{2}/,
  GENERIC_5XX: /5xx/,
  LOGS: /log|error/,
  METRICS: {
    ANY: /metric|latency|cpu|memory|traffic|throughput|rps|error/,
    LATENCY: /latency/,
    CPU: /cpu/,
    MEMORY: /memory/,
    TRAFFIC: /traffic|throughput|rps/,
    ERROR: /error/,
  },
  TIME_WINDOW: /(?:last|past)\s+(\d+)\s+(minute|hour|day|min|hr)s?/i,
  SERVICE_NAME: /(?:for|in|service)\s+([a-zA-Z0-9-_]+)\s+service/i,
};

const TOOLS = {
  INCIDENTS: 'query-incidents',
  LOGS: 'query-logs',
  METRICS: 'query-metrics',
};

const DEFAULTS = {
  METRIC_STEP: 60,
  WINDOW_MINUTES: 30,
};

function hasPlaceholders(args?: Record<string, any>): boolean {
  return Object.values(args ?? {}).some((value) => typeof value === 'string' && value.includes('{{'));
}

function parseTimeWindow(question: string): { start: string; end: string } {
  const match = question.match(PATTERNS.TIME_WINDOW);
  let minutes = DEFAULTS.WINDOW_MINUTES;

  if (match) {
    const value = parseInt(match[1], 10);
    const unit = match[2].toLowerCase();

    if (unit.startsWith('minute') || unit === 'min') {
      minutes = value;
    } else if (unit.startsWith('hour') || unit === 'hr') {
      minutes = value * 60;
    } else if (unit.startsWith('day')) {
      minutes = value * 24 * 60;
    }
  }

  const end = new Date();
  const start = new Date(end.getTime() - minutes * 60 * 1000);

  return {
    start: start.toISOString(),
    end: end.toISOString(),
  };
}

function extractService(question: string): string | undefined {
  const match = question.match(PATTERNS.SERVICE_NAME);
  return match ? match[1] : undefined;
}

function getIncidentArgs(normalizedQuestion: string): Record<string, any> {
  const args: Record<string, any> = {};
  args.limit = PATTERNS.LATEST.test(normalizedQuestion) ? 1 : 2;

  const severityMatch = normalizedQuestion.match(PATTERNS.SEVERITY_CAPTURE);
  if (severityMatch) {
    args.severities = [`sev${severityMatch[1]}`];
  }
  return args;
}

function getLogArgs(
  question: string,
  errorCode: string | undefined,
  window: { start: string; end: string },
  service?: string
): Record<string, any> {
  const logQuery = errorCode ? `status:${errorCode} OR "${errorCode}"` : question;
  const args: Record<string, any> = {
    query: logQuery,
    start: window.start,
    end: window.end,
  };

  if (service) {
    args.scope = { service };
  }

  return args;
}

function getMetricArgs(
  normalizedQuestion: string,
  errorCode: string | undefined,
  window: { start: string; end: string },
  service?: string
): Record<string, any> {
  const expressions: string[] = [];
  if (PATTERNS.METRICS.LATENCY.test(normalizedQuestion)) expressions.push('latency_p95');
  if (PATTERNS.METRICS.CPU.test(normalizedQuestion)) expressions.push('cpu_usage');
  if (PATTERNS.METRICS.MEMORY.test(normalizedQuestion)) expressions.push('memory_usage');
  if (PATTERNS.METRICS.TRAFFIC.test(normalizedQuestion)) expressions.push('rps');
  if (PATTERNS.METRICS.ERROR.test(normalizedQuestion) || errorCode) expressions.push('error_rate');

  if (!expressions.length) {
    expressions.push('latency_p95', 'error_rate');
  }

  const args: Record<string, any> = {
    expression: expressions.join(', '),
    start: window.start,
    end: window.end,
    step: DEFAULTS.METRIC_STEP,
  };

  if (service) {
    args.scope = { service };
  }

  return args;
}

type HeuristicContext = {
  service?: string;
  timeWindow?: { start: string; end: string };
  incidentId?: string;
};

type Logger = (message: string) => void;

function extractContextFromHistory(history: LlmMessage[]): HeuristicContext {
  const context: HeuristicContext = {};

  // Look through recent messages for context clues
  for (const msg of history.slice(-5)) {
    const content = msg.content?.toLowerCase() || '';

    // Extract service mentions
    const serviceMatch = content.match(/(?:for|in|on|about)\s+([a-z0-9-]+(?:-service|-api|-backend)?)/i);
    if (serviceMatch && !context.service) {
      context.service = serviceMatch[1];
    }

    // Extract incident ID mentions
    const incidentMatch = content.match(/(?:inc|incident)[-_]?([a-z0-9]+)/i);
    if (incidentMatch && !context.incidentId) {
      context.incidentId = `inc-${incidentMatch[1]}`;
    }
  }

  return context;
}

function isRelevantTool(toolName: string, question: string): boolean {
  // Generic health/status tools are not relevant when asking specific questions
  const genericTools = ['health', 'status', 'ping'];
  if (genericTools.some(g => toolName.toLowerCase().includes(g))) {
    const isSpecificQuestion = PATTERNS.INCIDENT.test(question) ||
      PATTERNS.SEVERITY.test(question) ||
      PATTERNS.LOGS.test(question);
    return !isSpecificQuestion;
  }
  return true;
}

function prioritizeAndMerge(
  inserted: ToolCall[],
  existing: ToolCall[],
  question: string,
  logger: Logger
): ToolCall[] {
  // Filter out truly irrelevant calls, but keep compatible ones
  const filtered = existing.filter(call => {
    const relevant = isRelevantTool(call.name, question);
    if (!relevant) {
      logger(`[Heuristic] Filtered out irrelevant call: ${call.name}`);
    }
    return relevant;
  });

  // Incidents first, then other calls
  const incidentCalls = inserted.filter(c => c.name.includes('incident'));
  const otherInserted = inserted.filter(c => !c.name.includes('incident'));

  return [...incidentCalls, ...otherInserted, ...filtered];
}

export function applyQuestionHeuristics(
  question: string,
  calls: ToolCall[],
  hasTool: (name: string) => boolean,
  history: LlmMessage[] = [],
  logger: Logger = () => { }
): ToolCall[] {
  let augmented = [...calls];
  const normalized = question.toLowerCase();
  const inserted: ToolCall[] = [];

  // Extract context from conversation history
  const context = extractContextFromHistory(history);
  if (context.service) {
    logger(`[Heuristic] Extracted service from history: ${context.service}`);
  }

  // 1. Incident Heuristics
  const wantsIncident =
    PATTERNS.INCIDENT.test(normalized) ||
    PATTERNS.SEVERITY.test(normalized) ||
    PATTERNS.SEVERITY_KEYWORD.test(normalized);

  const hasIncidentCall = augmented.some((call) => call.name.includes('incident'));

  if (wantsIncident && !hasIncidentCall && hasTool(TOOLS.INCIDENTS)) {
    const args = getIncidentArgs(normalized);
    inserted.push({
      name: TOOLS.INCIDENTS,
      arguments: args
    });
    logger(`[Heuristic] Injected ${TOOLS.INCIDENTS} with args: ${JSON.stringify(args)}`);
  }

  // Common context for logs and metrics
  const window = parseTimeWindow(question);
  const service = extractService(question) || context.service; // Use history context as fallback
  const errorCodeMatch = question.match(PATTERNS.ERROR_CODE);
  const errorCode = errorCodeMatch ? errorCodeMatch[1] : undefined;
  const mentions5xx = PATTERNS.ERROR_5XX.test(normalized) || PATTERNS.GENERIC_5XX.test(normalized) || Boolean(errorCode);

  // 2. Log Heuristics
  const wantsLogs = PATTERNS.LOGS.test(normalized) || mentions5xx;
  const hasLogCall = augmented.some((call) => call.name === TOOLS.LOGS && !hasPlaceholders(call.arguments));

  if (wantsLogs && !hasLogCall && hasTool(TOOLS.LOGS)) {
    const args = getLogArgs(question, errorCode, window, service);
    inserted.push({
      name: TOOLS.LOGS,
      arguments: args
    });
    logger(`[Heuristic] Injected ${TOOLS.LOGS}${service ? ` for service: ${service}` : ''}`);
  }

  // 3. Metric Heuristics
  const wantsMetrics = PATTERNS.METRICS.ANY.test(normalized) || mentions5xx;
  const hasMetricCall = augmented.some((call) => call.name === TOOLS.METRICS && !hasPlaceholders(call.arguments));

  if (wantsMetrics && !hasMetricCall && hasTool(TOOLS.METRICS)) {
    const args = getMetricArgs(normalized, errorCode, window, service);
    inserted.push({
      name: TOOLS.METRICS,
      arguments: args
    });
    logger(`[Heuristic] Injected ${TOOLS.METRICS}${service ? ` for service: ${service}` : ''}`);
  }

  // Smart prioritization instead of aggressive filtering
  if (inserted.length > 0) {
    return prioritizeAndMerge(inserted, augmented, normalized, logger);
  }

  return augmented;
}
