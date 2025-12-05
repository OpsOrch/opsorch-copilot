/**
 * Ticket Query Builder
 *
 * Builds query-tickets tool arguments from natural language.
 *
 * MCP ticketQuerySchema:
 * - query?: string (text search)
 * - statuses?: string[] (e.g., ['To Do', 'In Progress', 'Done'])
 * - assignees?: string[]
 * - reporter?: string
 * - scope?: { service?, environment?, team? }
 * - limit?: number
 */

import { QueryBuilderHandler } from "../handlers.js";
import { JsonObject } from "../../../types.js";

export const ticketQueryBuilder: QueryBuilderHandler = async (
    _context,
    _toolName,
    naturalLanguage,
): Promise<JsonObject> => {
    const lower = naturalLanguage.toLowerCase();
    const result: JsonObject = {};

    // Extract status hints from natural language
    const todoKeywords = ['to do', 'todo', 'open', 'backlog', 'new'];
    const inProgressKeywords = ['in progress', 'working', 'active', 'ongoing'];
    const doneKeywords = ['done', 'closed', 'resolved', 'completed', 'fixed'];
    const blockedKeywords = ['blocked', 'waiting', 'on hold'];

    const statuses: string[] = [];
    if (todoKeywords.some(kw => lower.includes(kw))) {
        statuses.push('To Do', 'Open', 'Backlog');
    }
    if (inProgressKeywords.some(kw => lower.includes(kw))) {
        statuses.push('In Progress');
    }
    if (doneKeywords.some(kw => lower.includes(kw))) {
        statuses.push('Done', 'Closed', 'Resolved');
    }
    if (blockedKeywords.some(kw => lower.includes(kw))) {
        statuses.push('Blocked');
    }
    if (statuses.length > 0) {
        result.statuses = [...new Set(statuses)];
    }

    // Default limit for ticket queries
    result.limit = 20;

    return result;
};
