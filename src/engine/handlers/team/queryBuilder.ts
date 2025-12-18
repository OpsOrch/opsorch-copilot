/**
 * Team Query Builder
 *
 * Builds query-teams tool arguments from natural language.
 *
 * MCP teamQuerySchema:
 * - name?: string
 * - tags?: Record<string, string>
 * - scope?: { service?, environment?, team? }
 * - limit?: number
 * - metadata?: Record<string, any>
 */

import { QueryBuilderHandler } from "../handlers.js";
import { JsonObject } from "../../../types.js";

export const teamQueryBuilder: QueryBuilderHandler = async (
  _context,
  _toolName,
  naturalLanguage,
): Promise<JsonObject> => {
  const lower = naturalLanguage.toLowerCase();
  const result: JsonObject = {};

  // Extract team name patterns from natural language
  // Patterns like "velocity team", "team-velocity", "payments team", etc.
  const teamNamePatterns = [
    // "team-velocity", "team-payments" (hyphenated) - check this first
    /\bteam-([a-z0-9][a-z0-9-]+)\b/i,
    // "velocity team", "payments team", "engineering team"
    /\b([a-z0-9][a-z0-9-]+)\s+team\b/i,
    // "the velocity team", "the payments team"
    /\bthe\s+([a-z0-9][a-z0-9-]+)\s+team\b/i,
    // "team velocity", "team payments", "team engineering" (but not "team for" or "team under")
    /\bteam\s+([a-z0-9][a-z0-9-]+)(?!\s+(?:for|under|in))\b/i,
    // "show me velocity team", "find velocity" (when context suggests team)
    /\b(?:show|find|get)\s+(?:me\s+)?(?:the\s+)?([a-z0-9][a-z0-9-]+)(?:\s+team)?\b/i,
  ];

  for (const pattern of teamNamePatterns) {
    const match = lower.match(pattern);
    if (match && match[1] && match[1].length >= 2) {
      // Avoid generic words that aren't team names
      const genericWords = ['service', 'services', 'system', 'application', 'app', 'api', 'web', 'mobile'];
      if (!genericWords.includes(match[1].toLowerCase())) {
        result.name = match[1].toLowerCase();
        break;
      }
    }
  }

  // Extract service context for scope-based team queries
  // Patterns like "who owns service X", "team for payments service"
  const serviceOwnershipPatterns = [
    /\bwho\s+owns?\s+(?:the\s+)?(?:service\s+)?([a-z0-9][a-z0-9-]+)(?:\s+service)?\b/i,
    /\bteam\s+for\s+(?:the\s+)?(?:service\s+)?([a-z0-9][a-z0-9-]+)(?:\s+service)?\b/i,
    /\bresponsible\s+for\s+(?:the\s+)?(?:service\s+)?([a-z0-9][a-z0-9-]+)(?:\s+service)?\b/i,
    /\bmaintains?\s+(?:the\s+)?(?:service\s+)?([a-z0-9][a-z0-9-]+)(?:\s+service)?\b/i,
  ];

  const scope: JsonObject = {};
  for (const pattern of serviceOwnershipPatterns) {
    const match = lower.match(pattern);
    if (match && match[1] && match[1].length >= 2) {
      scope.service = match[1].toLowerCase();
      break;
    }
  }

  // Extract organizational hierarchy patterns
  // Patterns like "teams in engineering", "engineering teams", "platform teams"
  const organizationPatterns = [
    /\bteams?\s+in\s+([a-z0-9][a-z0-9-]+)\b/i,
    /\b([a-z0-9][a-z0-9-]+)\s+teams?\b/i,
  ];

  for (const pattern of organizationPatterns) {
    const match = lower.match(pattern);
    if (match && match[1] && match[1].length >= 2) {
      const orgName = match[1].toLowerCase();
      // Common organizational units
      const orgUnits = ['engineering', 'product', 'platform', 'infrastructure', 'security', 'data', 'mobile', 'web', 'backend', 'frontend'];
      if (orgUnits.includes(orgName)) {
        // Use tags to filter by organizational unit
        result.tags = { type: orgName };
        break;
      }
    }
  }

  // Extract environment hints for scope
  if (lower.includes('prod') || lower.includes('production')) {
    scope.environment = 'production';
  } else if (lower.includes('staging') || lower.includes('stage')) {
    scope.environment = 'staging';
  } else if (lower.includes('dev') || lower.includes('development')) {
    scope.environment = 'development';
  }

  // Extract team context for scope (when asking about sub-teams or related teams)
  const teamScopePatterns = [
    /\bteams?\s+under\s+([a-z0-9][a-z0-9-]+)\b/i,
    /\bsub-?teams?\s+of\s+([a-z0-9][a-z0-9-]+)\b/i,
    /\bteams?\s+in\s+([a-z0-9][a-z0-9-]+)\s+(?:team|org|organization)\b/i,
  ];

  for (const pattern of teamScopePatterns) {
    const match = lower.match(pattern);
    if (match && match[1] && match[1].length >= 2) {
      scope.team = match[1].toLowerCase();
      break;
    }
  }

  if (Object.keys(scope).length > 0) {
    result.scope = scope;
  }

  // Extract specific query terms for text search
  // Remove common words and team-specific terms to get meaningful search terms
  const queryTerms: string[] = [];
  const words = naturalLanguage.toLowerCase().split(/\s+/);
  const stopWords = [
    'who', 'what', 'where', 'when', 'how', 'why', 'is', 'are', 'was', 'were',
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of',
    'with', 'by', 'from', 'up', 'about', 'into', 'through', 'during', 'before',
    'after', 'above', 'below', 'between', 'among', 'team', 'teams', 'service',
    'services', 'owns', 'own', 'responsible', 'maintains', 'maintain', 'show',
    'find', 'get', 'me', 'tell', 'list', 'all'
  ];

  for (const word of words) {
    if (word.length >= 3 && !stopWords.includes(word) && /^[a-z0-9-]+$/.test(word)) {
      queryTerms.push(word);
    }
  }

  // Only add query if we have meaningful terms and no specific name
  if (queryTerms.length > 0 && !result.name) {
    result.query = queryTerms.join(' ');
  }

  // Note: Backend MCP server doesn't accept limit field, so we don't include it

  return result;
};