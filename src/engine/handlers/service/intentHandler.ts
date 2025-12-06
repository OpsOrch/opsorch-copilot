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

  // Check if we have service context from conversation history
  let hasServiceContext = false;
  if (!hasSpecificService && !isListQuery && context.conversationHistory.length > 0) {
    // Look back at recent turns (last 3)
    const recentTurns = context.conversationHistory.slice(-3);
    for (const turn of recentTurns) {
      if (turn.entities && turn.entities.some(e => e.type === "service")) {
        hasServiceContext = true;
        break;
      }
    }
  }

  const suggestedTools: string[] = [];
  if (hasSpecificService) {
    // Specific service mentioned - get-service returns detailed info
    suggestedTools.push("get-service");
  } else if (isListQuery) {
    // Explicit list request
    suggestedTools.push("query-services");
  } else if (!hasServiceContext) {
    // Only fallback to query-services if we don't have existing context
    suggestedTools.push("query-services");
  }

  let reasoning = `Service query detected (keyword matches: ${keywordMatches.join(", ")}, action matches: ${actionMatches.join(", ")})`;
  if (isHealthCheck) reasoning += " - health check context";
  if (hasSpecificService) reasoning += " - specific service mentioned";
  if (hasServiceContext) reasoning += " - service context found in history";

  return {
    intent: "status_check",
    confidence,
    suggestedTools,
    reasoning,
  };
};
