import { ToolResult, LlmMessage, UserIntent, IntentResult, IntentContext } from '../types.js';
import { DomainRegistry } from './domainRegistry.js';

/**
 * Domain-based IntentClassifier that uses domain configurations
 * for flexible, configuration-driven intent classification.
 */
export class IntentClassifier {
    constructor(private registry: DomainRegistry) { }

    /**
     * Classify user intent based on question and conversation context
     */
    classifyIntent(
        question: string,
        context: IntentContext
    ): IntentResult {
        const normalized = question.toLowerCase().trim();
        const domains = this.registry.getAllDomains();

        // Track best match
        let bestMatch: IntentResult | null = null;
        let bestScore = 0;

        const allSuggestedTools: string[] = [];

        // Check each domain's intent configuration
        for (const domain of domains) {
            if (!domain.intent) continue;

            const { keywords, actionPhrases, patterns, confidence: baseConfidence } = domain.intent;
            let score = 0;
            let matchType = '';

            // 1. Check action phrases (highest priority)
            if (actionPhrases) {
                for (const phrase of actionPhrases) {
                    const regex = new RegExp(`\\b${this.escapeRegex(phrase)}\\b`, 'i');
                    if (regex.test(normalized)) {
                        score = 0.9 * (baseConfidence || 1.0);
                        matchType = `action phrase: "${phrase}"`;
                        break;
                    }
                }
            }

            // 2. Check regex patterns (high priority)
            if (score === 0 && patterns) {
                for (const pattern of patterns) {
                    try {
                        const regex = new RegExp(pattern, 'i');
                        if (regex.test(normalized)) {
                            score = 0.8 * (baseConfidence || 1.0);
                            matchType = `pattern match`;
                            break;
                        }
                    } catch (e) {
                        console.warn(`[IntentClassifier] Invalid pattern in ${domain.name}: ${pattern}`);
                    }
                }
            }

            // 3. Check keywords (medium priority)
            if (score === 0 && keywords) {
                let keywordMatches = 0;
                for (const keyword of keywords) {
                    const regex = new RegExp(`\\b${this.escapeRegex(keyword)}\\b`, 'i');
                    if (regex.test(normalized)) {
                        keywordMatches++;
                    }
                }

                if (keywordMatches > 0) {
                    // More keywords = higher confidence
                    score = Math.min(0.7, 0.5 + (keywordMatches * 0.1)) * (baseConfidence || 1.0);
                    matchType = `${keywordMatches} keyword(s)`;
                }
            }

            // Apply context boost
            if (score > 0 && context.isFollowUp) {
                score = Math.min(1.0, score + 0.1);
            }

            // Collect tools from high-confidence matches
            if (score >= 0.5) {
                const tools = this.getSuggestedTools(domain.toolPatterns);
                allSuggestedTools.push(...tools);
            }

            // Update best match
            if (score > bestScore) {
                bestScore = score;
                bestMatch = {
                    intent: this.mapDomainToIntent(domain.name),
                    confidence: score,
                    suggestedTools: [], // Will be populated later
                    reasoning: `${domain.name} domain matched via ${matchType}`,
                };
            }
        }

        // Check for continuation patterns
        if (context.isFollowUp && /^(also|and|plus|additionally)\s+/i.test(normalized)) {
            const continuationResult = this.handleContinuation(normalized, context);
            if (continuationResult && continuationResult.confidence > bestScore) {
                return continuationResult;
            }
        }

        // Return best match with aggregated tools
        if (bestMatch) {
            bestMatch.suggestedTools = [...new Set(allSuggestedTools)];
            return bestMatch;
        }

        return {
            intent: 'unknown',
            confidence: 0.0,
            suggestedTools: [],
            reasoning: 'No domain patterns matched',
        };
    }

    /**
     * Handle continuation patterns like "also metrics", "and logs"
     * Uses domain configurations to determine what the user is asking for
     */
    private handleContinuation(
        normalized: string,
        context: IntentContext
    ): IntentResult | null {
        const lastTool = context.lastToolsUsed[context.lastToolsUsed.length - 1];
        if (!lastTool) return null;

        const lastDomain = this.registry.getDomainForTool(lastTool);
        if (!lastDomain) return null;

        // Check which domain the user is now asking about
        const domains = this.registry.getAllDomains();

        for (const domain of domains) {
            if (!domain.intent || domain.name === lastDomain.name) continue;

            // Check if question mentions this domain's keywords
            const { keywords } = domain.intent;
            if (!keywords) continue;

            for (const keyword of keywords) {
                const regex = new RegExp(`\\b${this.escapeRegex(keyword)}\\b`, 'i');
                if (regex.test(normalized)) {
                    // User is asking for a different domain's data
                    return {
                        intent: 'navigation',
                        confidence: 0.9,
                        suggestedTools: this.getSuggestedTools(domain.toolPatterns),
                        reasoning: `Continuation: user wants ${domain.name} data after ${lastDomain.name}`,
                    };
                }
            }
        }

        return null;
    }

    /**
     * Map domain name to intent type
     */
    private mapDomainToIntent(domainName: string): UserIntent {
        switch (domainName) {
            case 'log':
            case 'metric':
                return 'observability';
            case 'incident':
            case 'ticket':
                return 'investigation';
            case 'service':
                return 'status_check';
            default:
                return 'unknown';
        }
    }

    /**
     * Get suggested tools from domain tool patterns
     */
    private getSuggestedTools(toolPatterns: any[]): string[] {
        // Return the highest priority exact match tools
        return toolPatterns
            .filter(p => p.type === 'exact')
            .sort((a, b) => (b.priority || 0) - (a.priority || 0))
            .slice(0, 2)
            .map(p => p.match);
    }

    /**
     * Escape special regex characters
     */
    private escapeRegex(str: string): string {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
}

/**
 * Extract conversation context from history and previous tool results.
 * Simplified version - just tracks tool usage and basic metadata.
 * Entity extraction is handled by EntityExtractor and passed in.
 */
export function extractConversationContext(
    history: LlmMessage[],
    previousResults?: ToolResult[],
    entities?: { type: string; value: string }[]
): IntentContext {
    const context: IntentContext = {
        lastToolsUsed: [],
        lastToolArgs: [],
        turnNumber: history.length,
        isFollowUp: history.length > 0,
    };

    // Track tool usage from results in reverse order (newest first)
    if (previousResults && previousResults.length > 0) {
        // Reverse to get most recent tools first
        for (let i = previousResults.length - 1; i >= 0; i--) {
            const result = previousResults[i];
            context.lastToolsUsed.push(result.name);
            context.lastToolArgs.push(result.arguments || {});
        }
    }

    // Populate context from provided entities generically
    const recentEntities: Record<string, string> = {};
    if (entities && entities.length > 0) {
        // Process entities to find most recent for each type
        // Assuming entities are ordered oldest to newest (from extractFromResults)
        for (const entity of entities) {
            recentEntities[entity.type] = entity.value;
        }
    }

    context.recentEntities = recentEntities;

    return context;
}

/**
 * Classify user intent based on question and conversation context.
 * This is a convenience function that creates an IntentClassifier instance.
 */
export function classifyIntent(
    question: string,
    context: IntentContext,
    registry: DomainRegistry
): IntentResult {
    const classifier = new IntentClassifier(registry);
    return classifier.classifyIntent(question, context);
}
