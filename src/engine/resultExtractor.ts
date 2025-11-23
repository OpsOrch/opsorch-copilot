import { ToolResult } from '../types.js';
import { DomainRegistry } from './domainRegistry.js';

/**
 * Shared utility for extracting data from tool results.
 * Used by both QuestionEngine and FollowUpEngine to avoid code duplication.
 */
export class ResultExtractor {
    constructor(private registry: DomainRegistry) { }

    /**
     * Extract all unique services from tool results using domain configurations
     */
    /**
     * Extract all unique services from tool results using domain configurations
     */
    extractServicesFromHistory(previousResults?: ToolResult[]): string[] {
        const services: string[] = [];
        if (!previousResults) return services;

        for (const result of previousResults) {
            const payload = result.result;
            if (!payload || typeof payload !== 'object') continue;

            // Get domain for this tool
            const domain = this.registry.getDomainForTool(result.name);

            // Extract services using domain's scope configuration
            if (domain?.scope?.serviceFields) {
                const extracted = this.extractValues(payload, domain.scope.serviceFields);
                for (const svc of extracted) {
                    if (!services.includes(svc)) {
                        services.push(svc);
                    }
                }
            }

            // Also check generic scope field
            const scope = (payload as any).scope;
            if (scope?.service && typeof scope.service === 'string' && !services.includes(scope.service)) {
                services.push(scope.service);
            }

            // Check top-level service field as fallback
            if ((payload as any).service && typeof (payload as any).service === 'string') {
                const svc = (payload as any).service;
                if (!services.includes(svc)) {
                    services.push(svc);
                }
            }
        }

        return services;
    }

    /**
     * Extract the most recent service from tool results using domain configurations
     */
    extractMostRecentService(previousResults?: ToolResult[]): string | undefined {
        if (!previousResults) return undefined;

        // Process results in reverse order (most recent first)
        for (let i = previousResults.length - 1; i >= 0; i--) {
            const result = previousResults[i];
            const payload = result.result;
            if (!payload || typeof payload !== 'object') continue;

            // Try to extract using domain configuration
            const domain = this.registry.getDomainForTool(result.name);
            if (domain?.scope?.serviceFields) {
                const services = this.extractValues(payload, domain.scope.serviceFields);
                if (services.length > 0) return services[0];
            }

            // Fallback: check generic scope field
            const scope = (payload as any).scope;
            if (scope?.service && typeof scope.service === 'string') {
                return scope.service;
            }

            // Fallback: check top-level service field
            if ((payload as any).service && typeof (payload as any).service === 'string') {
                return (payload as any).service;
            }
        }

        return undefined;
    }

    /**
     * Extract string values from payload using a list of field names or paths
     */
    extractValues(payload: any, fields: string[]): string[] {
        const values: string[] = [];
        // Convert paths to leaf names (e.g. "$.result.service" -> "service")
        const searchFields = fields.map(f => {
            const parts = f.split('.');
            return parts[parts.length - 1];
        });

        const visit = (obj: any) => {
            if (!obj || typeof obj !== 'object') return;

            for (const field of searchFields) {
                if (field in obj && typeof obj[field] === 'string' && obj[field].trim()) {
                    values.push(obj[field].trim());
                }
            }

            for (const value of Object.values(obj)) {
                if (typeof value === 'object') {
                    visit(value);
                }
                if (Array.isArray(value)) {
                    for (const item of value) {
                        visit(item);
                    }
                }
            }
        };
        visit(payload);
        return values;
    }

    /**
     * Extract a single string value from payload (backward compatibility)
     */
    extractValue(payload: any, fields: string[]): string | undefined {
        const values = this.extractValues(payload, fields);
        return values.length > 0 ? values[0] : undefined;
    }

    /**
     * Extract an ISO date string from payload using a list of field names
     */
    extractIsoDate(payload: any, fields: string[], afterDate?: string): string | undefined {
        const visit = (obj: any): string | undefined => {
            if (!obj || typeof obj !== 'object') return undefined;

            for (const field of fields) {
                if (field in obj && typeof obj[field] === 'string') {
                    const val = obj[field];
                    if (this.isIsoDateString(val)) {
                        if (!afterDate || val > afterDate) {
                            return val;
                        }
                    }
                }
            }

            for (const value of Object.values(obj)) {
                if (typeof value === 'object') {
                    const found = visit(value);
                    if (found) return found;
                }
                if (Array.isArray(value)) {
                    for (const item of value) {
                        const found = visit(item);
                        if (found) return found;
                    }
                }
            }
            return undefined;
        };
        return visit(payload);
    }

    /**
     * Check if a string is an ISO date string
     */
    isIsoDateString(str: string): boolean {
        return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(str);
    }
}

