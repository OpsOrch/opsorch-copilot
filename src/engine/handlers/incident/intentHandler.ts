/**
 * Incident Intent Handler
 *
 * Detects when users are asking about incidents, outages, failures,
 * or root cause analysis.
 */

import type { IntentHandler } from "../handlers.js";
import type { IntentResult } from "../../../types.js";

/**
 * Intent handler for incident-related queries
 *
 * Detects when users are asking about incidents, outages, failures,
 * or root cause analysis.
 */
export const incidentIntentHandler: IntentHandler = async (
  context,
): Promise<IntentResult> => {
  const question = context.userQuestion.toLowerCase();

  // Keywords from incident domain config
  const keywords = [
    "incident",
    "outage",
    "failure",
    "broken",
    "down",
    "root cause",
    "why",
  ];
  const actionPhrases = ["show incidents", "list incidents"];
  const patterns = [/incident|outage|failure/i, /sev-?[1-5]/i];

  // Check for keyword matches
  const keywordMatches = keywords.filter((kw) => question.includes(kw));
  const actionMatches = actionPhrases.filter((phrase) =>
    question.includes(phrase),
  );
  const patternMatches = patterns.filter((pattern) => pattern.test(question));

  const totalMatches =
    keywordMatches.length + actionMatches.length + patternMatches.length;

  if (totalMatches === 0) {
    return {
      intent: "unknown",
      confidence: 0.0,
      suggestedTools: [],
      reasoning: "No incident-related keywords found",
    };
  }

  // Base confidence from domain config
  let confidence = 0.9;

  // Reduce confidence if only weak matches
  if (totalMatches === 1 && keywordMatches.includes("why")) {
    confidence = 0.5; // 'why' alone is ambiguous
  }

  // Check conversation history for incident context
  const hasRecentIncidents = context.toolResults.some(
    (result) =>
      result.name === "query-incidents" || result.name === "get-incident",
  );
  const hasIncidentEntity = context.conversationHistory.slice(-3).some(
    (turn) => turn.entities?.some((e) => e.type === "incident"),
  );
  const hasContext = hasRecentIncidents || hasIncidentEntity;

  if (hasRecentIncidents && question.includes("timeline")) {
    // User asking for timeline after incident query
    return {
      intent: "investigation",
      confidence: 0.95,
      suggestedTools: ["get-incident-timeline"],
      reasoning: `Timeline request after incident query (matches: ${keywordMatches.join(", ")})`,
    };
  }

  const suggestedTools: string[] = [];
  // Only suggest query-incidents if no context OR explicit request
  if (!hasContext || actionMatches.length > 0) {
    suggestedTools.push("query-incidents");
  }
  suggestedTools.push("get-incident-timeline");

  let reasoningBase = `Incident investigation intent detected (keyword matches: ${keywordMatches.join(", ")}, action matches: ${actionMatches.join(", ")}, patterns: ${patternMatches.length})`;
  if (hasContext) {
    reasoningBase += " - incident context found";
  }

  return {
    intent: "investigation",
    confidence,
    suggestedTools,
    reasoning: reasoningBase,
  };
};
