/**
 * Team Intent Handler
 *
 * Detects when users are asking about teams, team ownership, team members,
 * or organizational structure.
 */

import type { IntentHandler } from "../handlers.js";
import type { IntentResult } from "../../../types.js";

/**
 * Intent handler for team-related queries
 *
 * Detects when users are asking about teams, team ownership, team members,
 * or organizational structure.
 */
export const teamIntentHandler: IntentHandler = async (
  context,
): Promise<IntentResult> => {
  const question = context.userQuestion.toLowerCase();

  // Keywords for team-related queries
  const teamKeywords = [
    "team",
    "teams", 
    "owner",
    "owns",
    "ownership",
    "responsible",
    "maintainer",
    "maintainers",
  ];

  const memberKeywords = [
    "member",
    "members",
    "people",
    "person",
    "who is on",
    "who's on",
    "contacts",
    "contact",
  ];

  const organizationKeywords = [
    "organization",
    "org",
    "department",
    "engineering",
    "product",
    "platform",
    "infrastructure",
    "parent",
    "hierarchy",
    "structure",
  ];

  // Action phrases that indicate team queries
  const actionPhrases = [
    "who owns",
    "who is responsible",
    "who maintains",
    "show me the team",
    "find the team",
    "list teams",
    "show teams",
    "teams in",
    "who is on",
    "who's on",
    "team members",
    "team structure",
  ];

  // Patterns for team-related queries
  const patterns = [
    /who owns?\s+(?:service\s+)?[\w-]+/i,
    /(?:show|find|get)\s+(?:me\s+)?(?:the\s+)?[\w-]+\s+team/i,
    /teams?\s+in\s+[\w-]+/i,
    /who\s+(?:is|are)\s+on\s+(?:the\s+)?[\w-]+\s+team/i,
    /[\w-]+\s+team\s+members?/i,
    /team\s+for\s+[\w-]+/i,
  ];

  // Check for matches
  const teamKeywordMatches = teamKeywords.filter((kw) => question.includes(kw));
  const memberKeywordMatches = memberKeywords.filter((kw) => question.includes(kw));
  const orgKeywordMatches = organizationKeywords.filter((kw) => question.includes(kw));
  const actionMatches = actionPhrases.filter((phrase) => question.includes(phrase));
  const patternMatches = patterns.filter((pattern) => pattern.test(question));

  const totalMatches = 
    teamKeywordMatches.length + 
    memberKeywordMatches.length + 
    orgKeywordMatches.length + 
    actionMatches.length + 
    patternMatches.length;

  if (totalMatches === 0) {
    return {
      intent: "unknown",
      confidence: 0.0,
      suggestedTools: [],
      reasoning: "No team-related keywords found",
    };
  }

  // Determine intent type and confidence
  let intent: "investigation" | "status_check" | "action" = "investigation";
  let confidence = 0.8;

  // Check for specific intent patterns
  const isOwnershipQuery = 
    actionMatches.some(phrase => phrase.includes("owns") || phrase.includes("responsible")) ||
    teamKeywordMatches.some(kw => ["owner", "owns", "ownership", "responsible"].includes(kw));

  const isMemberQuery = 
    memberKeywordMatches.length > 0 ||
    actionMatches.some(phrase => phrase.includes("who is on") || phrase.includes("members"));

  const isOrganizationalQuery = 
    orgKeywordMatches.length > 0 ||
    actionMatches.some(phrase => phrase.includes("teams in"));

  const isSpecificTeamQuery = 
    actionMatches.some(phrase => phrase.includes("show me the team") || phrase.includes("find the team")) ||
    patterns.some(pattern => pattern.test(question));

  // Adjust confidence based on match strength
  if (patternMatches.length > 0) {
    confidence = 0.9; // Strong pattern matches
  } else if (actionMatches.length > 0) {
    confidence = 0.85; // Clear action phrases
  } else if (totalMatches >= 2) {
    confidence = 0.8; // Multiple keyword matches
  } else if (teamKeywordMatches.includes("team") && (question.includes("about") || question.includes("tell"))) {
    confidence = 0.75; // "tell me about X team" or "about X team" patterns
  } else {
    confidence = 0.6; // Single keyword match
  }

  // Check conversation history for team context
  const hasRecentTeams = context.toolResults.some(
    (result) =>
      result.name === "query-teams" || 
      result.name === "get-team" || 
      result.name === "get-team-members",
  );
  
  const hasTeamEntity = context.conversationHistory.slice(-3).some(
    (turn) => turn.entities?.some((e) => e.type === "team"),
  );
  
  const hasContext = hasRecentTeams || hasTeamEntity;

  // Determine suggested tools based on query type
  const suggestedTools: string[] = [];

  if (isMemberQuery && hasTeamEntity) {
    // User asking for members after team query
    suggestedTools.push("get-team-members");
    intent = "investigation";
    confidence = Math.min(confidence + 0.1, 1.0);
  } else if (isSpecificTeamQuery) {
    // Looking for a specific team
    suggestedTools.push("query-teams");
    if (isMemberQuery) {
      suggestedTools.push("get-team-members");
    }
  } else if (isOwnershipQuery) {
    // Service ownership query
    suggestedTools.push("query-teams");
    intent = "investigation";
  } else if (isOrganizationalQuery) {
    // Organizational structure query
    suggestedTools.push("query-teams");
    intent = "investigation";
  } else if (!hasContext) {
    // General team query without context
    suggestedTools.push("query-teams");
  }

  // Build reasoning string
  let reasoning = "Team-related intent detected";
  const matchDetails: string[] = [];
  
  if (teamKeywordMatches.length > 0) {
    matchDetails.push(`team keywords: ${teamKeywordMatches.join(", ")}`);
  }
  if (memberKeywordMatches.length > 0) {
    matchDetails.push(`member keywords: ${memberKeywordMatches.join(", ")}`);
  }
  if (orgKeywordMatches.length > 0) {
    matchDetails.push(`org keywords: ${orgKeywordMatches.join(", ")}`);
  }
  if (actionMatches.length > 0) {
    matchDetails.push(`actions: ${actionMatches.join(", ")}`);
  }
  if (patternMatches.length > 0) {
    matchDetails.push(`patterns: ${patternMatches.length}`);
  }

  if (matchDetails.length > 0) {
    reasoning += ` (${matchDetails.join(", ")})`;
  }

  if (isOwnershipQuery) reasoning += " - ownership query";
  if (isMemberQuery) reasoning += " - member query";
  if (isOrganizationalQuery) reasoning += " - organizational query";
  if (hasContext) reasoning += " - team context found";

  return {
    intent,
    confidence,
    suggestedTools,
    reasoning,
  };
};