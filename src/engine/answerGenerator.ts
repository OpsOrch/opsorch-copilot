import { CopilotAnswer, CopilotReferences, ToolResult, LlmClient, Correlation, Anomaly } from "../types.js";
import { formatAnswer } from "./answerFormatter.js";
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
  const fallback = formatAnswer(question, results, chatId);
  if (!results.length) return { ...fallback, correlations: [], anomalies: [] };

  console.log(
    `[Copilot][${chatId}] Synthesizing answer from ${results.length} tool result(s)`,
  );

  // Run correlation and anomaly detection
  const { correlations, anomalies } = await runDetectors(results, chatId);

  try {
    // Create a comprehensive prompt for the LLM, including insights
    const prompt = createSynthesisPrompt(question, results, correlations, anomalies);

    // Get LLM analysis
    const response = await llm.chat([{ role: "user", content: prompt }], []);

    if (!response || !response.content) {
      console.warn(`[Copilot][${chatId}] LLM synthesis failed, using fallback`);
      return { ...fallback, correlations, anomalies };
    }

    // Parse the LLM response
    const synthesized = parseLLMResponse(response.content);

    // Adjust confidence based on detected correlations/anomalies
    const adjustedConfidence = adjustConfidence(
      synthesized.confidence || fallback.confidence || 0.7,
      correlations,
      anomalies,
    );

    // Merge references: prefer LLM-returned simple references (they're relevance-filtered)
    // but keep static extraction for complex references (metrics, logs) with deep-linking metadata
    const mergedReferences = mergeReferences(fallback.references, synthesized.references);

    return {
      conclusion: synthesized.conclusion || fallback.conclusion,
      confidence: adjustedConfidence,
      references: mergedReferences,
      chatId,
      evidence: fallback.evidence,
      correlations,
      anomalies,
    };
  } catch (error) {
    console.error(`[Copilot][${chatId}] Synthesis error:`, error);
    return { ...fallback, correlations, anomalies };
  }
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

  return `${buildFinalAnswerPrompt()}

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

    return result;
  }

  // Fallback: use the response as conclusion
  return {
    conclusion: response.trim(),
    confidence: 0.6,
  };
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

  // Filter LLM refs to only include values that exist in static refs
  // This prevents the LLM from inventing service names or IDs
  const filteredLlmIncidents = llmRefs.incidents?.filter(id => validIncidents.has(id)) || [];
  const filteredLlmServices = llmRefs.services?.filter(s => validServices.has(s)) || [];
  const filteredLlmTickets = llmRefs.tickets?.filter(t => validTickets.has(t)) || [];
  const filteredLlmAlerts = llmRefs.alerts?.filter(a => validAlerts.has(a)) || [];
  const filteredLlmDeployments = llmRefs.deployments?.filter(d => validDeployments.has(d)) || [];
  const filteredLlmTeams = llmRefs.teams?.filter(t => validTeams.has(t)) || [];

  // Use filtered LLM refs if they have values, otherwise fall back to static
  const merged: CopilotReferences = {
    incidents: filteredLlmIncidents.length ? filteredLlmIncidents : staticRefs.incidents,
    services: filteredLlmServices.length ? filteredLlmServices : staticRefs.services,
    tickets: filteredLlmTickets.length ? filteredLlmTickets : staticRefs.tickets,
    alerts: filteredLlmAlerts.length ? filteredLlmAlerts : staticRefs.alerts,
    deployments: filteredLlmDeployments.length ? filteredLlmDeployments : staticRefs.deployments,
    teams: filteredLlmTeams.length ? filteredLlmTeams : staticRefs.teams,
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

  return Object.keys(merged).length ? merged : undefined;
}
