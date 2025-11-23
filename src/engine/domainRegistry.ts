import type { DomainConfig, ToolMatcher } from '../types.js';

/**
 * Compiled tool matcher with regex and metadata
 */
interface CompiledMatcher {
    domain: DomainConfig;
    matcher: ToolMatcher;
    regexp: RegExp;
}

/**
 * Reference pattern with compiled regex
 */
export interface ReferencePattern {
    pattern: RegExp;
    entityType: string;
    domain: string;
    priority: number;
}

/**
 * Simple pluralizer for entity types
 */
function pluralize(word: string): string {
    // Handle common irregular plurals
    const irregulars: Record<string, string> = {
        'query': 'queries',
        'log_query': 'logQueries',
    };

    if (irregulars[word]) {
        return irregulars[word];
    }

    // Simple rules
    if (word.endsWith('s') || word.endsWith('x') || word.endsWith('ch') || word.endsWith('sh')) {
        return word + 'es';
    }
    if (word.endsWith('y') && !/[aeiou]y$/.test(word)) {
        return word.slice(0, -1) + 'ies';
    }
    return word + 's';
}

/**
 * Central registry for domain configurations.
 * Provides lookup methods for tool → domain and entity type → domain mappings.
 */
export class DomainRegistry {
    private domains = new Map<string, DomainConfig>();
    private toolCache = new Map<string, DomainConfig | null>();
    private matchers: CompiledMatcher[] = [];

    /**
     * Register a domain configuration
     * @throws Error if tool matcher conflicts with existing matcher
     */
    register(config: DomainConfig): void {
        // Validate domain name is unique
        if (this.domains.has(config.name)) {
            throw new Error(`Domain '${config.name}' is already registered`);
        }

        // Check for tool matcher conflicts
        for (const matcher of config.toolPatterns) {
            const conflict = this.matchers.find(
                (entry) => entry.matcher.match === matcher.match
            );
            if (conflict && !matcher.allowMultiple && !conflict.matcher.allowMultiple) {
                throw new Error(
                    `Tool matcher conflict: '${matcher.match}' is already claimed by domain '${conflict.domain.name}'`
                );
            }
        }

        // Register domain
        this.domains.set(config.name, config);

        // Compile and register matchers
        for (const matcher of config.toolPatterns) {
            const regexp = this.compileMatcher(matcher);
            this.matchers.push({ domain: config, matcher, regexp });
        }

        // Sort matchers by priority (highest first)
        this.matchers.sort((a, b) => (b.matcher.priority ?? 0) - (a.matcher.priority ?? 0));

        // Clear cache since we have new matchers
        this.toolCache.clear();
    }

    /**
     * Get domain configuration for a tool name
     * Uses cached lookups for performance
     */
    getDomainForTool(toolName: string): DomainConfig | undefined {
        // Check cache first
        if (this.toolCache.has(toolName)) {
            return this.toolCache.get(toolName) || undefined;
        }

        // Find first matching domain (matchers are sorted by priority)
        for (const entry of this.matchers) {
            if (entry.regexp.test(toolName)) {
                this.toolCache.set(toolName, entry.domain);
                return entry.domain;
            }
        }

        // Cache negative result
        this.toolCache.set(toolName, null);
        return undefined;
    }

    /**
     * Get domain configuration by name
     */
    getDomainByName(name: string): DomainConfig | undefined {
        return this.domains.get(name);
    }

    /**
     * Get all registered domains
     */
    getAllDomains(): DomainConfig[] {
        return Array.from(this.domains.values());
    }

    /**
     * Get all entity types across all domains
     */
    getEntityTypes(): string[] {
        const types = new Set<string>();
        for (const domain of this.domains.values()) {
            for (const entity of domain.entities) {
                types.add(entity.type);
            }
        }
        return Array.from(types);
    }

    /**
     * Get all reference patterns across all domains
     * Returns patterns sorted by priority (highest first)
     */
    getReferencePatterns(): ReferencePattern[] {
        const patterns: ReferencePattern[] = [];
        for (const domain of this.domains.values()) {
            for (const ref of domain.references) {
                patterns.push({
                    pattern: new RegExp(ref.pattern, 'i'),
                    entityType: ref.entityType,
                    domain: domain.name,
                    priority: ref.priority || 0,
                });
            }
        }
        // Sort by priority (highest first)
        patterns.sort((a, b) => b.priority - a.priority);
        return patterns;
    }

    /**
     * Get the collection key for an entity type
     * Uses domain-specific override or pluralized entity type
     */
    getCollectionKey(entityType: string): string {
        for (const domain of this.domains.values()) {
            for (const entity of domain.entities) {
                if (entity.type === entityType) {
                    return entity.collectionKey || pluralize(entityType);
                }
            }
        }
        // Fallback to pluralized entity type
        return pluralize(entityType);
    }

    /**
     * Get entity configuration for a specific entity type
     */
    getEntityConfig(entityType: string): { domain: DomainConfig; config: any } | undefined {
        for (const domain of this.domains.values()) {
            for (const entity of domain.entities) {
                if (entity.type === entityType) {
                    return { domain, config: entity };
                }
            }
        }
        return undefined;
    }

    /**
     * Clear all registered domains and caches
     */
    clear(): void {
        this.domains.clear();
        this.toolCache.clear();
        this.matchers = [];
    }

    /**
     * Get statistics about registered domains
     */
    getStats(): {
        domainCount: number;
        toolPatternCount: number;
        entityTypeCount: number;
        referencePatternCount: number;
    } {
        return {
            domainCount: this.domains.size,
            toolPatternCount: this.matchers.length,
            entityTypeCount: this.getEntityTypes().length,
            referencePatternCount: this.getReferencePatterns().length,
        };
    }

    /**
     * Compile a tool matcher into a RegExp
     */
    private compileMatcher(matcher: ToolMatcher): RegExp {
        switch (matcher.type) {
            case 'exact':
                // Exact match: ^pattern$
                return new RegExp(`^${this.escapeRegex(matcher.match)}$`);

            case 'glob':
                // Convert glob to regex: * → .*, ? → .
                const globPattern = matcher.match
                    .split('*')
                    .map((part) => this.escapeRegex(part))
                    .join('.*')
                    .split('?')
                    .map((part) => part)
                    .join('.');
                return new RegExp(`^${globPattern}$`);

            case 'regex':
                // Use pattern as-is
                return new RegExp(matcher.match);

            default:
                throw new Error(`Unknown matcher type: ${(matcher as any).type}`);
        }
    }

    /**
     * Escape special regex characters
     */
    private escapeRegex(str: string): string {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
}

/**
 * Global singleton instance
 */
export const domainRegistry = new DomainRegistry();
