import type { IntentHandler } from "../handlers.js";
import type { IntentResult } from "../../../types.js";

export const ticketIntentHandler: IntentHandler = async (
  context,
): Promise<IntentResult> => {
  const question = context.userQuestion.toLowerCase();
  const keywords = ["ticket", "alert", "notification"];
  const actionPhrases = ["show tickets", "list tickets"];

  const keywordMatches = keywords.filter((kw) => question.includes(kw));
  const actionMatches = actionPhrases.filter((phrase) =>
    question.includes(phrase),
  );

  const hasAlertKeyword = keywordMatches.includes("alert");
  const hasTicketContext =
    question.includes("jira") ||
    question.includes("ticket") ||
    question.includes("issue");

  if (hasAlertKeyword && !hasTicketContext && keywordMatches.length === 1) {
    return {
      intent: "unknown",
      confidence: 0.0,
      suggestedTools: [],
      reasoning:
        "Alert keyword without ticket context - likely alert capability",
    };
  }

  const totalMatches = keywordMatches.length + actionMatches.length;
  if (totalMatches === 0) {
    return {
      intent: "unknown",
      confidence: 0.0,
      suggestedTools: [],
      reasoning: "No ticket-related keywords found",
    };
  }

  const confidence = 0.8;
  const isJira = question.includes("jira");
  const suggestedTools: string[] = ["query-tickets"];

  if (
    question.includes("details") ||
    question.includes("status") ||
    /ticket-?\d+/i.test(question)
  ) {
    suggestedTools.push("get-ticket");
  }

  let reasoning = `Ticket query detected (keyword matches: ${keywordMatches.join(", ")}, action matches: ${actionMatches.join(", ")})`;
  if (isJira) reasoning += " - JIRA context";

  return {
    intent: "status_check",
    confidence,
    suggestedTools,
    reasoning,
  };
};
