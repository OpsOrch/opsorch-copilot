import { McpClient } from '../mcpClient.js';
import { Tool } from '../types.js';
import { DomainRegistry } from './domainRegistry.js';
import { withRetry } from './retryStrategy.js';

// Simple in-memory cache for services to avoid fetching on every request
let cachedServices: string[] = [];
let lastFetchTime = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Fetch available services using the service domain's query tool.
 * This helps heuristics match service names in questions.
 */
export async function getKnownServices(
    mcp: McpClient,
    tools: Tool[],
    domainRegistry: DomainRegistry,
): Promise<string[]> {
    // Return cached if valid
    if (cachedServices.length > 0 && Date.now() - lastFetchTime < CACHE_TTL_MS) {
        return cachedServices;
    }

    // Find service domain's tools
    const serviceDomain = domainRegistry.getDomainByName('service');
    if (!serviceDomain) {
        return [];
    }

    // Find a query tool for services from the domain's tool patterns
    const serviceQueryTool = tools.find(t => {
        const domain = domainRegistry.getDomainForTool(t.name);
        return domain?.name === 'service' && t.name.includes('query');
    });

    if (!serviceQueryTool) {
        return [];
    }

    try {
        const result = await withRetry(
            async () => {
                return await mcp.callTool({
                    name: serviceQueryTool.name,
                    arguments: {},
                });
            },
            { maxRetries: 2, baseDelayMs: 500 },
            'service-discovery'
        );

        if (result && result.result) {
            const payload = result.result as any;
            let services: string[] = [];

            if (Array.isArray(payload)) {
                services = payload.map((s: any) => typeof s === 'string' ? s : s.name).filter(Boolean);
            } else if (payload.services && Array.isArray(payload.services)) {
                services = payload.services.map((s: any) => typeof s === 'string' ? s : s.name).filter(Boolean);
            }

            if (services.length > 0) {
                cachedServices = services;
                lastFetchTime = Date.now();
                console.log(`[ServiceDiscovery] Discovered ${services.length} services using ${serviceQueryTool.name}`);
            }
            return services;
        }
    } catch (error) {
        console.warn(`[ServiceDiscovery] Failed to fetch services:`, error);
    }

    return [];
}

/**
 * Fuzzy match a service name from a question against known services.
 * Handles cases like "identity one" -> "svc-identity" or "payments" -> "payments-svc"
 */
export function matchServiceFromQuestion(question: string, knownServices: string[]): string | undefined {
    const normalized = question.toLowerCase();

    // 1. Exact match
    for (const service of knownServices) {
        if (normalized.includes(service.toLowerCase())) {
            return service;
        }
    }

    // 2. Word-based matching - extract significant words from question
    const genericTerms = ['service', 'svc', 'api', 'app', 'application', 'system', 'platform', 'backend', 'frontend',
        'one', 'two', 'three', 'four', 'five', 'the', 'a', 'an', 'about', 'tell', 'me', 'more'];
    const stopWords = ['the', 'a', 'an', 'last', 'past', 'this', 'that', 'what', 'which', 'when', 'where',
        'show', 'get', 'give', 'tell', 'me', 'more', 'about', 'for', 'in', 'on'];

    const questionWords = normalized
        .split(/\W+/)
        .filter(w => w.length > 2 && !stopWords.includes(w));

    // For each known service, calculate a match score
    const serviceScores: Array<{ service: string; score: number }> = [];

    for (const service of knownServices) {
        const serviceLower = service.toLowerCase();
        const serviceParts = serviceLower.split(/[-_]/);
        const significantParts = serviceParts.filter(p =>
            p.length > 2 && !genericTerms.includes(p)
        );

        let score = 0;
        let matchedSignificant = false;

        // Score based on how many significant question words match service parts
        for (const word of questionWords) {
            // Exact match with a service part
            if (significantParts.some(p => p === word)) {
                score += 10;
                matchedSignificant = true;
                continue;
            }

            // Stemming: "payments" -> "payment"
            const stem = word.endsWith('s') ? word.slice(0, -1) : word;
            if (significantParts.some(p => p === stem || stem === p.replace(/s$/, ''))) {
                score += 8;
                matchedSignificant = true;
                continue;
            }

            // Partial match: "identity" in "svc-identity"
            if (significantParts.some(p => p.includes(word) || word.includes(p))) {
                score += 5;
                matchedSignificant = true;
            }

            // Full service name contains the word
            if (serviceLower.includes(word)) {
                score += 3;
            }
        }

        // Bonus for matching generic parts if they appear in question
        const genericParts = serviceParts.filter(p => genericTerms.includes(p));
        for (const part of genericParts) {
            if (normalized.includes(part)) {
                score += 2;
            }
        }

        if (score > 0 && (matchedSignificant || significantParts.length === 0)) {
            serviceScores.push({ service, score });
        }
    }

    // Return the highest scoring service if score is high enough
    if (serviceScores.length > 0) {
        serviceScores.sort((a, b) => b.score - a.score);
        const best = serviceScores[0];

        // Require at least a score of 5 (one partial match) to return a result
        if (best.score >= 5) {
            console.log(`[ServiceDiscovery] Matched "${question}" to service "${best.service}" (score: ${best.score})`);
            return best.service;
        }
    }

    return undefined;
}

export function clearServiceCache() {
    cachedServices = [];
    lastFetchTime = 0;
}
