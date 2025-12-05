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

  if (hasRecentIncidents && question.includes("timeline")) {
    // User asking for timeline after incident query
    return {
      intent: "investigation",
      confidence: 0.95,
      suggestedTools: ["get-incident-timeline"],
      reasoning: `Timeline request after incident query (matches: ${keywordMatches.join(", ")})`,
    };
  }

  return {
    intent: "investigation",
    confidence,
    suggestedTools: [
      "query-incidents",
      "get-incident",
      "get-incident-timeline",
    ],
    reasoning: `Incident investigation intent detected (keyword matches: ${keywordMatches.join(", ")}, action matches: ${actionMatches.join(", ")}, patterns: ${patternMatches.length})`,
  };
};
