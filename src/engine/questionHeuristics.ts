import { ToolCall, LlmMessage, Tool } from '../types.js';
import { McpClient } from '../mcpClient.js';
import { getKnownServices } from './serviceDiscovery.js';

type Logger = (message: string) => void;

const PATTERNS = {
  INCIDENT: /incident|outage|failure|broken|down|crash|error/i,
  SEVERITY: /sev-?[1-5]|severity|priority|critical|major|minor/i,
  SEVERITY_KEYWORD: /high|urgent|emergency/i,
  ERROR_CODE: /\b(5\d{2}|4\d{2})s?\b/,  // Match "500", "504s", etc.
  ERROR_5XX: /5\d{2}|5xx/i, // Match both "500" and "5xx"
  GENERIC_5XX: /server error|internal error/i,
  LOGS: /log|trace|stack/i,
  METRICS: {
    ANY: /metric|stat|latency|throughput|cpu|memory|usage|rate/i,
  },
  TIME_WINDOW: /(last|past|previous)\s+(\d+)\s+(minute|hour|day)s?/i,
};

const TOOLS = {
  INCIDENTS: 'query-incidents',
  LOGS: 'query-logs',
  METRICS: 'query-metrics',
};

export async function applyQuestionHeuristics(
  question: string,
  calls: ToolCall[],
  mcp: McpClient,
  history: LlmMessage[] = []
): Promise<ToolCall[]> {
  let augmented = [...calls];
  const normalized = question.toLowerCase();
  const inserted: ToolCall[] = [];

  const hasTool = (name: string) => mcp.hasTool(name);

  // Extract context from conversation history
  const historyContext = extractContextFromHistory(history);

  // Fetch known services for fuzzy matching
  // We need the tools list for getKnownServices, so we fetch it from mcp
  const tools = await mcp.listTools();
  const knownServices = await getKnownServices(mcp, tools);

  // Only apply heuristics if LLM didn't provide any meaningful plan
  // Empty plan (length = 0) should still allow heuristics to inject
  const hasValidLlmPlan = augmented.length > 0 && augmented.some(call => !hasPlaceholders(call.arguments));

  if (hasValidLlmPlan) {
    console.log(`[QuestionHeuristics] Deferring to LLM plan (${augmented.length} call(s))`);

    // Validate service names in the LLM plan
    // The LLM might guess "payment" when the service is "payments-svc"
    // We should correct this using our known services list
    let modified = false;
    const validatedCalls = augmented.map(call => {
      // Check for service in arguments
      const args = call.arguments as any;
      if (!args) return call;

      let serviceToValidate: string | undefined;
      let path: string[] = [];

      // Check common paths for service name
      if (typeof args.service === 'string') {
        serviceToValidate = args.service;
        path = ['service'];
      } else if (args.scope && typeof args.scope.service === 'string') {
        serviceToValidate = args.scope.service;
        path = ['scope', 'service'];
      }

      if (serviceToValidate) {
        // Check if it's a known service
        const isKnown = knownServices.some(s => s.toLowerCase() === serviceToValidate!.toLowerCase());

        if (!isKnown) {
          // Try to find a match using our extraction logic
          // We create a fake question context with just the service name to reuse extractService logic
          const corrected = extractService(`service ${serviceToValidate}`, knownServices);

          if (corrected && corrected.toLowerCase() !== serviceToValidate.toLowerCase()) {
            console.log(`[QuestionHeuristics] Correcting service name: "${serviceToValidate}" -> "${corrected}"`);

            // Clone args to avoid mutation issues
            const newArgs = JSON.parse(JSON.stringify(args));

            // Update the value at the correct path
            if (path.length === 1) {
              newArgs[path[0]] = corrected;
            } else if (path.length === 2) {
              newArgs[path[0]][path[1]] = corrected;
            }

            modified = true;
            return { ...call, arguments: newArgs };
          }
        }
      }

      return call;
    });

    return validatedCalls; // Trust the LLM's judgment (with corrections)
  }

  // LLM didn't provide a valid plan - heuristics can inject tools
  if (augmented.length === 0) {
    console.log(`[QuestionHeuristics] LLM returned empty plan, applying heuristics`);
  } else {
    console.log(`[QuestionHeuristics] LLM plan contains only placeholders, applying heuristics`);
  }

  // 1. Incident Heuristics
  const wantsIncident =
    PATTERNS.INCIDENT.test(normalized) ||
    PATTERNS.SEVERITY.test(normalized) ||
    PATTERNS.SEVERITY_KEYWORD.test(normalized);

  const hasIncidentCall = augmented.some((call) => call.name.includes('incident'));

  if (wantsIncident && !hasIncidentCall && hasTool(TOOLS.INCIDENTS)) {
    const args = getIncidentArgs(normalized);
    const confidence = wantsIncident ? 0.8 : 0.5;
    console.log(`[QuestionHeuristics] Injecting incident query (confidence: ${confidence})`);
    inserted.push({
      name: TOOLS.INCIDENTS,
      arguments: args
    });
  }

  // Common context for logs and metrics
  const window = parseTimeWindow(question);
  const service = extractService(question, knownServices) || historyContext.service; // Use history context as fallback
  const errorCodeMatch = question.match(PATTERNS.ERROR_CODE);
  const errorCode = errorCodeMatch ? errorCodeMatch[1] : undefined;
  const mentions5xx = PATTERNS.ERROR_5XX.test(normalized) || PATTERNS.GENERIC_5XX.test(normalized) || Boolean(errorCode);

  // 2. Log Heuristics - only add if not already in plan
  const wantsLogs = PATTERNS.LOGS.test(normalized) || mentions5xx;
  const hasLogCall = augmented.some((call) => call.name === TOOLS.LOGS && !hasPlaceholders(call.arguments));

  if (wantsLogs && !hasLogCall && hasTool(TOOLS.LOGS)) {
    const args = getLogArgs(question, errorCode, window, service);
    const confidence = mentions5xx ? 0.85 : 0.65;
    console.log(`[QuestionHeuristics] Injecting log query (confidence: ${confidence})`);
    inserted.push({
      name: TOOLS.LOGS,
      arguments: args
    });
  }

  // 3. Metric Heuristics - only add if not already in plan
  const wantsMetrics = PATTERNS.METRICS.ANY.test(normalized) || mentions5xx;
  const hasMetricCall = augmented.some((call) => call.name === TOOLS.METRICS && !hasPlaceholders(call.arguments));

  if (wantsMetrics && !hasMetricCall && hasTool(TOOLS.METRICS)) {
    const args = getMetricArgs(normalized, errorCode, window, service);
    const confidence = mentions5xx ? 0.8 : 0.6;
    console.log(`[QuestionHeuristics] Injecting metric query (confidence: ${confidence})`);
    inserted.push({
      name: TOOLS.METRICS,
      arguments: args
    });
  }

  // Only inject if we found high-confidence matches
  if (inserted.length > 0) {
    console.log(`[QuestionHeuristics] Supplementing empty/placeholder plan with ${inserted.length} heuristic call(s)`);
    return prioritizeAndMerge(inserted, augmented, normalized);
  }

  // LLM didn't provide a plan and heuristics didn't match - return empty to trigger fallback
  console.log(`[QuestionHeuristics] No heuristic matches, allowing fallback to trigger`);
  return augmented;
}

