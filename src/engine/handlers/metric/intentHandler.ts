import type { IntentHandler } from "../handlers.js";
import type { IntentResult, UserIntent } from "../../../types.js";

export const metricIntentHandler: IntentHandler = async (
  context,
): Promise<IntentResult> => {
  const question = context.userQuestion.toLowerCase();
  const keywords = [
    "metric",
    "metrics",
    "latency",
    "cpu",
    "memory",
    "p95",
    "p99",
  ];
  const actionPhrases = ["show metrics", "check latency"];
  const patterns = [/metric|latency|cpu|memory/i, /\b(5\d{2})s?\b/i];

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
      reasoning: "No metric-related keywords found",
    };
  }

  const confidence = 0.9;


  // Contextual patterns for navigation
  const isContinuation =
    question.startsWith("also") ||
    question.startsWith("and") ||
    question.includes(" as well");

  const suggestedTools: string[] = ["query-metrics"];

  if (
    question.includes("available") ||
    question.includes("list") ||
    question.includes("what")
  ) {
    suggestedTools.unshift("describe-metrics");
  }

  let intent: UserIntent = "observability";
  if (isContinuation) {
    intent = "navigation";
  }

  return {
    intent,
    confidence,
    suggestedTools,
    reasoning: `Metric query detected (keyword matches: ${keywordMatches.join(", ")}, action matches: ${actionMatches.join(", ")}, patterns: ${patternMatches.length})`,
  };
};
