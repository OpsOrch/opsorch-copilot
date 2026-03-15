import { CopilotAnswer, CopilotAction, CopilotReferences, ToolResult, LlmClient, Correlation, Anomaly, MetricReference, LogReference, MetricExpression, LogExpression, QueryScope } from "../types.js";
import { buildFinalAnswerPrompt } from "../prompts.js";
import { HandlerUtils } from "./handlers/utils.js";
import { CorrelationDetector } from "./correlationDetector.js";
import { AnomalyDetector } from "./anomalyDetector.js";

// Initialize detectors
const correlationDetector = new CorrelationDetector();
const anomalyDetector = new AnomalyDetector();

/**
 * Synthesize a comprehensive answer from tool results using LLM analysis.
 * Includes correlation and anomaly detection for enhanced root cause analysis.
 */
export async function synthesizeCopilotAnswer(
  question: string,
  results: ToolResult[],
  chatId: string,
  llm: LlmClient,
): Promise<CopilotAnswer> {
  const fallback = createFallbackAnswer(question, results, chatId);
  if (!results.length) return fallback;

  console.log(
    `[Copilot][${chatId}] Synthesizing answer from ${results.length} tool result(s)`,
  );

  // Run correlation and anomaly detection (used internally for confidence adjustment)
  const { correlations, anomalies } = await runDetectors(results, chatId);

  try {
    // Create a comprehensive prompt for the LLM, including insights
    const prompt = createSynthesisPrompt(question, results, correlations, anomalies);

    // Get LLM analysis
    const response = await llm.chat([{ role: "user", content: prompt }], []);

    if (!response || !response.content) {
      console.warn(`[Copilot][${chatId}] LLM synthesis failed, using fallback`);
      return fallback;
    }

    // Parse the LLM response
    const synthesized = parseLLMResponse(response.content);

    // Adjust confidence based on detected correlations/anomalies
    const adjustedConfidence = adjustConfidence(
      synthesized.confidence || fallback.confidence || 0.7,
      correlations,
      anomalies,
    );

    const planLabels = collectOrchestrationPlanLabels(results);
    const staticActions = collectOrchestrationActions(results);

    // Merge references: prefer LLM-returned simple references (they're relevance-filtered)
    // but keep static extraction for complex references (metrics, logs) with deep-linking metadata
    const mergedReferences = mergeReferences(fallback.references, synthesized.references);
    const mergedActions = mergeActions(staticActions, synthesized.actions);

    return {
      conclusion: ensureOrchestrationRecommendation(
        synthesized.conclusion || fallback.conclusion,
        planLabels,
      ),
      confidence: adjustedConfidence,
      references: mergedReferences,
      actions: mergedActions,
      chatId,
    };
  } catch (error) {
    console.error(`[Copilot][${chatId}] Synthesis error:`, error);
    return fallback;
  }
}

/**
 * Create a fallback answer when LLM synthesis fails or no results
 */
function createFallbackAnswer(
  question: string,
  results: ToolResult[],
  chatId: string,
): CopilotAnswer {
  if (results.length === 0) {
    return {
      conclusion: "I couldn't find any relevant data to answer your question.",
      confidence: 0.3,
      chatId,
    };
  }

  // Extract references from results
  const references = extractReferencesFromResults(results);
  const planLabels = collectOrchestrationPlanLabels(results);
  const actions = collectOrchestrationActions(results);

  return {
    conclusion: ensureOrchestrationRecommendation(
      `Based on ${results.length} tool result(s), here's what I found regarding: "${question}"`,
      planLabels,
    ),
    confidence: 0.5,
    references: Object.keys(references).length > 0 ? references : undefined,
    actions: actions.length > 0 ? actions : undefined,
    chatId,
  };
}

/**
 * Extract references from tool results for fallback answers.
 * Tool results can be:
 * - Arrays directly (query-incidents returns z.array(incidentSchema))
 * - Single objects (get-incident returns incidentSchema)
 * - Objects with nested arrays (some tools return { incidents: [...] })
 */
