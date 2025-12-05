import type { IntentHandler } from "../handlers.js";
import type { IntentResult } from "../../../types.js";

export const serviceIntentHandler: IntentHandler = async (
  context,
): Promise<IntentResult> => {
  const question = context.userQuestion.toLowerCase();
  const keywords = ["service", "services", "microservice", "health", "status"];
  const actionPhrases = [
    "list services",
    "show services",
    "check health",
    "service status",
  ];

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
      reasoning: "No service-related keywords found",
    };
  }

  const confidence = 0.8;
  const isHealthCheck =
    question.includes("health") ||
    question.includes("healthy") ||
    question.includes("status");
  const isListQuery =
    question.includes("list") ||
    question.includes("show") ||
    question.includes("all");
  const hasSpecificService = /service[:\s]+\w+/i.test(question);

  const suggestedTools: string[] = [];
  if (isListQuery || !hasSpecificService) {
    suggestedTools.push("query-services");
  }
  if (hasSpecificService) {
    suggestedTools.push("get-service");
  }
  if (suggestedTools.length === 0) {
    suggestedTools.push("query-services");
  }

  let reasoning = `Service query detected (keyword matches: ${keywordMatches.join(", ")}, action matches: ${actionMatches.join(", ")})`;
  if (isHealthCheck) reasoning += " - health check context";
  if (hasSpecificService) reasoning += " - specific service mentioned";

  return {
    intent: "status_check",
    confidence,
    suggestedTools,
    reasoning,
  };
};
