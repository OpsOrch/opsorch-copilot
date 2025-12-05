/**
 * Incident Query Builder
 *
 * Builds query-incidents tool arguments from natural language.
 *
 * MCP incidentQuerySchema:
 * - query?: string (text search)
 * - statuses?: string[] (e.g., ['open', 'investigating', 'resolved'])
 * - severities?: string[] (e.g., ['sev1', 'sev2', 'sev3'])
 * - scope?: { service?, environment?, team? }
 * - limit?: number
 */

import { QueryBuilderHandler } from "../handlers.js";
import { JsonObject } from "../../../types.js";

export const incidentQueryBuilder: QueryBuilderHandler = async (
    _context,
    _toolName,
    naturalLanguage,
): Promise<JsonObject> => {
    const lower = naturalLanguage.toLowerCase();
    const result: JsonObject = {};

    // Extract status hints from natural language
    const openKeywords = ['open', 'active', 'ongoing', 'current'];
    const investigatingKeywords = ['investigating', 'triaging', 'in progress'];
    const resolvedKeywords = ['resolved', 'closed', 'fixed', 'mitigated'];

    const statuses: string[] = [];
    if (openKeywords.some(kw => lower.includes(kw))) {
        statuses.push('open');
    }
    if (investigatingKeywords.some(kw => lower.includes(kw))) {
        statuses.push('investigating');
    }
    if (resolvedKeywords.some(kw => lower.includes(kw))) {
        statuses.push('resolved', 'closed');
    }
    if (statuses.length > 0) {
        result.statuses = [...new Set(statuses)];
    }

    // Extract severity hints from natural language
    const severities: string[] = [];
    if (lower.includes('sev1') || lower.includes('sev 1') || lower.includes('critical') || lower.includes('p1')) {
        severities.push('sev1');
    }
    if (lower.includes('sev2') || lower.includes('sev 2') || lower.includes('high') || lower.includes('major') || lower.includes('p2')) {
        severities.push('sev2');
    }
    if (lower.includes('sev3') || lower.includes('sev 3') || lower.includes('medium') || lower.includes('p3')) {
        severities.push('sev3');
    }
    if (lower.includes('sev4') || lower.includes('sev 4') || lower.includes('low') || lower.includes('minor') || lower.includes('p4')) {
        severities.push('sev4');
    }
    if (severities.length > 0) {
        result.severities = severities;
    }

    // Default limit for incident queries
    result.limit = 10;

    return result;
};
