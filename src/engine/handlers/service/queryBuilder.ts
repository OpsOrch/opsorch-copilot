/**
 * Service Query Builder
 *
 * Builds query-services tool arguments from natural language.
 *
 * MCP serviceQuerySchema:
 * - ids?: string[]
 * - name?: string
 * - tags?: { [key: string]: string }
 * - scope?: { service?, environment?, team? }
 * - limit?: number
 */

import { QueryBuilderHandler } from "../handlers.js";
import { JsonObject } from "../../../types.js";

export const serviceQueryBuilder: QueryBuilderHandler = async (
    _context,
    _toolName,
    naturalLanguage,
): Promise<JsonObject> => {
    const lower = naturalLanguage.toLowerCase();
    const result: JsonObject = {};

    // Extract common service name patterns
    // e.g., "checkout service", "payment-api", "svc-auth"
    // Require at least 2 chars to avoid matching generic words like "services"
    const servicePatterns = [
        /\bsvc-([a-z0-9][a-z0-9-]+)/i,
        /\b([a-z0-9][a-z0-9-]+)-(?:api|svc)\b/i,
    ];

    for (const pattern of servicePatterns) {
        const match = lower.match(pattern);
        if (match && match[1] && match[1].length >= 2) {
            result.name = match[1].toLowerCase();
            break;
        }
    }


    // Extract environment hints for scope
    const scope: JsonObject = {};
    if (lower.includes('prod') || lower.includes('production')) {
        scope.environment = 'prod';
    } else if (lower.includes('staging') || lower.includes('stage')) {
        scope.environment = 'staging';
    } else if (lower.includes('dev') || lower.includes('development')) {
        scope.environment = 'dev';
    }

    if (Object.keys(scope).length > 0) {
        result.scope = scope;
    }

    // Default limit for service queries
    result.limit = 20;

    return result;
};
