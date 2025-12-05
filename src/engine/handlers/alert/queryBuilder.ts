/**
 * Alert Query Builder
 *
 * Builds query-alerts tool arguments from natural language.
 *
 * MCP alertQuerySchema:
 * - query?: string (text search)
 * - statuses?: string[] (e.g., ['open', 'firing', 'acknowledged'])
 * - severities?: string[] (e.g., ['critical', 'high', 'medium', 'low'])
 * - scope?: { service?, environment?, team? }
 * - limit?: number
 */

import { QueryBuilderHandler } from "../handlers.js";
import { JsonObject } from "../../../types.js";

export const alertQueryBuilder: QueryBuilderHandler = async (
    _context,
    _toolName,
    naturalLanguage,
): Promise<JsonObject> => {
    const lower = naturalLanguage.toLowerCase();
    const result: JsonObject = {};

    // Extract status hints from natural language
    const openKeywords = ['open', 'active', 'firing', 'triggered', 'current'];
    const closedKeywords = ['closed', 'resolved', 'cleared'];
    const ackKeywords = ['acknowledged', 'acked'];

    const statuses: string[] = [];
    if (openKeywords.some(kw => lower.includes(kw))) {
        statuses.push('open', 'firing');
    }
    if (closedKeywords.some(kw => lower.includes(kw))) {
        statuses.push('closed', 'resolved');
    }
    if (ackKeywords.some(kw => lower.includes(kw))) {
        statuses.push('acknowledged');
    }
    if (statuses.length > 0) {
        result.statuses = [...new Set(statuses)]; // Dedupe
    }

    // Extract severity hints from natural language
    const severities: string[] = [];
    if (lower.includes('critical') || lower.includes('p1') || lower.includes('sev1')) {
        severities.push('critical');
    }
    if (lower.includes('high') || lower.includes('p2') || lower.includes('sev2')) {
        severities.push('high');
    }
    if (lower.includes('medium') || lower.includes('p3') || lower.includes('sev3')) {
        severities.push('medium');
    }
    if (lower.includes('low') || lower.includes('p4') || lower.includes('sev4')) {
        severities.push('low');
    }
    if (severities.length > 0) {
        result.severities = severities;
    }

    // Default limit for alert queries
    result.limit = 20;

    return result;
};
