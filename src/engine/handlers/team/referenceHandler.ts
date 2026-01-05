/**
 * Team Reference Handler
 *
 * Resolves references like "that team", "this team", "the velocity team", etc.
 *
 * MCP teamSchema fields used:
 * - id: string
 * - name: string
 */

import type { ReferenceHandler } from "../handlers.js";
import type { JsonObject } from "../../../types.js";

export const teamReferenceHandler: ReferenceHandler = async (
  context,
  referenceText,
): Promise<string | null> => {
  let teamEntities: Array<{
    value: string;
    name?: string;
    timestamp: number;
    prominence?: number;
  }> = [];

  // Extract teams from conversation turn entities
  for (const turn of context.conversationHistory) {
    if (turn.entities) {
      for (const entity of turn.entities) {
        if (entity.type === "team") {
          teamEntities.push({
            value: entity.value,
            timestamp: entity.extractedAt || turn.timestamp || Date.now(),
            prominence: entity.prominence || 0.8,
          });
        }
      }
    }
  }

  // Also check current turn's tool results for immediate context
  for (const result of context.toolResults) {
    if (
      result.name === "query-teams" ||
      result.name === "get-team" ||
      result.name === "get-team-members"
    ) {
      if (result.arguments) {
        const args = result.arguments as JsonObject;
        const argId = args.id;
        if (argId && typeof argId === "string") {
          teamEntities.push({
            value: argId,
            timestamp: Date.now(),
            prominence: 1.0,
          });
        }
      }

      const content = result.result;
      if (content) {
        if (Array.isArray(content)) {
          for (const item of content) {
            const team = item as JsonObject;
            const id = team.id;
            const name = team.name;
            if (id && typeof id === "string") {
              teamEntities.push({
                value: id,
                name: typeof name === "string" ? name : undefined,
                timestamp: Date.now(),
                prominence: 1.0,
              });
            }
          }
        } else if (typeof content === "object" && content !== null) {
          const team = content as JsonObject;
          const id = team.id;
          const name = team.name;
          if (id && typeof id === "string") {
            teamEntities.push({
              value: id,
              name: typeof name === "string" ? name : undefined,
              timestamp: Date.now(),
              prominence: 1.0,
            });
          }
        }
      }
    }
  }

  if (teamEntities.length === 0) {
    return null;
  }

  // Refine using reference text
  if (referenceText) {
    const lowerRef = referenceText.toLowerCase();

    // Check for domain mismatch - if reference clearly refers to other entities
    if (
      (lowerRef.includes("service") ||
        lowerRef.includes("incident") ||
        lowerRef.includes("issue") ||
        lowerRef.includes("log") ||
        lowerRef.includes("metric") ||
        lowerRef.includes("alert") ||
        lowerRef.includes("ticket") ||
        lowerRef.includes("deployment")) &&
      !lowerRef.includes("team")
    ) {
      return null;
    }

    // Prioritize exact matches if reference text contains a team name or ID
    const matchingEntities = teamEntities.filter((entity) => {
      const lowerValue = entity.value.toLowerCase();
      const lowerName = entity.name?.toLowerCase();

      // Check if reference contains the team ID or name
      return (
        lowerRef.includes(lowerValue) ||
        (lowerName && lowerRef.includes(lowerName)) ||
        // Handle common team name patterns like "velocity team" -> "velocity"
        (lowerName && lowerRef.includes(`${lowerName} team`)) ||
        (lowerName && lowerRef.includes(`team ${lowerName}`)) ||
        (lowerName && lowerRef.includes(`team-${lowerName}`))
      );
    });

    if (matchingEntities.length > 0) {
      teamEntities = matchingEntities;
    }

    // Handle specific reference patterns
    if (lowerRef.includes("that team") || lowerRef.includes("this team")) {
      // For "that team" or "this team", prefer the most recent team
      teamEntities.sort((a, b) => b.timestamp - a.timestamp);
      return teamEntities[0].value;
    }

    if (lowerRef.includes("the team")) {
      // For "the team", prefer teams with higher prominence (more recently mentioned)
      teamEntities.sort((a, b) => {
        const prominenceDiff = (b.prominence || 0) - (a.prominence || 0);
        if (prominenceDiff !== 0) return prominenceDiff;
        return b.timestamp - a.timestamp;
      });
      return teamEntities[0].value;
    }

    // Handle team name extraction from reference text
    // Patterns like "the velocity team", "velocity team", "team velocity"
    const teamNamePatterns = [
      /\bthe\s+([a-z0-9][a-z0-9-]+)\s+team\b/i,
      /\b([a-z0-9][a-z0-9-]+)\s+team\b/i,
      /\bteam\s+([a-z0-9][a-z0-9-]+)\b/i,
      /\bteam-([a-z0-9][a-z0-9-]+)\b/i,
    ];

    for (const pattern of teamNamePatterns) {
      const match = lowerRef.match(pattern);
      if (match && match[1]) {
        const extractedName = match[1].toLowerCase();
        // Find team with matching name
        const nameMatch = teamEntities.find(
          (entity) => entity.name?.toLowerCase() === extractedName,
        );
        if (nameMatch) {
          return nameMatch.value;
        }
      }
    }
  }

  // Sort by recency and prominence
  teamEntities.sort((a, b) => {
    const prominenceDiff = (b.prominence || 0) - (a.prominence || 0);
    if (prominenceDiff !== 0) return prominenceDiff;
    return b.timestamp - a.timestamp;
  });

  return teamEntities[0].value;
};