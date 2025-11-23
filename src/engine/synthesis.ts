import { CopilotAnswer, LlmClient, LlmMessage, ToolResult } from '../types.js';
import { buildFinalAnswerPrompt } from '../prompts.js';
import { formatAnswer } from './answerFormatter.js';
import { sanitizeReferences } from './referenceBuilder.js';
import { ContextManager } from './contextManager.js';
import { CorrelationDetector } from './correlationDetector.js';
import { AnomalyDetector } from './anomalyDetector.js';
import { DomainRegistry } from './domainRegistry.js';

const contextManager = new ContextManager();

/**
 * Extract JSON content from markdown code blocks.
 * Handles responses like: ```json\n{...}\n``` or just {...}
 */
function extractJsonFromMarkdown(content: string): string {
  const trimmed = content.trim();

  // Check if wrapped in code fences
  const codeBlockMatch = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/);
  if (codeBlockMatch) {
    return codeBlockMatch[1].trim();
  }

  // Return as-is if no code block
  return trimmed;
}

export async function synthesizeCopilotAnswer(
  question: string,
  results: ToolResult[],
  chatId: string,     // app-level chat id for logging/correlation
  llm: LlmClient,
  domainRegistry: DomainRegistry,
): Promise<CopilotAnswer> {
  const fallback = formatAnswer(question, results, chatId);
  if (!results.length) return fallback;

  // Detect correlations between events using domain-based categorization
  const correlationDetector = new CorrelationDetector(domainRegistry);
  const events = correlationDetector.extractEvents(results);
  const correlations = correlationDetector.detectCorrelations(events);
  const rootCause = correlationDetector.identifyRootCause(correlations);

  if (correlations.length > 0) {
    console.log(`[Copilot][${chatId}] Detected ${correlations.length} correlation(s)`);
    if (rootCause) {
      console.log(`[Copilot][${chatId}] Potential root cause: ${rootCause.type} at ${rootCause.timestamp}`);
    }
  }

  // Detect anomalies in metric data
  const anomalyDetector = new AnomalyDetector(domainRegistry);
  const metricSeries = anomalyDetector.extractMetricSeries(results);

  // Collect all anomalies and trends from all metric series
  const allAnomalies: any[] = [];
  const allTrends: any[] = [];

  for (const series of metricSeries) {
    const anomalies = anomalyDetector.detectAnomalies(series);
    const trends = anomalyDetector.detectTrends(series);
    allAnomalies.push(...anomalies);
    allTrends.push(...trends);
  }

  if (allAnomalies.length > 0) {
    console.log(`[Copilot][${chatId}] Detected ${allAnomalies.length} anomaly(ies)`);
    for (const anomaly of allAnomalies.slice(0, 3)) {
      console.log(`  - ${anomaly.metric}: ${anomaly.type} (${anomaly.severity}) at ${anomaly.timestamp}`);
    }
  }

  // Use context manager for intelligent result condensation
  const condensedResults = contextManager.condenseResults(results, 3000);

  // Add correlation context to synthesis if found
  let correlationContext = '';
  if (correlations.length > 0) {
    correlationContext = '\n\nDetected Correlations:\n';
    for (const corr of correlations.slice(0, 3)) { // Top 3 correlations
      correlationContext += `- ${corr.description} (strength: ${corr.strength.toFixed(2)})\n`;
    }
    if (rootCause) {
      correlationContext += `\nPotential root cause: ${rootCause.type} at ${rootCause.timestamp}\n`;
    }
  }

  // Add anomaly context to synthesis if found
  let anomalyContext = '';
  if (allAnomalies.length > 0) {
    anomalyContext = '\n\nDetected Anomalies:\n';
    for (const anomaly of allAnomalies.slice(0, 5)) {
      anomalyContext += `- ${anomaly.metric}: ${anomaly.type} `;
      anomalyContext += `(${anomaly.severity}, value: ${anomaly.value.toFixed(2)} at ${anomaly.timestamp})\n`;
    }
  }

  if (allTrends.length > 0) {
    anomalyContext += '\nTrends:\n';
    for (const trend of allTrends.slice(0, 3)) {
      const direction = trend.direction === 'increasing' ? '↗' : '↘';
      const change = (trend.slope * 100).toFixed(1);
      const changeNum = trend.slope * 100;
      anomalyContext += `- ${trend.metric}: ${direction} ${trend.direction} `;
      anomalyContext += `(${changeNum > 0 ? '+' : ''}${change}%)\n`;
    }
  }

  const messages: LlmMessage[] = [
    { role: 'system', content: buildFinalAnswerPrompt() },
    {
      role: 'user',
      content:
        `Question: ${question}\n` +
        `Tool results:\n${condensedResults}\n` +
        correlationContext +
        anomalyContext +
        `Return only the JSON object.`,
    },
  ];

  try {
    // IMPORTANT: do NOT pass chatId here.
    // This is a stateless, one-shot synthesis call, not a continuation
    // of the main tool-using conversation.
    const reply = await llm.chat(messages, []);
    console.log(`[Copilot][${chatId}] LLM synthesis reply: ${reply.content}`);

    let parsed: any;
    try {
      // Extract JSON from markdown code blocks if present
      const jsonContent = extractJsonFromMarkdown(reply.content || '{}');
      parsed = JSON.parse(jsonContent);
    } catch (err) {
      console.warn(
        `[Copilot][${chatId}] Failed to parse synthesis content as JSON; falling back.`,
        err,
      );
      return fallback;
    }

    if (!parsed || typeof parsed.conclusion !== 'string') {
      return fallback;
    }

    return {
      conclusion: parsed.conclusion,
      evidence: parsed.evidence ?? fallback.evidence,
      missing: parsed.missing,
      references: sanitizeReferences(parsed.references) ?? fallback.references,
      confidence:
        typeof parsed.confidence === 'number' ? parsed.confidence : fallback.confidence,
      data: results,
      correlations: correlations.length > 0 ? correlations : undefined,
      // Keep the app-level chat id for the answer; do NOT swap in reply.chatId
      chatId,
    } satisfies CopilotAnswer;
  } catch (err) {
    console.warn(`[Copilot][${chatId}] LLM synthesis failed, using fallback:`, err);
    return fallback;
  }
}
