import { ToolResult, LlmMessage } from '../types.js';

/**
 * Classification of user intent based on question and conversation context.
 */
export type UserIntent =
    | 'observability'      // User wants logs/metrics/telemetry
    | 'investigation'      // User wants incidents/timeline/root cause
    | 'status_check'       // User wants current state/health
    | 'action'             // User wants to create/update something
    | 'navigation'         // User is continuing/following up
    | 'unknown';           // Cannot determine intent

export interface IntentResult {
    intent: UserIntent;
    confidence: number;      // 0.0 (no confidence) to 1.0 (very confident)
    suggestedTools: string[];
    reasoning: string;       // For debugging and observability
}

export interface ConversationContext {
    // From previous tool results
    lastIncident?: string;
    lastService?: string;
    lastTimeWindow?: { start: string; end: string };

    // From tool execution history
    lastToolsUsed: string[];
    lastToolArgs: Record<string, any>[];

    // Metadata
    turnNumber: number;
    isFollowUp: boolean;
}

// Tier 1: High confidence - Direct action verbs
const TIER1_DIRECT_ACTION = {
    LOGS: /^(show|get|fetch|pull|check|find|display|give|tell|examine|look at|search).*(logs?|log entries|error logs?)/i,
    METRICS: /^(show|get|fetch|pull|check|find|display|give|tell|examine|look at).*(metrics?|latency|p95|p99|error rate|cpu|memory|throughput)/i,
    INCIDENTS: /^(show|get|list|find|enumerate|display).*(incidents?|outages?|issues?|problems?)/i,
    HEALTH: /^(check|verify|test|ping).*(health|status|availability)/i,
};

// Tier 2: Medium confidence - Noun phrases
const TIER2_NOUN_PHRASES = {
    LOGS: /\b(logs?|log entries|error logs?|access logs?|application logs?|system logs?)\b/i,
    METRICS: /\b(metrics?|latency|p95|p99|percentile|error rate|throughput|qps|rps|cpu usage|memory usage|disk usage)\b/i,
    INCIDENTS: /\b(incidents?|outages?|issues?|problems?|alerts?)\b/i,
    OBSERVABILITY: /\b(observability|telemetry|monitoring|dashboards?)\b/i,
    ROOT_CAUSE: /\b(root cause|why|reason|cause|diagnosis)\b/i,
};

// Tier 3: Low confidence - Contextual indicators
const TIER3_CONTEXTUAL = {
    CONTINUATION: /^(also|and|plus|additionally|furthermore|moreover|too|as well)/i,
    QUESTION_FORM: /^(what about|how about|can you show|could you show)\s*/i,
    ABBREVIATED: /^(logs?|metrics?|incidents?)\??$/i,
    IMPLICIT: /^(for (this|that|the same)|same)/i,
};

/**
 * Extract conversation context from history and previous tool results.
 */