function extractReferencesFromResults(results: ToolResult[]): CopilotReferences {
  const refs: CopilotReferences = {};

  for (const result of results) {
    if (result.result === null || result.result === undefined) continue;

    // Extract incident IDs (and service names from incidents)
    if (result.name.includes('incident')) {
      refs.incidents = refs.incidents || [];
      refs.services = refs.services || [];
      extractIncidentIds(result.result, refs.incidents, refs.services);
    }

    // Extract service names
    if (result.name.includes('service')) {
      refs.services = refs.services || [];
      extractServiceNames(result.result, refs.services);
    }

    // Extract alert IDs
    if (result.name.includes('alert')) {
      refs.alerts = refs.alerts || [];
      extractAlertIds(result.result, refs.alerts);
    }

    // Extract deployment IDs
    if (result.name.includes('deployment')) {
      refs.deployments = refs.deployments || [];
      extractDeploymentIds(result.result, refs.deployments);
    }

    // Extract ticket IDs
    if (result.name.includes('ticket')) {
      refs.tickets = refs.tickets || [];
      extractTicketIds(result.result, refs.tickets);
    }

    // Extract metric references from query-metrics tool
    if (result.name.includes('metric')) {
      refs.metrics = refs.metrics || [];
      extractMetricReferences(result, refs.metrics);
    }

    // Extract log references from query-logs tool
    if (result.name.includes('log')) {
      refs.logs = refs.logs || [];
      extractLogReferences(result, refs.logs);
    }

    // Extract team IDs
    if (result.name.includes('team')) {
      refs.teams = refs.teams || [];
      extractTeamIds(result.result, refs.teams);
    }

    // Extract orchestration plan IDs
    if (result.name.includes('orchestration')) {
      refs.orchestrationPlans = refs.orchestrationPlans || [];
      extractOrchestrationPlanIds(result.result, refs.orchestrationPlans);
    }
  }

  // Deduplicate all arrays
  if (refs.incidents) refs.incidents = [...new Set(refs.incidents)];
  if (refs.services) refs.services = [...new Set(refs.services)];
  if (refs.alerts) refs.alerts = [...new Set(refs.alerts)];
  if (refs.deployments) refs.deployments = [...new Set(refs.deployments)];
  if (refs.tickets) refs.tickets = [...new Set(refs.tickets)];
  if (refs.teams) refs.teams = [...new Set(refs.teams)];
  // Metrics and logs are complex objects, dedupe by JSON string
  if (refs.metrics) refs.metrics = dedupeByJson(refs.metrics);
  if (refs.logs) refs.logs = dedupeByJson(refs.logs);
  if (refs.orchestrationPlans) refs.orchestrationPlans = [...new Set(refs.orchestrationPlans)];

  return refs;
}

