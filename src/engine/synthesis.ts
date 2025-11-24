import { CopilotAnswer, LlmClient, LlmMessage, ToolResult } from '../types.js';
import { buildFinalAnswerPrompt } from '../prompts.js';
import { formatAnswer } from './answerFormatter.js';
import { buildReferences } from './referenceBuilder.js';
import { ContextManager } from './contextManager.js';
import { CorrelationDetector } from './correlationDetector.js';
import { AnomalyDetector } from './anomalyDetector.js';
import { DomainRegistry, domainRegistry } from './domainRegistry.js';
// CRITICAL: Import domainConfigLoader to ensure domains are loaded before use
import './domainConfigLoader.js';

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

    console.log(`[Copilot][${chatId}] parsed.references:`, JSON.stringify(parsed.references, null, 2));

    // Deduplicate references
    const deduplicateReferences = (refs: any) => {
      if (!refs) return refs;

      const deduped: any = {};

      // Deduplicate simple arrays (incidents, services, tickets)
      if (refs.incidents) deduped.incidents = [...new Set(refs.incidents)];
      if (refs.services) deduped.services = [...new Set(refs.services)];
      if (refs.tickets) deduped.tickets = [...new Set(refs.tickets)];

      // Deduplicate metrics by expression+start+end
      if (refs.metrics?.length) {
        const seen = new Set<string>();
        deduped.metrics = refs.metrics.filter((m: any) => {
          const expr = typeof m.expression === 'string' ? m.expression : m.expression?.metricName || '';
          const key = `${expr}|${m.start}|${m.end}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      }

      // Deduplicate logs by normalized query+start+end
      if (refs.logs?.length) {
        const seen = new Set<string>();
        deduped.logs = refs.logs.filter((l: any) => {
          const query = l.expression?.search || l.query || '';
          // Normalize query by sorting words for semantic deduplication
          const normalized = query.toLowerCase().split(/\s+/).filter((w: string) => w && w !== 'or' && w !== 'and').sort().join(' ');
          const key = `${normalized}|${l.start}|${l.end}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      }

      return deduped;
    };

    // ALWAYS use buildReferences from actual tool results instead of trusting LLM
    // The LLM often makes up or simplifies references (e.g., just metric names instead of full objects)
    const extractedReferences = buildReferences(results, domainRegistry);

    // Merge LLM references with extracted references
    // We prioritize extracted references, but allow LLM to add missing ones (like services mentioned in text)
    const mergedReferences: any = { ...extractedReferences };

    if (parsed.references) {
      // Merge simple arrays
      if (parsed.references.incidents) {
        mergedReferences.incidents = [...(mergedReferences.incidents || []), ...parsed.references.incidents];
      }
      if (parsed.references.services) {
        mergedReferences.services = [...(mergedReferences.services || []), ...parsed.references.services];
      }
      if (parsed.references.tickets) {
        mergedReferences.tickets = [...(mergedReferences.tickets || []), ...parsed.references.tickets];
      }
      // We generally don't trust LLM for structured metrics/logs as they need complex objects
    }

    // Helper to normalize mixed references (strings vs objects) to just ID strings
    const normalizeToIds = (items: any[], idField: string = 'id'): string[] => {
      if (!items || !Array.isArray(items)) return [];
      return items.map(item => {
        if (typeof item === 'string') return item;
        if (typeof item === 'object' && item !== null) {
          // Try common ID fields
          return item[idField] || item.id || item.name || JSON.stringify(item);
        }
        return String(item);
      }).filter(Boolean);
    };

    // Normalize specific buckets that should be string arrays
    if (mergedReferences.incidents) {
      mergedReferences.incidents = normalizeToIds(mergedReferences.incidents, 'id');
    }
    if (mergedReferences.services) {
      mergedReferences.services = normalizeToIds(mergedReferences.services, 'name'); // Services often use name as ID
    }
    if (mergedReferences.tickets) {
      mergedReferences.tickets = normalizeToIds(mergedReferences.tickets, 'id');
    }

    const finalReferences = deduplicateReferences(mergedReferences);

    console.log(`[Copilot][${chatId}] Final references (merged & deduped):`, JSON.stringify(finalReferences, null, 2));

    return {
      conclusion: parsed.conclusion,
      evidence: parsed.evidence ?? fallback.evidence,
      missing: parsed.missing,
      references: finalReferences,
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
