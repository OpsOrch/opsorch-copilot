import type { IntentHandler } from "../handlers.js";
import type { IntentResult, UserIntent } from "../../../types.js";

export const logIntentHandler: IntentHandler = async (
  context,
): Promise<IntentResult> => {
  const question = context.userQuestion.toLowerCase();
  const keywords = ["log", "logs", "error logs", "trace", "stack"];
  const actionPhrases = ["show logs", "get logs", "check logs"];
  const patterns = [/log|trace|stack/i, /\b([45]\d{2})s?\b/i];

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
      reasoning: "No log-related keywords found",
    };
  }

  const confidence = 0.9;
  const hasErrorCode = /\b([45]\d{2}|[45]xx)s?\b/i.test(question);
  const hasErrorKeyword =
    question.includes("error") ||
    question.includes("exception") ||
    question.includes("timeout") ||
    question.includes("failure");

  // Contextual patterns for navigation
  const isContinuation =
    question.startsWith("also") ||
    question.startsWith("and") ||
    question.includes(" as well");

  let reasoning = `Log query detected (keyword matches: ${keywordMatches.join(", ")}, action matches: ${actionMatches.join(", ")}, patterns: ${patternMatches.length})`;

  if (hasErrorCode) {
    reasoning += " - includes error code";
  }
  if (hasErrorKeyword) {
    reasoning += " - includes error keyword";
  }

  let intent: UserIntent = "observability";
  if (isContinuation) {
    intent = "navigation";
    reasoning += " - continuation detected";
  }

  return {
    intent,
    confidence,
    suggestedTools: ["query-logs"],
    reasoning,
  };
};
