/**
 * Alert Intent Handler
 */

import type { IntentHandler } from "../handlers.js";
import type { IntentResult } from "../../../types.js";

/**
 * Intent handler for alert-related queries
 *
 * Detects when users are asking about alerts, detectors, monitors,
 * or pages/notifications.
 */
export const alertIntentHandler: IntentHandler = async (
  context,
): Promise<IntentResult> => {
  const question = context.userQuestion.toLowerCase();

  // Keywords from alert domain config
  const keywords = ["alert", "alerts", "detector", "monitor", "page"];
  const actionPhrases = ["show alerts", "list alerts"];

  // Check for keyword matches
  const keywordMatches = keywords.filter((kw) => question.includes(kw));
  const actionMatches = actionPhrases.filter((phrase) =>
    question.includes(phrase),
  );

  const totalMatches = keywordMatches.length + actionMatches.length;

  if (totalMatches === 0) {
    return {
      intent: "unknown",
      confidence: 0.0,
      suggestedTools: [],
      reasoning: "No alert-related keywords found",
    };
  }

  // High confidence from domain config (1.0) - alerts are very specific
  const confidence = 1.0;

  // Check for specific alert contexts
  const isPagerDuty =
    question.includes("pagerduty") || question.includes("pager duty");
  const isMonitoring =
    question.includes("monitor") || question.includes("detector");

  let reasoning = `Alert query detected (keyword matches: ${keywordMatches.join(", ")}, action matches: ${actionMatches.join(", ")})`;

  if (isPagerDuty) {
    reasoning += " - PagerDuty context";
  }
  if (isMonitoring) {
    reasoning += " - monitoring/detector context";
  }

  return {
    intent: "observability",
    confidence,
    suggestedTools: ["query-alerts"],
    reasoning,
  };
};
