/**
 * Team Follow-up Handler
 *
 * Field names match MCP teamSchema:
 * - id: string
 * - name: string
 * - parent?: string
 * - tags?: Record<string, string>
 * - metadata?: Record<string, unknown>
 */

import type { FollowUpHandler } from "../handlers.js";
import type { ToolCall, JsonObject } from "../../../types.js";
import { HandlerUtils } from "../utils.js";

export const teamFollowUpHandler: FollowUpHandler = async (
  context,
  toolResult,
): Promise<ToolCall[]> => {
  const suggestions: ToolCall[] = [];

  if (!toolResult.result || typeof toolResult.result !== "object") {
    return suggestions;
  }

  // query-teams returns z.array(teamSchema), get-team returns teamSchema
  let teams: JsonObject[] = [];
  if (Array.isArray(toolResult.result)) {
    teams = toolResult.result as JsonObject[];
  } else {
    teams = [toolResult.result as JsonObject];
  }

  const question = context.userQuestion.toLowerCase();
  const isMemberQuery = 
    question.includes("who is on") || 
    question.includes("who's on") || 
    question.includes("members") || 
    question.includes("people");

  for (const team of teams.slice(0, 3)) {
    // MCP schema: id: z.string(), name: z.string()
    const teamId = team.id;
    const teamName = team.name;
    const parentTeam = team.parent;

    if (teamId && typeof teamId === "string") {
      // Always suggest team members as a primary follow-up
      if (!HandlerUtils.isDuplicateToolCall(context, "get-team-members", teamId)) {
        suggestions.push({
          name: "get-team-members",
          arguments: {
            id: teamId,
          },
        });
      }

      // If user explicitly asked about members, prioritize that
      if (isMemberQuery) {
        continue; // Skip other suggestions for member-focused queries
      }
    }

    if (teamName && typeof teamName === "string") {
      // Find services owned by this team - this is the key follow-up
      if (!HandlerUtils.isDuplicateToolCall(context, "query-services", teamName)) {
        suggestions.push({
          name: "query-services",
          arguments: {
            scope: { team: teamName },
            limit: 20,
          },
        });
      }

      // Check for incidents related to this team's services
      suggestions.push({
        name: "query-incidents",
        arguments: {
          scope: { team: teamName },
          statuses: ["open", "investigating"],
          limit: 10,
        },
      });

      // Check for recent deployments by this team
      suggestions.push({
        name: "query-deployments",
        arguments: {
          scope: { team: teamName },
          limit: 10,
        },
      });

      // Check for tickets assigned to this team
      suggestions.push({
        name: "query-tickets",
        arguments: {
          scope: { team: teamName },
          statuses: ["To Do", "In Progress"],
          limit: 15,
        },
      });
    }

    // If team has a parent, suggest exploring the parent team structure
    if (parentTeam && typeof parentTeam === "string") {
      if (!HandlerUtils.isDuplicateToolCall(context, "get-team", parentTeam)) {
        suggestions.push({
          name: "get-team",
          arguments: {
            id: parentTeam,
          },
        });
      }

      // Find other teams under the same parent (sibling teams)
      suggestions.push({
        name: "query-teams",
        arguments: {
          scope: { team: parentTeam },
          limit: 10,
        },
      });
    }

    // Extract team tags for additional context
    const tags = team.tags as JsonObject | undefined;
    if (tags && typeof tags === "object") {
      // If team has organizational tags, suggest related teams
      const orgType = tags.type as string | undefined;
      if (orgType && typeof orgType === "string") {
        suggestions.push({
          name: "query-teams",
          arguments: {
            tags: { type: orgType },
            limit: 15,
          },
        });
      }

      // If team has environment tags, scope service queries
      const environment = tags.environment as string | undefined;
      if (environment && typeof environment === "string" && teamName) {
        suggestions.push({
          name: "query-services",
          arguments: {
            scope: { 
              team: teamName,
              environment: environment 
            },
            limit: 20,
          },
        });
      }
    }

    // Check team metadata for additional follow-up opportunities
    const metadata = team.metadata as JsonObject | undefined;
    if (metadata && typeof metadata === "object") {
      // If metadata contains service information, query those services directly
      const services = metadata.services;
      if (Array.isArray(services)) {
        for (const service of services.slice(0, 3)) {
          if (typeof service === "string") {
            suggestions.push({
              name: "query-services",
              arguments: {
                name: service,
                limit: 5,
              },
            });
          }
        }
      }

      // If metadata contains Slack channel, suggest checking recent incidents
      const slackChannel = metadata.slack_channel;
      if (slackChannel && typeof slackChannel === "string" && teamName) {
        // Use team name to find recent incidents that might be discussed in Slack
        suggestions.push({
          name: "query-incidents",
          arguments: {
            scope: { team: teamName },
            limit: 5,
          },
        });
      }
    }
  }

  // If multiple teams found, suggest narrowing the search
  if (teams.length > 1 && !question.includes("all") && !question.includes("list")) {
    const firstTeam = teams[0];
    const teamName = firstTeam.name;
    
    if (teamName && typeof teamName === "string") {
      suggestions.push({
        name: "get-team",
        arguments: {
          id: firstTeam.id as string,
        },
      });
    }
  }

  // Remove duplicates and limit suggestions
  const uniqueSuggestions = suggestions.filter((suggestion, index, self) => {
    const key = `${suggestion.name}:${JSON.stringify(suggestion.arguments)}`;
    return index === self.findIndex(s => `${s.name}:${JSON.stringify(s.arguments)}` === key);
  });

  return uniqueSuggestions.slice(0, 8); // Limit to 8 suggestions to avoid overwhelming
};