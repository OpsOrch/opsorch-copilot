/**
 * Deployment Query Builder
 *
 * Builds query-deployments tool arguments from natural language.
 *
 * MCP deploymentQuerySchema:
 * - query?: string (text search)
 * - statuses?: string[]
 * - versions?: string[]
 * - scope?: { service?, environment?, team? }
 * - limit?: number
 * - metadata?: Record<string, any>
 */

import { QueryBuilderHandler } from "../handlers.js";
import { JsonObject } from "../../../types.js";
import {
    buildDeploymentScope,
    buildKeywordQuery,
    extractDeploymentIdCandidates,
    extractVersionCandidates,
} from "./helpers.js";

export const deploymentQueryBuilder: QueryBuilderHandler = async (
    context,
    _toolName,
    naturalLanguage,
): Promise<JsonObject> => {
    const lower = naturalLanguage.toLowerCase();
    const result: JsonObject = {};

    const scope = buildDeploymentScope(context);
    if (scope) {
        result.scope = { ...scope };
    }

    // Extract status hints
    const failedKeywords = ['failed', 'failure', 'broken', 'error'];
    const successKeywords = ['success', 'successful', 'ok', 'healthy', 'passed'];
    const runningKeywords = ['running', 'in progress', 'deploying', 'rolling out', 'queued', 'pending'];

    const statuses: string[] = [];
    if (failedKeywords.some(kw => lower.includes(kw))) {
        statuses.push('failed');
    }
    if (successKeywords.some(kw => lower.includes(kw))) {
        statuses.push('success');
    }
    if (runningKeywords.some(kw => lower.includes(kw))) {
        statuses.push('running', 'queued');
    }

    if (statuses.length > 0) {
        result.statuses = [...new Set(statuses)];
    }

    // Extract limit hint
    const explicitLimitMatch = lower.match(/(?:last|recent|latest)?\s*(\d{1,2})\s+(?:deployments|deploys|releases)/);
    if (explicitLimitMatch) {
        result.limit = Number(explicitLimitMatch[1]);
    } else if (lower.includes('single deployment') || lower.includes('one deployment')) {
        result.limit = 1;
    } else if (lower.includes('recent') || lower.includes('latest') || lower.includes('last')) {
        result.limit = 5;
    } else {
        result.limit = 10;
    }

    const idCandidates = extractDeploymentIdCandidates(naturalLanguage);
    if (idCandidates.length > 0) {
        result.id = idCandidates[0];
    }

    // Extract version candidates for the versions field
    const versionCandidates = extractVersionCandidates(naturalLanguage)
        .filter((version) => version !== result.id);
    if (versionCandidates.length > 0) {
        result.versions = versionCandidates;
    }

    const keywordQuery = buildKeywordQuery(naturalLanguage);
    if (keywordQuery) {
        result.query = keywordQuery;
    }

    return result;
};