function extractContextFromHistory(history: LlmMessage[]): { service?: string } {
  // Look through recent messages to find service mentions
  // This provides context for follow-up questions like "show me logs" after discussing a specific service
  const recentMessages = history.slice(-10).reverse(); // Last 10 messages, most recent first

  for (const message of recentMessages) {
    const text = message.content || '';

    // Pattern 1: "service: <name>" or "service=<name>"
    const serviceColonMatch = text.match(/service[:\s=]+([a-z0-9-_]+)/i);
    if (serviceColonMatch && serviceColonMatch[1]) {
      return { service: serviceColonMatch[1] };
    }

    // Pattern 2: "in <service-name> service" or "for <service-name>"
    const servicePatternMatch = text.match(/(?:in|for)\s+([a-z0-9-_]+)(?:\s+service)?/i);
    if (servicePatternMatch && servicePatternMatch[1]) {
      const candidate = servicePatternMatch[1];
      // Filter out common prepositions/words that aren't services
      const stopWords = ['the', 'a', 'an', 'this', 'that', 'which', 'last', 'past'];
      if (!stopWords.includes(candidate.toLowerCase()) && candidate.includes('-')) {
        return { service: candidate };
      }
    }

    // Pattern 3: Look for kebab-case identifiers that might be service names
    // (common pattern: payment-service, user-api, checkout-service)
    const kebabMatch = text.match(/\b([a-z]+-[a-z0-9-]+)\b/i);
    if (kebabMatch && kebabMatch[1]) {
      const candidate = kebabMatch[1].toLowerCase();
      // Only consider if it looks like a service name (contains "service", "api", etc., or multiple dashes)
      if (candidate.includes('service') || candidate.includes('api') || candidate.split('-').length >= 2) {
        return { service: candidate };
      }
    }
  }

  return {};
}

function parseTimeWindow(question: string): { start?: string; end?: string } | undefined {
  const match = question.match(PATTERNS.TIME_WINDOW);
  if (match) {
    const value = parseInt(match[2], 10);
    const unit = match[3].toLowerCase();
    const now = Date.now();
    let durationMs = 0;
    if (unit.startsWith('minute')) durationMs = value * 60 * 1000;
    else if (unit.startsWith('hour')) durationMs = value * 60 * 60 * 1000;
    else if (unit.startsWith('day')) durationMs = value * 24 * 60 * 60 * 1000;

    if (durationMs > 0) {
      return {
        start: new Date(now - durationMs).toISOString(),
        end: new Date(now).toISOString(),
      };
    }
  }
  return undefined;
}