export function extractConversationContext(
    history: LlmMessage[],
    previousResults?: ToolResult[]
): ConversationContext {
    const context: ConversationContext = {
        lastToolsUsed: [],
        lastToolArgs: [],
        turnNumber: history.length,
        isFollowUp: history.length > 0,
    };

    // 1. Extract from tool results FIRST (most reliable source)
    if (previousResults && previousResults.length > 0) {
        for (let i = previousResults.length - 1; i >= 0; i--) {
            const result = previousResults[i];

            // Track tool usage
            context.lastToolsUsed.push(result.name);
            context.lastToolArgs.push(result.arguments || {});

            const payload = result.result;

            if (!payload || typeof payload !== 'object') continue;

            // Extract service
            if (!context.lastService) {
                const scope = (payload as any).scope;
                if (scope?.service) context.lastService = scope.service;
                if ((payload as any).service) context.lastService = (payload as any).service;

                // From incident arrays
                if (Array.isArray((payload as any).incidents)) {
                    const firstIncident = (payload as any).incidents[0];
                    if (firstIncident?.service) context.lastService = firstIncident.service;
                }
            }

            // Extract incident ID
            if (!context.lastIncident) {
                if ((payload as any).id?.startsWith('inc-')) {
                    context.lastIncident = (payload as any).id;
                }
                if (Array.isArray((payload as any).incidents) && (payload as any).incidents.length > 0) {
                    const firstIncident = (payload as any).incidents[0];
                    if (firstIncident?.id?.startsWith('inc-')) {
                        context.lastIncident = firstIncident.id;
                    }
                }
            }

            // Extract time window
            if (!context.lastTimeWindow) {
                const start = (payload as any).start || (payload as any).startTime;
                const end = (payload as any).end || (payload as any).endTime;
                if (start && end && /\d{4}-\d{2}-\d{2}T/.test(start)) {
                    context.lastTimeWindow = { start, end };
                }
            }
        }
    }

    // 2. Extract from message text as FALLBACK (only if not found in tool results)
    if (!context.lastService) {
        const recentMessages = history.slice(-10).reverse();
        for (const message of recentMessages) {
            const text = message.content || '';
            if (!text || typeof text !== 'string') continue;

            // Pattern 1: "service: <name>" or "service=<name>"
            const serviceColonMatch = text.match(/service[:\s=]+([a-z0-9-_]+)/i);
            if (serviceColonMatch && serviceColonMatch[1] && !context.lastService) {
                context.lastService = serviceColonMatch[1];
                break; // Found service, stop searching
            }

            // Pattern 2: "in <service-name> service" or "for <service-name>"
            const servicePatternMatch = text.match(/(?:in|for)\s+([a-z0-9-_]+)(?:\s+service)?/i);
            if (servicePatternMatch && servicePatternMatch[1] && !context.lastService) {
                const candidate = servicePatternMatch[1];
                const stopWords = ['the', 'a', 'an', 'this', 'that', 'which', 'last', 'past'];
                if (!stopWords.includes(candidate.toLowerCase()) && candidate.includes('-')) {
                    context.lastService = candidate;
                    break; // Found service, stop searching
                }
            }

            // Pattern 3: Kebab-case identifiers (e.g., payment-service, checkout-api)
            if (!context.lastService) {
                const kebabMatch = text.match(/\b([a-z]+-[a-z0-9-]+)\b/i);
                if (kebabMatch && kebabMatch[1]) {
                    const candidate = kebabMatch[1].toLowerCase();
                    // Accept service-like patterns (contains 'service', 'api', or multiple dashes)
                    if (candidate.includes('service') || candidate.includes('api') || candidate.split('-').length >= 2) {
                        context.lastService = candidate;
                        break; // Found service, stop searching
                    }
                }
            }
        }
    }

    return context;
}

/**
 * Classify user intent based on question and conversation context.
 */
