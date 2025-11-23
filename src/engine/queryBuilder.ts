import { IntentContext, QueryBuildingConfig, QueryScope } from '../types.js';
import { DomainRegistry } from './domainRegistry.js';
import { parseTimeExpression } from './timestampUtils.js';

/**
 * Generic domain-based query builder that constructs queries using domain configurations.
 */
export class QueryBuilder {
    constructor(private registry: DomainRegistry) { }

    /**
     * Build a query for a specific domain using its configuration.
     * This is a generic method that works for any domain.
     */
    buildQuery(
        domainName: string,
        question: string,
        context: IntentContext
    ): string | Record<string, any> {
        const domain = this.registry.getDomainByName(domainName);
        if (!domain?.queryBuilding) {
            return this.getDefaultForDomain(domainName);
        }

        const config = domain.queryBuilding;
        const normalized = question.toLowerCase();

        // Handle log-style queries (pattern extraction)
        if (config.errorPatterns || config.keywordEnhancement) {
            return this.buildPatternQuery(config, question, normalized, context);
        }

        // Handle metric-style queries (template matching)
        if (config.expressionTemplates || config.contextualMetrics) {
            return this.buildTemplateQuery(config, normalized);
        }

        // Handle incident-style queries (keyword/pattern extraction to object)
        if (config.statusKeywords || config.severityPatterns) {
            return this.buildStructuredQuery(config, question, normalized);
        }

        // Fallback to default
        return this.getDefaultForDomain(domainName);
    }

    /**
     * Build a pattern-based query (for logs, etc.)
     */
    private buildPatternQuery(
        config: QueryBuildingConfig,
        question: string,
        normalized: string,
        context: IntentContext
    ): string {
        const patterns: string[] = [];

        // Extract patterns from domain config
        if (config.errorPatterns) {
            for (const pattern of config.errorPatterns) {
                const regex = new RegExp(pattern, 'gi');
                const matches = question.match(regex);
                if (matches) {
                    // Normalize matches (remove plurals, normalize xx patterns)
                    const normalizedMatches = matches.map(m =>
                        m.replace(/s$/i, '').replace('xx', 'x').toLowerCase()
                    );
                    patterns.push(...new Set(normalizedMatches));
                }
            }
        }

        // Extract priority terms from follow-up config
        const domain = this.registry.getDomainByName('log');
        if (domain?.followUp?.keywordExtraction?.priorityTerms) {
            for (const term of domain.followUp.keywordExtraction.priorityTerms) {
                const regex = new RegExp(`\\b${term}\\b`, 'i');
                if (regex.test(normalized)) {
                    patterns.push(term);
                }
            }
        }

        // Use incident context if available and no patterns found
        if (context.recentEntities?.['incident'] && patterns.length === 0) {
            patterns.push('error', 'exception');
        }

        // Return default query if nothing found
        if (patterns.length === 0) {
            return config.defaultQuery || 'error OR exception';
        }

        return patterns.join(' OR ');
    }

    /**
     * Build a template-based query (for metrics, etc.)
     */
    private buildTemplateQuery(
        config: QueryBuildingConfig,
        normalized: string
    ): string {
        // Check expression templates first
        if (config.expressionTemplates) {
            for (const [keyword, expression] of Object.entries(config.expressionTemplates)) {
                const regex = new RegExp(`\\b${keyword}\\b`, 'i');
                if (regex.test(normalized)) {
                    return expression;
                }
            }
        }

        // Check contextual metrics
        if (config.contextualMetrics) {
            for (const [keyword, metrics] of Object.entries(config.contextualMetrics)) {
                const regex = new RegExp(`\\b${keyword}\\b`, 'i');
                if (regex.test(normalized)) {
                    // Return first matching metric
                    return metrics[0];
                }
            }
        }

        // Return default expression
        return config.defaultExpression || 'latency_p95';
    }

    /**
     * Build a structured query (for incidents, etc.)
     */
    private buildStructuredQuery(
        config: QueryBuildingConfig,
        question: string,
        normalized: string
    ): Record<string, any> {
        const result: Record<string, any> = {};

        // Extract status from keywords
        if (config.statusKeywords) {
            for (const [keyword, status] of Object.entries(config.statusKeywords)) {
                const regex = new RegExp(`\\b${keyword}\\b`, 'i');
                if (regex.test(normalized)) {
                    result.status = status;
                    break;
                }
            }
        }

        // Extract severity from patterns
        if (config.severityPatterns) {
            for (const pattern of config.severityPatterns) {
                const regex = new RegExp(pattern, 'i');
                const match = question.match(regex);
                if (match) {
                    result.severity = match[1] || match[0];
                    break;
                }
            }
        }

        return result;
    }

    /**
     * Get default value for a domain when no config is available
     */
    private getDefaultForDomain(domainName: string): string | Record<string, any> {
        switch (domainName) {
            case 'log':
                return 'error OR exception';
            case 'metric':
                return 'latency_p95';
            case 'incident':
                return {};
            default:
                return '';
        }
    }
}

/**
 * Get default time window (last 1 hour by default).
 */
export function getDefaultTimeWindow(context: IntentContext): { start: string; end: string } {
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
 * 
 * Re-exported from timestampUtils for backward compatibility
 */
export { parseTimeExpression as parseTimeWindow } from './timestampUtils.js';