function dedupeByJson<T>(arr: T[]): T[] {
  const seen = new Set<string>();
  return arr.filter(item => {
    const key = JSON.stringify(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function extractIncidentIds(data: unknown, ids: string[], serviceNames?: string[]): void {
  if (Array.isArray(data)) {
    // query-incidents returns array directly
    for (const item of data) {
      if (typeof item === 'object' && item !== null) {
        const obj = item as Record<string, unknown>;
        if ('id' in obj) {
          ids.push(String(obj.id));
        }
        // Also extract service from incident
        if (serviceNames && 'service' in obj && obj.service) {
          serviceNames.push(String(obj.service));
        }
      }
    }
  } else if (typeof data === 'object' && data !== null) {
    const obj = data as Record<string, unknown>;
    // get-incident returns single object
    if ('id' in obj) {
      ids.push(String(obj.id));
    }
    // Also extract service from incident
    if (serviceNames && 'service' in obj && obj.service) {
      serviceNames.push(String(obj.service));
    }
    // Some tools return { incidents: [...] }
    if (Array.isArray(obj.incidents)) {
      for (const inc of obj.incidents) {
        if (typeof inc === 'object' && inc !== null) {
          const incObj = inc as Record<string, unknown>;
          if ('id' in incObj) {
            ids.push(String(incObj.id));
          }
          if (serviceNames && 'service' in incObj && incObj.service) {
            serviceNames.push(String(incObj.service));
          }
        }
      }
    }
  }
}

function extractServiceNames(data: unknown, names: string[]): void {
  if (Array.isArray(data)) {
    for (const item of data) {
      if (typeof item === 'object' && item !== null) {
        const obj = item as Record<string, unknown>;
        if ('name' in obj) names.push(String(obj.name));
        else if ('id' in obj) names.push(String(obj.id));
      }
    }
  } else if (typeof data === 'object' && data !== null) {
    const obj = data as Record<string, unknown>;
    if ('name' in obj) names.push(String(obj.name));
    else if ('id' in obj) names.push(String(obj.id));
    if (Array.isArray(obj.services)) {
      for (const svc of obj.services) {
        if (typeof svc === 'object' && svc !== null) {
          const s = svc as Record<string, unknown>;
          if ('name' in s) names.push(String(s.name));
          else if ('id' in s) names.push(String(s.id));
        }
      }
    }
  }
}

function extractAlertIds(data: unknown, ids: string[]): void {
  if (Array.isArray(data)) {
    for (const item of data) {
      if (typeof item === 'object' && item !== null && 'id' in item) {
        ids.push(String((item as { id: unknown }).id));
      }
    }
  } else if (typeof data === 'object' && data !== null) {
    const obj = data as Record<string, unknown>;
    if ('id' in obj) ids.push(String(obj.id));
    if (Array.isArray(obj.alerts)) {
      for (const alert of obj.alerts) {
        if (typeof alert === 'object' && alert !== null && 'id' in alert) {
          ids.push(String((alert as { id: unknown }).id));
        }
      }
    }
  }
}

function extractDeploymentIds(data: unknown, ids: string[]): void {
  if (Array.isArray(data)) {
    for (const item of data) {
      if (typeof item === 'object' && item !== null && 'id' in item) {
        ids.push(String((item as { id: unknown }).id));
      }
    }
  } else if (typeof data === 'object' && data !== null) {
    const obj = data as Record<string, unknown>;
    if ('id' in obj) ids.push(String(obj.id));
    if (Array.isArray(obj.deployments)) {
      for (const dep of obj.deployments) {
        if (typeof dep === 'object' && dep !== null && 'id' in dep) {
          ids.push(String((dep as { id: unknown }).id));
        }
      }
    }
  }
}

function extractTicketIds(data: unknown, ids: string[]): void {
  if (Array.isArray(data)) {
    for (const item of data) {
      if (typeof item === 'object' && item !== null) {
        const obj = item as Record<string, unknown>;
        if ('id' in obj) ids.push(String(obj.id));
        else if ('key' in obj) ids.push(String(obj.key));
      }
    }
  } else if (typeof data === 'object' && data !== null) {
    const obj = data as Record<string, unknown>;
    if ('id' in obj) ids.push(String(obj.id));
    else if ('key' in obj) ids.push(String(obj.key));
    if (Array.isArray(obj.tickets)) {
      for (const ticket of obj.tickets) {
        if (typeof ticket === 'object' && ticket !== null) {
          const t = ticket as Record<string, unknown>;
          if ('id' in t) ids.push(String(t.id));
          else if ('key' in t) ids.push(String(t.key));
        }
      }
    }
  }
}

function extractTeamIds(data: unknown, ids: string[]): void {
  if (Array.isArray(data)) {
    for (const item of data) {
      if (typeof item === 'object' && item !== null) {
        const obj = item as Record<string, unknown>;
        if ('id' in obj) ids.push(String(obj.id));
        else if ('name' in obj) ids.push(String(obj.name));
      }
    }
  } else if (typeof data === 'object' && data !== null) {
    const obj = data as Record<string, unknown>;
    if ('id' in obj) ids.push(String(obj.id));
    else if ('name' in obj) ids.push(String(obj.name));
    if (Array.isArray(obj.teams)) {
      for (const team of obj.teams) {
        if (typeof team === 'object' && team !== null) {
          const t = team as Record<string, unknown>;
          if ('id' in t) ids.push(String(t.id));
          else if ('name' in t) ids.push(String(t.name));
        }
      }
    }
  }
}

/**
 * Extract metric references from query-metrics tool results.
 * Uses the tool arguments to build a MetricReference with deep-linking metadata.
 */
function extractMetricReferences(result: ToolResult, refs: MetricReference[]): void {
  // Get the arguments used to call the tool - these contain the query parameters
  const args = result.arguments as Record<string, unknown> | undefined;
  if (!args) return;

  // Build MetricReference from tool arguments
  const expression = args.expression as Record<string, unknown> | undefined;
  if (!expression) return;

  const metricRef: MetricReference = {
    expression: {
      metricName: String(expression.metricName || ''),
      aggregation: expression.aggregation ? String(expression.aggregation) : undefined,
      filters: Array.isArray(expression.filters) ? expression.filters as MetricExpression['filters'] : undefined,
      groupBy: Array.isArray(expression.groupBy) ? expression.groupBy as string[] : undefined,
    },
    start: args.start ? String(args.start) : undefined,
    end: args.end ? String(args.end) : undefined,
    step: typeof args.step === 'number' ? args.step : undefined,
    scope: args.scope as QueryScope | undefined,
  };

  // Only add if we have a metric name
  if (metricRef.expression.metricName) {
    refs.push(metricRef);
  }
}

/**
 * Extract log references from query-logs tool results.
 * Uses the tool arguments to build a LogReference with deep-linking metadata.
 */
function extractLogReferences(result: ToolResult, refs: LogReference[]): void {
  // Get the arguments used to call the tool - these contain the query parameters
  const args = result.arguments as Record<string, unknown> | undefined;
  if (!args) return;

  // Build LogReference from tool arguments
  const expression = args.expression as Record<string, unknown> | undefined;

  const logRef: LogReference = {
    expression: {
      search: expression?.search ? String(expression.search) : undefined,
      filters: Array.isArray(expression?.filters) ? expression.filters as LogExpression['filters'] : undefined,
      severityIn: Array.isArray(expression?.severityIn) ? expression.severityIn as string[] : undefined,
    },
    start: args.start ? String(args.start) : undefined,
    end: args.end ? String(args.end) : undefined,
    scope: args.scope as QueryScope | undefined,
  };

  // Only add if we have some search criteria
  if (logRef.expression.search || logRef.expression.filters?.length || logRef.expression.severityIn?.length) {
    refs.push(logRef);
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const collectPlanRecords = (data: unknown): Record<string, unknown>[] => {
  if (Array.isArray(data)) {
    return data.filter(isRecord);
  }

  if (isRecord(data)) {
    if (Array.isArray(data.plans)) {
      return data.plans.filter(isRecord);
    }
    if (Array.isArray(data.items)) {
      return data.items.filter(isRecord);
    }
    return [data];
  }

  return [];
};

const getStringField = (record: Record<string, unknown>, fields: string[]): string | null => {
  for (const field of fields) {
    const value = record[field];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
    if (typeof value === "number") {
      return String(value);
    }
  }
  return null;
};

/**
 * Extract orchestration plan IDs from orchestration tool results.
 */
function extractOrchestrationPlanIds(data: unknown, ids: string[]): void {
  const records = collectPlanRecords(data);
  for (const record of records) {
    const id = getStringField(record, ["id"]);
    if (id) ids.push(id);
  }
}

function collectOrchestrationActions(results: ToolResult[]): CopilotAction[] {
  const actions: CopilotAction[] = [];

  for (const result of results) {
    if (!result.name.includes("orchestration")) continue;

    const records = collectPlanRecords(result.result);
    for (const record of records) {
      const id = getStringField(record, ["id"]);
      const name = getStringField(record, ["title", "name", "displayName"]);
      if (!id && !name) continue;

      actions.push({
        type: "orchestration_plan",
        id: id ?? undefined,
        name: name ?? undefined,
      });
    }
  }

  const seen = new Set<string>();
  return actions.filter((action) => {
    const key = `${action.type}:${action.id ?? ""}:${action.name ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function collectOrchestrationPlanLabels(results: ToolResult[]): string[] {
  const labels: string[] = [];

  for (const result of results) {
    if (!result.name.includes("orchestration")) continue;

    const records = collectPlanRecords(result.result);
    for (const record of records) {
      const label = getStringField(record, ["title", "name", "displayName", "id"]);
      if (label) labels.push(label);
    }
  }

  return labels;
}

function ensureOrchestrationRecommendation(conclusion: string, planLabels: string[]): string {
  if (!planLabels.length) return conclusion;

  const lower = conclusion.toLowerCase();
  const mentionsRunbook = /runbook|playbook|orchestration plan/.test(lower);
  const mentionsPlan = planLabels.some((plan) => lower.includes(plan.toLowerCase()));

  if (mentionsRunbook || mentionsPlan) return conclusion;

  const uniquePlans = [...new Set(planLabels)].slice(0, 3);
  const plural = uniquePlans.length > 1 ? "runbooks" : "runbook";
  const recommendation = `Recommended Action: Run the ${uniquePlans.join(", ")} ${plural} to mitigate this issue.`;
  const prefix = conclusion.includes("\n-") ? "\n- " : " ";

  return `${conclusion}${prefix}${recommendation}`;
}

/**
 * Run correlation and anomaly detectors on tool results
 */
async function runDetectors(
  results: ToolResult[],
  chatId: string,
): Promise<{ correlations: Correlation[]; anomalies: Anomaly[] }> {
  const correlations: Correlation[] = [];
  const anomalies: Anomaly[] = [];

  try {
    // Extract events and detect correlations
    const events = correlationDetector.extractEvents(results);
    if (events.length > 0) {
      const detected = correlationDetector.detectCorrelations(events);
      correlations.push(...detected);
      if (detected.length > 0) {
        console.log(
          `[Copilot][${chatId}] Detected ${detected.length} correlation(s)`,
        );
      }
    }

    // Extract metric series and detect anomalies
    const metricSeries = anomalyDetector.extractMetricSeries(results);
    for (const series of metricSeries) {
      const detected = await anomalyDetector.detectAnomalies(series);
      anomalies.push(...detected);
    }
    if (anomalies.length > 0) {
      console.log(
        `[Copilot][${chatId}] Detected ${anomalies.length} anomaly/anomalies`,
      );
    }
  } catch (error) {
    console.error(`[Copilot][${chatId}] Detector error:`, error);
    // Continue with empty results rather than failing synthesis
  }

  return { correlations, anomalies };
}

/**
 * Create a synthesis prompt for the LLM with correlation/anomaly insights
 */
function createSynthesisPrompt(
  question: string,
  results: ToolResult[],
  correlations: Correlation[],
  anomalies: Anomaly[],
): string {
  const toolSummary = results
    .map((r) => `${r.name}: ${JSON.stringify(r.result)}`)
    .join("\n");

  let insightsSection = "";

  // Add correlation insights
  if (correlations.length > 0) {
    const correlationSummary = correlations
      .slice(0, 5) // Limit to top 5
      .map((c) => `- ${c.description} (strength: ${(c.strength * 100).toFixed(0)}%)`)
      .join("\n");
    insightsSection += `\n\nDetected Correlations:\n${correlationSummary}`;
  }

  // Add anomaly insights
  if (anomalies.length > 0) {
    const anomalySummary = anomalies
      .slice(0, 5) // Limit to top 5
      .map((a) => `- ${a.type.toUpperCase()} in ${a.metric} at ${a.timestamp}: value=${a.value.toFixed(2)}, severity=${a.severity}`)
      .join("\n");
    insightsSection += `\n\nDetected Anomalies:\n${anomalySummary}`;
  }

  const foundPlans = collectOrchestrationPlanLabels(results);

  let orchestrationInstruction = "";
  if (foundPlans.length > 0) {
    const uniquePlans = [...new Set(foundPlans)];
    orchestrationInstruction = `\n\nRelevant Orchestration Plans Found: ${JSON.stringify(uniquePlans)}.\n` +
      "INSTRUCTION: You MUST typically recommend these plans. Add a dedicated bullet point or final sentence to your conclusion explicitly suggesting the user run these plans.\n" +
      "Example: 'Recommended Action: Run the [Plan Name] runbook to mitigate this issue.'";
  } else if (results.some(r => r.name.includes('orchestration'))) {
    // Fallback if results were empty or malformed but tool was called
    orchestrationInstruction = "\n\nNOTE: No orchestration plans matched the query.";
  }

  return `${buildFinalAnswerPrompt()}
${orchestrationInstruction}

Question: ${question}

Tool Results:
${toolSummary}${insightsSection}`;
}

/**
 * Adjust confidence based on detected correlations and anomalies
 */
function adjustConfidence(
  baseConfidence: number,
  correlations: Correlation[],
  anomalies: Anomaly[],
): number {
  let adjustment = 0;

  // Strong correlations increase confidence (we found supporting evidence)
  const strongCorrelations = correlations.filter((c) => c.strength >= 0.7);
  if (strongCorrelations.length > 0) {
    adjustment += Math.min(0.1, strongCorrelations.length * 0.03);
  }

  // High-severity anomalies increase confidence (clear signal found)
  const highSeverityAnomalies = anomalies.filter((a) => a.severity === "high");
  if (highSeverityAnomalies.length > 0) {
    adjustment += Math.min(0.1, highSeverityAnomalies.length * 0.03);
  }

  return Math.min(1.0, baseConfidence + adjustment);
}

/**
 * Parse LLM response into structured format
 */
function parseLLMResponse(response: string): Partial<CopilotAnswer> {
  const parsed = HandlerUtils.extractAndParseJson(response);
  if (parsed && typeof parsed === 'object') {
    const p = parsed as Record<string, unknown>;
    const result: Partial<CopilotAnswer> = {
      conclusion: typeof p.conclusion === 'string' ? p.conclusion : undefined,
      confidence: typeof p.confidence === 'number' ? p.confidence : 0.7,
    };

    // Parse references if the LLM returned them
    if (p.references && typeof p.references === 'object') {
      result.references = parseReferencesFromLlm(p.references as Record<string, unknown>);
    }
    if (Array.isArray(p.actions)) {
      result.actions = parseActionsFromLlm(p.actions);
    }

    return result;
  }

  // Fallback: use the response as conclusion
  return {
    conclusion: response.trim(),
    confidence: 0.6,
  };
}

function parseActionsFromLlm(actions: unknown[]): CopilotAction[] {
  const parsed: CopilotAction[] = [];

  for (const action of actions) {
    if (typeof action !== "object" || action === null || Array.isArray(action)) continue;
    const obj = action as Record<string, unknown>;
    if (obj.type !== "orchestration_plan") continue;

    const id = typeof obj.id === "string" ? obj.id : undefined;
    const name = typeof obj.name === "string" ? obj.name : undefined;
    const reason = typeof obj.reason === "string" ? obj.reason : undefined;
    if (!id && !name) continue;

    parsed.push({
      type: "orchestration_plan",
      id,
      name,
      reason,
    });
  }

  return parsed;
}

/**
 * Parse references returned by the LLM into CopilotReferences format.
 * The LLM returns simple string arrays for incidents, services, alerts, tickets, deployments, teams.
 */
function parseReferencesFromLlm(refs: Record<string, unknown>): CopilotReferences {
  const result: CopilotReferences = {};

  if (Array.isArray(refs.incidents)) {
    result.incidents = refs.incidents.filter((id): id is string => typeof id === 'string');
  }
  if (Array.isArray(refs.services)) {
    result.services = refs.services.filter((s): s is string => typeof s === 'string');
  }
  if (Array.isArray(refs.tickets)) {
    result.tickets = refs.tickets.filter((t): t is string => typeof t === 'string');
  }
  if (Array.isArray(refs.alerts)) {
    result.alerts = refs.alerts.filter((a): a is string => typeof a === 'string');
  }
  if (Array.isArray(refs.deployments)) {
    result.deployments = refs.deployments.filter((d): d is string => typeof d === 'string');
  }
  if (Array.isArray(refs.teams)) {
    result.teams = refs.teams.filter((t): t is string => typeof t === 'string');
  }
  if (Array.isArray(refs.orchestration_plans)) {
    result.orchestrationPlans = refs.orchestration_plans.filter((p): p is string => typeof p === 'string');
  } else if (Array.isArray(refs.orchestrationPlans)) {
    result.orchestrationPlans = refs.orchestrationPlans.filter((p): p is string => typeof p === 'string');
  }

  return result;
}

/**
 * Merge static references with LLM-provided references.
 * LLM references are filtered to only include values that exist in static refs.
 * This prevents the LLM from inventing service names or IDs.
 * Static extraction is kept for complex references (metrics, logs) with deep-linking metadata.
 */
function mergeReferences(
  staticRefs: CopilotReferences | undefined,
  llmRefs: CopilotReferences | undefined,
): CopilotReferences | undefined {
  if (!staticRefs && !llmRefs) return undefined;
  if (!staticRefs) return undefined; // No static refs = no valid references
  if (!llmRefs) return staticRefs;

  // Create sets of valid values from static refs for fast lookup
  const validIncidents = new Set(staticRefs.incidents || []);
  const validServices = new Set(staticRefs.services || []);
  const validTickets = new Set(staticRefs.tickets || []);
  const validAlerts = new Set(staticRefs.alerts || []);
  const validDeployments = new Set(staticRefs.deployments || []);
  const validTeams = new Set(staticRefs.teams || []);
  const validPlans = new Set(staticRefs.orchestrationPlans || []);

  // Filter LLM refs to only include values that exist in static refs
  // This prevents the LLM from inventing service names or IDs
  const filteredLlmIncidents = llmRefs.incidents?.filter(id => validIncidents.has(id)) || [];
  const filteredLlmServices = llmRefs.services?.filter(s => validServices.has(s)) || [];
  const filteredLlmTickets = llmRefs.tickets?.filter(t => validTickets.has(t)) || [];
  const filteredLlmAlerts = llmRefs.alerts?.filter(a => validAlerts.has(a)) || [];
  const filteredLlmDeployments = llmRefs.deployments?.filter(d => validDeployments.has(d)) || [];
  const filteredLlmTeams = llmRefs.teams?.filter(t => validTeams.has(t)) || [];
  const filteredLlmPlans = llmRefs.orchestrationPlans?.filter(p => validPlans.has(p)) || [];

  // Use filtered LLM refs if they have values, otherwise fall back to static
  const merged: CopilotReferences = {
    incidents: filteredLlmIncidents.length ? filteredLlmIncidents : staticRefs.incidents,
    services: filteredLlmServices.length ? filteredLlmServices : staticRefs.services,
    tickets: filteredLlmTickets.length ? filteredLlmTickets : staticRefs.tickets,
    alerts: filteredLlmAlerts.length ? filteredLlmAlerts : staticRefs.alerts,
    deployments: filteredLlmDeployments.length ? filteredLlmDeployments : staticRefs.deployments,
    teams: filteredLlmTeams.length ? filteredLlmTeams : staticRefs.teams,
    orchestrationPlans: filteredLlmPlans.length ? filteredLlmPlans : staticRefs.orchestrationPlans,
    // Always use static refs for complex types (they have rich query metadata for deep-linking)
    metrics: staticRefs.metrics,
    logs: staticRefs.logs,
  };

  // Remove empty arrays to keep the object clean
  if (merged.incidents && merged.incidents.length === 0) delete merged.incidents;
  if (merged.services && merged.services.length === 0) delete merged.services;
  if (merged.tickets && merged.tickets.length === 0) delete merged.tickets;
  if (merged.alerts && merged.alerts.length === 0) delete merged.alerts;
  if (merged.deployments && merged.deployments.length === 0) delete merged.deployments;
  if (merged.teams && merged.teams.length === 0) delete merged.teams;
  if (merged.metrics && merged.metrics.length === 0) delete merged.metrics;
  if (merged.logs && merged.logs.length === 0) delete merged.logs;
  if (merged.orchestrationPlans && merged.orchestrationPlans.length === 0) delete merged.orchestrationPlans;

  return Object.keys(merged).length ? merged : undefined;
}

function mergeActions(
  staticActions: CopilotAction[],
  llmActions: CopilotAction[] | undefined,
): CopilotAction[] | undefined {
  if (!staticActions.length && !llmActions?.length) return undefined;
  if (!llmActions || llmActions.length === 0) return staticActions.length ? staticActions : undefined;

  const validIds = new Set(staticActions.map((action) => action.id).filter((id): id is string => !!id));
  const validNames = new Set(staticActions.map((action) => action.name).filter((name): name is string => !!name));

  const filtered = llmActions.filter((action) => {
    if (action.id && validIds.has(action.id)) return true;
    if (action.name && validNames.has(action.name)) return true;
    return false;
  });

  if (filtered.length === 0) return staticActions.length ? staticActions : undefined;

  const combined = [...filtered];
  const seen = new Set<string>();
  return combined.filter((action) => {
    const key = `${action.type}:${action.id ?? ""}:${action.name ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