function extractService(question: string, knownServices: string[]): string | undefined {
  const normalized = question.toLowerCase();

  // 1. Exact match
  for (const service of knownServices) {
    if (normalized.includes(service.toLowerCase())) {
      return service;
    }
  }

  // 2. Check for known service parts (e.g. "payment" matching "payment-service")
  // We prioritize this over generic regex extraction to map "payments" -> "payment-service"
  const genericTerms = ['service', 'api', 'app', 'application', 'system', 'platform', 'backend', 'frontend'];

  for (const service of knownServices) {
    // Split service by - or _
    const parts = service.split(/[-_]/);

    if (parts.some(p =>
      p.length > 3 &&
      !genericTerms.includes(p.toLowerCase()) &&
      normalized.includes(p.toLowerCase())
    )) {
      return service;
    }
    // Check if question contains "payments" and service is "payment-service"
    // Simple stemming: remove 's' at end
    const words = normalized.split(/\W+/);
    if (words.some(w => {
      const stem = w.endsWith('s') ? w.slice(0, -1) : w;
      return stem.length > 3 &&
        !genericTerms.includes(stem) &&
        service.toLowerCase().includes(stem);
    })) {
      return service;
    }
  }

  // 3. Fuzzy match (regex extraction)
  // Match "service <name>", "for <name>", "in <name>"
  const serviceMatch = normalized.match(/(?:service|for|in)\s+([a-z0-9-_]+)/i);
  if (serviceMatch) {
    const captured = serviceMatch[1];
    // Check if captured is close to any known service
    const match = knownServices.find(s => s.toLowerCase().includes(captured) || captured.includes(s.toLowerCase()));
    if (match) return match;

    // Filter out common prepositions/stopwords if they were captured by mistake
    const stopWords = ['the', 'a', 'an', 'last', 'past', 'this'];
    if (!stopWords.includes(captured)) {
      return captured;
    }
  }

  return undefined;
}

function getIncidentArgs(question: string): any {
  const normalized = question.toLowerCase();
  const args: any = {};

  // Extract status filter
  if (normalized.includes('active') || normalized.includes('open')) {
    args.status = 'open';
  }

  // Extract limit for "latest" queries
  if (normalized.includes('latest') || normalized.includes('last incident') || normalized.includes('most recent')) {
    args.limit = 1;
  }

  // Extract severity filters (sev1, sev2, etc.)
  const sevMatches = normalized.match(/sev-?([1-5])/gi);
  if (sevMatches) {
    args.severities = sevMatches.map(s => s.toLowerCase().replace(/-/g, ''));
  }

  return args;
}

function getLogArgs(question: string, errorCode?: string, window?: { start?: string; end?: string }, service?: string): any {
  const args: any = {
    query: errorCode ? `error_code:${errorCode}` : 'error',
  };

  // Provide default 1-hour window if not specified
  if (window) {
    args.start = window.start;
    args.end = window.end;
  } else {
    const now = Date.now();
    const oneHourAgo = now - (60 * 60 * 1000);
    args.start = new Date(oneHourAgo).toISOString();
    args.end = new Date(now).toISOString();
  }

  if (service) {
    args.scope = { service };
  }
  return args;
}

function getMetricArgs(question: string, errorCode?: string, window?: { start?: string; end?: string }, service?: string): any {
  // Detect specific metric types from the question
  const normalized = question.toLowerCase();
  const metricTypes: string[] = [];

  if (normalized.includes('cpu')) {
    metricTypes.push('cpu_usage');
  }
  if (normalized.includes('memory')) {
    metricTypes.push('memory_usage');
  }
  if (normalized.includes('latency') || normalized.includes('p95') || normalized.includes('p99')) {
    metricTypes.push('latency_p95');
  }
  if (normalized.includes('error') || normalized.includes('5xx') || errorCode) {
    metricTypes.push('error_rate');
  }
  if (normalized.includes('throughput') || normalized.includes('rps') || normalized.includes('requests')) {
    metricTypes.push('requests_per_second');
  }

  // Default to latency and error rate if no specific metrics detected
  const expression = metricTypes.length > 0 ? metricTypes.join(', ') : 'latency_p95, error_rate';

  const args: any = { expression };

  // Provide default 1-hour window if not specified
  if (window) {
    args.start = window.start;
    args.end = window.end;
  } else {
    const now = Date.now();
    const oneHourAgo = now - (60 * 60 * 1000);
    args.start = new Date(oneHourAgo).toISOString();
    args.end = new Date(now).toISOString();
  }

  // Add default step (60 seconds) for metrics
  args.step = 60;

  if (service) {
    args.scope = { service };
  }
  return args;
}

function hasPlaceholders(args: any): boolean {
  if (!args) return false;
  const str = JSON.stringify(args);
  return str.includes('{{') && str.includes('}}');
}

function prioritizeAndMerge(inserted: ToolCall[], original: ToolCall[], question: string): ToolCall[] {
  // Deduplicate by name
  const merged = [...inserted];
  for (const call of original) {
    if (!merged.some(c => c.name === call.name)) {
      merged.push(call);
    }
  }
  return merged;
}
