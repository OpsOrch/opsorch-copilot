import { ConversationContext } from './intentClassifier.js';

/**
 * Build a smart log query based on user question and conversation context.
 */
export function buildLogQuery(
    question: string,
    context: ConversationContext
): string {
    const patterns: string[] = [];
    const normalized = question.toLowerCase();

    // Extract error codes: "500", "504", "5xx", "404" (and plurals like "504s")
    const errorCodeMatches = question.match(/\b([45]\d{2}|[45]xx)s?\b/gi);
    if (errorCodeMatches) {
        patterns.push(...errorCodeMatches.map(code => code.replace(/s$/i, '').replace('xx', 'x')));
    }

    // Extract error keywords (including plurals)
    const errorKeywords = normalized.match(/\b(errors?|exceptions?|timeouts?|failures?|failed|crashes?|panics?|fatals?|warnings?)\b/gi);
    if (errorKeywords) {
        const unique = [...new Set(errorKeywords.map(k => k.toLowerCase().replace(/s$/, '')))];  // Normalize plurals
        patterns.push(...unique);
    }

    // Extract specific log-related terms
    if (/disconnect/i.test(normalized)) patterns.push('disconnect');
    if (/websocket/i.test(normalized)) patterns.push('websocket');
    if (/realtime/i.test(normalized)) patterns.push('realtime');
    if (/updates/i.test(normalized)) patterns.push('updates');

    // Use incident context
    if (context.lastIncident && !patterns.length) {
        patterns.push('error', 'exception');
    }

    // Default to error or exception if nothing found
    if (patterns.length === 0) {
        return 'error OR exception';
    }

    return patterns.join(' OR ');
}

/**
 * Build a smart metrics expression based on user question and conversation context.
 */
export function buildMetricsExpression(
    question: string,
    _context: ConversationContext
): string {
    const normalized = question.toLowerCase();

    // Latency-related
    if (/\b(latency|response time|slow|p95|p99|percentile)\b/i.test(normalized)) {
        return 'latency_p95';
    }

    // Error rate
    if (/\b(error rate|errors|failures?|failed)\b/i.test(normalized)) {
        return 'error_rate';
    }

    // CPU
    if (/\b(cpu|processor)\b/i.test(normalized)) {
        return 'cpu_usage';
    }

    // Memory
    if (/\b(memory|ram|heap)\b/i.test(normalized)) {
        return 'memory_usage';
    }

    // Throughput
    if (/\b(throughput|qps|rps|requests|traffic)\b/i.test(normalized)) {
        return 'request_rate';
    }

    // Default to latency
    return 'latency_p95';
}

/**
 * Get default time window (last 1 hour by default).
 */
export function getDefaultTimeWindow(context: ConversationContext): { start: string; end: string } {
    // Reuse from context if available
    if (context.lastTimeWindow) {
        return context.lastTimeWindow;
    }

    // Default: last 1 hour
    const end = new Date();
    const start = new Date(end.getTime() - 60 * 60 * 1000); // 1 hour ago

    return {
        start: start.toISOString(),
        end: end.toISOString(),
    };
}

/**
 * Parse time window from question if specified.
 * Examples: "last 2 hours", "past 30 minutes", "last hour"
 */
export function parseTimeWindow(question: string): { start: string; end: string } | undefined {
    const match = question.match(/(last|past|previous)\s+(\d+)\s+(minute|hour|day)s?/i);
    if (!match) return undefined;

    const amount = parseInt(match[2], 10);
    const unit = match[3].toLowerCase();

    let milliseconds = 0;
    if (unit === 'minute') milliseconds = amount * 60 * 1000;
    else if (unit === 'hour') milliseconds = amount * 60 * 60 * 1000;
    else if (unit === 'day') milliseconds = amount * 24 * 60 * 60 * 1000;

    const end = new Date();
    const start = new Date(end.getTime() - milliseconds);

    return {
        start: start.toISOString(),
        end: end.toISOString(),
    };
}
