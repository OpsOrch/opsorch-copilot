/**
 * Metric Query Builder
 *
 * Builds query-metrics tool arguments from natural language.
 *
 * MCP metricQuerySchema:
 * - expression?: { metricName, aggregation?, filters?, groupBy? }
 * - start: datetime
 * - end: datetime
 * - step: number (positive integer, seconds)
 * - scope?: { service?, environment?, team? }
 *
 * Note: We don't guess metric names since they must exist in the provider.
 * If the user mentions specific metric keywords, we include them in the
 * expression for the backend to resolve. Otherwise, the copilot should
 * use describe-metrics first to discover available metrics.
 */

import { QueryBuilderHandler } from "../handlers.js";
import { JsonObject } from "../../../types.js";

export const metricQueryBuilder: QueryBuilderHandler = async (
    _context,
    _toolName,
    naturalLanguage,
): Promise<JsonObject> => {
    const lower = naturalLanguage.toLowerCase();

    // MCP schema: expression: metricExpressionSchema.optional()
    // metricExpressionSchema: { metricName: string, aggregation?, filters?, groupBy? }
    // We extract hints from natural language but don't invent metric names
    const expression: JsonObject = {};

    // Extract metric name hints from user query
    // These are suggestions - the actual metric name must exist in the provider
    if (lower.includes("cpu")) {
        expression.metricName = "cpu";
    } else if (lower.includes("memory") || lower.includes("ram")) {
        expression.metricName = "memory";
    } else if (lower.includes("latency") || lower.includes("response time")) {
        expression.metricName = "latency";
    } else if (lower.includes("request") || lower.includes("throughput")) {
        expression.metricName = "requests";
    }
    // Note: We don't guess names like "error_rate" that may not exist

    // MCP schema: start/end must be ISO 8601 datetime
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 3600000);

    // MCP schema: step: z.number().int().positive() (seconds)
    const result: JsonObject = {
        step: 60,
        start: oneHourAgo.toISOString(),
        end: now.toISOString(),
    };

    // Only include expression if we found a metric name hint
    if (expression.metricName) {
        result.expression = expression;
    }

    return result;
};