export function classifyIntent(
    question: string,
    context: ConversationContext
): IntentResult {
    const normalized = question.toLowerCase().trim();

    // TIER 1: Direct action patterns (high confidence)

    // Check for combined requests first
    if (TIER1_DIRECT_ACTION.LOGS.test(normalized) && TIER1_DIRECT_ACTION.METRICS.test(normalized)) {
        return {
            intent: 'observability',
            confidence: 0.95,
            suggestedTools: ['query-logs', 'query-metrics'],
            reasoning: 'Direct request for both logs and metrics',
        };
    }

    if (TIER1_DIRECT_ACTION.LOGS.test(normalized)) {
        return {
            intent: 'observability',
            confidence: 0.9,
            suggestedTools: ['query-logs'],
            reasoning: 'Direct request for logs with action verb',
        };
    }

    if (TIER1_DIRECT_ACTION.METRICS.test(normalized)) {
        return {
            intent: 'observability',
            confidence: 0.9,
            suggestedTools: ['query-metrics'],
            reasoning: 'Direct request for metrics with action verb',
        };
    }

    if (TIER1_DIRECT_ACTION.INCIDENTS.test(normalized)) {
        return {
            intent: 'investigation',
            confidence: 0.9,
            suggestedTools: ['query-incidents'],
            reasoning: 'Direct request for incidents with action verb',
        };
    }

    if (TIER1_DIRECT_ACTION.HEALTH.test(normalized)) {
        return {
            intent: 'status_check',
            confidence: 0.9,
            suggestedTools: ['health'],
            reasoning: 'Direct health check request',
        };
    }

    // TIER 3: Contextual patterns (low-medium confidence, requires context)
    // CHECK BEFORE TIER 2 to catch continuations like "also metrics" before noun phrase matching
    if (TIER3_CONTEXTUAL.CONTINUATION.test(normalized) && context.isFollowUp) {
        // "also metrics", "and logs", etc.
        const hasLogs = TIER2_NOUN_PHRASES.LOGS.test(normalized);
        const hasMetrics = TIER2_NOUN_PHRASES.METRICS.test(normalized);

        // Check what we just did
        const lastTool = context.lastToolsUsed[context.lastToolsUsed.length - 1];

        if (lastTool === 'query-logs' && hasMetrics) {
            return {
                intent: 'navigation',
                confidence: 0.7,
                suggestedTools: ['query-metrics'],
                reasoning: 'Continuation: user wants metrics after logs',
            };
        }

        if (lastTool === 'query-metrics' && hasLogs) {
            return {
                intent: 'navigation',
                confidence: 0.7,
                suggestedTools: ['query-logs'],
                reasoning: 'Continuation: user wants logs after metrics',
            };
        }

        // Generic continuation
        if (hasLogs || hasMetrics) {
            return {
                intent: 'navigation',
                confidence: 0.6,
                suggestedTools: hasLogs ? ['query-logs'] : ['query-metrics'],
                reasoning: 'Continuation with observability keyword',
            };
        }
    }

    // TIER 2: Noun phrase patterns (medium confidence, especially with context)
    const hasLogs = TIER2_NOUN_PHRASES.LOGS.test(normalized);
    const hasMetrics = TIER2_NOUN_PHRASES.METRICS.test(normalized);
    const hasIncidents = TIER2_NOUN_PHRASES.INCIDENTS.test(normalized);
    const hasObservability = TIER2_NOUN_PHRASES.OBSERVABILITY.test(normalized);
    const hasRootCause = TIER2_NOUN_PHRASES.ROOT_CAUSE.test(normalized);

    // "metrics and logs" or "logs and metrics"
    if ((hasLogs || hasMetrics || hasObservability) && context.isFollowUp) {
        const tools: string[] = [];
        if (hasLogs || hasObservability) tools.push('query-logs');
        if (hasMetrics || hasObservability) tools.push('query-metrics');

        return {
            intent: 'observability',
            confidence: context.lastService ? 0.8 : 0.6,  // Higher if we have service context
            suggestedTools: tools.length > 0 ? tools : ['query-logs', 'query-metrics'],
            reasoning: 'Noun phrase for observability data' + (context.lastService ? ' with service context' : ''),
        };
    }

    if (hasIncidents || hasRootCause) {
        const tools: string[] = [];
        if (hasIncidents) tools.push('query-incidents');
        if (hasRootCause && context.lastIncident) {
            tools.push('get-incident-timeline', 'query-logs', 'query-metrics');
        }

        return {
            intent: hasRootCause ? 'investigation' : 'investigation',
            confidence: 0.7,
            suggestedTools: tools.length > 0 ? tools : ['query-incidents'],
            reasoning: hasRootCause ? 'Root cause investigation request' : 'Incident investigation request',
        };
    }

    // Rest of TIER 3: Abbreviated and implicit patterns

    if (TIER3_CONTEXTUAL.ABBREVIATED.test(normalized)) {
        // Just "logs?" or "metrics"
        const tools: string[] = [];
        if (/^logs?\??$/.test(normalized)) tools.push('query-logs');
        if (/^metrics?\??$/.test(normalized)) tools.push('query-metrics');
        if (/^incidents?\??$/.test(normalized)) tools.push('query-incidents');

        if (tools.length > 0) {
            return {
                intent: 'observability',
                confidence: context.lastService ? 0.7 : 0.5,
                suggestedTools: tools,
                reasoning: 'Abbreviated request: ' + normalized,
            };
        }
    }

    if (TIER3_CONTEXTUAL.IMPLICIT.test(normalized)) {
        // "for this service", "for the same", etc.
        if (context.lastService && (hasLogs || hasMetrics)) {
            return {
                intent: 'observability',
                confidence: 0.6,
                suggestedTools: hasLogs ? ['query-logs'] : ['query-metrics'],
                reasoning: 'Implicit service reference with observability keyword',
            };
        }
    }

    // Default: Unknown
    return {
        intent: 'unknown',
        confidence: 0.0,
        suggestedTools: [],
        reasoning: 'No patterns matched',
    };
}
