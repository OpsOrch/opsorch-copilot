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
  const hasSpecificTicket = /ticket-?\d+/i.test(question);
  const suggestedTools: string[] = [];

  // Check for ticket context in recent history (used in logic below)
  const hasTicketHistory = context.conversationHistory.slice(-3).some(
    (turn) => turn.entities?.some((e) => e.type === "ticket"),
  );

  if (hasSpecificTicket) {
    // Specific ticket ID mentioned - get-ticket is sufficient
    suggestedTools.push("get-ticket");
  } else {
    // Only suggest query-tickets if no context OR explicit request
    if (!hasTicketHistory || actionMatches.length > 0) {
      suggestedTools.push("query-tickets");
    }
  }

  let reasoning = `Ticket query detected (keyword matches: ${keywordMatches.join(", ")}, action matches: ${actionMatches.join(", ")})`;
  if (isJira) reasoning += " - JIRA context";
  if (hasTicketHistory) reasoning += " - ticket context found in history";

  return {
    intent: "status_check",
    confidence,
    suggestedTools,
    reasoning,
  };
};
