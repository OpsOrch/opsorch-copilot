/**
 * Log Query Builder
 *
 * Builds query-logs tool arguments from natural language.
 *
 * MCP logQuerySchema:
 * - expression?: { search?, severityIn?, filters? }
 * - start: datetime
 * - end: datetime
 * - scope?: { service?, environment?, team? }
 * - limit?: number
 */

import { QueryBuilderHandler } from "../handlers.js";
import { HandlerUtils } from "../utils.js";
import { JsonObject } from "../../../types.js";

export const logQueryBuilder: QueryBuilderHandler = async (
    _context,
    _toolName,
    naturalLanguage,
): Promise<JsonObject> => {
    const terms = HandlerUtils.extractKeywords(naturalLanguage, [
        "tell",
        "me",
        "more",
        "about",
        "in",
        "logs",
        "and",
        "metrics",
        "check",
        "show",
        "search",
        "find",
    ]);

    const searchQuery = terms.length > 0 ? terms.join(" ") : "error";

    // MCP schema: expression: logExpressionSchema.optional()
    // logExpressionSchema: { search?: string, severityIn?: string[], filters?: ... }
    const expression: JsonObject = {
        search: searchQuery,
    };

    // Check for severity hints in natural language
    const lower = naturalLanguage.toLowerCase();
    if (lower.includes("error") || lower.includes("exception")) {
        expression.severityIn = ["error"];
    } else if (lower.includes("warn")) {
        expression.severityIn = ["warn", "warning"];
    }

    // MCP schema: start/end must be ISO 8601 datetime
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 3600000);

    return {
        expression,
        start: oneHourAgo.toISOString(),
        end: now.toISOString(),
    };
};
