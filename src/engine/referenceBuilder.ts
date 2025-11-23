import {
    CopilotReferences,
    LogReference,
    MetricReference,
    ToolResult,
} from '../types.js';
import { DomainRegistry } from './domainRegistry.js';
import { extractByPath, extractByPaths } from './pathExtractor.js';
import { normalizeMetricStep } from './metricUtils.js';

/**
 * Sanitize and validate references from external sources.
 * Keeps existing implementation for backward compatibility.
 */
export function sanitizeReferences(raw: any): CopilotReferences | undefined {
    if (!raw || typeof raw !== 'object') return undefined;

    const toStrings = (value: any) =>
        (Array.isArray(value) ? value.map((v) => (typeof v === 'string' ? v.trim() : '')).filter(Boolean) : []) as string[];

    const refs: CopilotReferences = {};

    const metrics: MetricReference[] = Array.isArray((raw as any).metrics)
        ? ((raw as any).metrics as any[])
            .map((m) => {
                if (!m || typeof m !== 'object') return undefined;
                const expression = typeof m.expression === 'string' ? m.expression.trim() : '';
                if (!expression) return undefined;
                const metric: MetricReference = { expression };
                if (typeof m.start === 'string' && m.start.trim()) metric.start = m.start.trim();
                if (typeof m.end === 'string' && m.end.trim()) metric.end = m.end.trim();
                const step = normalizeMetricStep(m.step);
                if (step !== undefined) metric.step = step;
                if (typeof m.scope === 'string' && m.scope.trim()) metric.scope = m.scope.trim();
                return metric;
            })
            .filter(Boolean) as MetricReference[]
        : [];

    const logs: LogReference[] = Array.isArray((raw as any).logs)
        ? ((raw as any).logs as any[])
            .map((l) => {
                if (!l || typeof l !== 'object') return undefined;
                const query = typeof l.query === 'string' ? l.query.trim() : '';
                if (!query) return undefined;
                const log: LogReference = { query };
                if (typeof l.start === 'string' && l.start.trim()) log.start = l.start.trim();
                if (typeof l.end === 'string' && l.end.trim()) log.end = l.end.trim();

                if (typeof l.service === 'string' && l.service.trim()) log.service = l.service.trim();

                if (typeof l.scope === 'string' && l.scope.trim()) log.scope = l.scope.trim();
                return log;
            })
            .filter(Boolean) as LogReference[]
        : [];

    const incidents = toStrings((raw as any).incidents);
    const services = toStrings((raw as any).services);
    const tickets = toStrings((raw as any).tickets);

    if (incidents.length) refs.incidents = incidents;
    if (services.length) refs.services = services;
    if (tickets.length) refs.tickets = tickets;
    if (metrics.length) refs.metrics = metrics;
    if (logs.length) refs.logs = logs;

    return Object.keys(refs).length ? refs : undefined;
}

/**
 * Build references from tool results using domain configurations.
 * This is the main domain-driven reference builder.
 * 
 * @param results - Array of tool results to extract references from
 * @param registry - Domain registry containing domain configurations
 * @returns CopilotReferences object with populated buckets
 */
export function buildReferences(
    results: ToolResult[],
    registry: DomainRegistry
): CopilotReferences | undefined {
    if (!results.length) return undefined;

    // Storage for entity references (simple ID arrays)
    const entityRefs = new Map<string, Set<string>>();

    // Storage for structured references (objects with multiple fields)
    const structuredBuckets = new Map<string, any[]>();

    for (const result of results) {
        // Get domain configuration for this tool
        const domain = registry.getDomainForTool(result.name);
        if (!domain || !domain.referenceExtraction) {
            // Skip tools without domain configuration or reference extraction
            continue;
        }

        const { referenceExtraction } = domain;


        // Preprocess result to extract data from MCP content blocks
        let processedResult: any = result.result;

        // Handle arrays that were already normalized from MCP content structures
        // The toolResultNormalizer converts {content: [...]} to just [...] when no other keys exist
        if (Array.isArray(processedResult)) {
            // Wrap the array in a data field so JSONPath extraction works
            processedResult = { data: processedResult };
        } else if (processedResult && typeof processedResult === 'object') {
            processedResult = { ...processedResult };
            if (processedResult.content && Array.isArray(processedResult.content)) {
                // Process MCP content blocks that haven't been normalized yet
                for (const item of processedResult.content) {
                    if (item.type === 'text' && item.text) {
                        try {
                            const parsed = JSON.parse(item.text);
                            // If parsed is an array, put it in 'data' if not exists
                            if (Array.isArray(parsed)) {
                                if (!processedResult.data) {
                                    processedResult.data = parsed;
                                } else if (Array.isArray(processedResult.data)) {
                                    processedResult.data.push(...parsed);
                                }
                            }
                            // If parsed is an object, merge it
                            else if (typeof parsed === 'object' && parsed !== null) {
                                Object.assign(processedResult, parsed);
                            }
                        } catch (e) {
                            // Ignore parsing errors
                        }
                    }
                }
            }
        }

        const toolResult = { result: processedResult, arguments: result.arguments || {} };

        // Extract simple entity references from arguments
        if (referenceExtraction.argumentPaths) {
            for (const [entityType, paths] of Object.entries(referenceExtraction.argumentPaths)) {
                const ids = extractByPaths(toolResult, paths);
                const collectionKey = registry.getCollectionKey(entityType);

                if (!entityRefs.has(collectionKey)) {
                    entityRefs.set(collectionKey, new Set<string>());
                }

                for (const id of ids) {
                    if (typeof id === 'string' && id.trim()) {
                        entityRefs.get(collectionKey)!.add(id.trim());
                    }
                }
            }
        }

        // Extract simple entity references from results
        if (referenceExtraction.resultPaths) {
            for (const [entityType, config] of Object.entries(referenceExtraction.resultPaths)) {
                const collectionKey = registry.getCollectionKey(entityType);

                if (!entityRefs.has(collectionKey)) {
                    entityRefs.set(collectionKey, new Set<string>());
                }

                // Extract from idPaths
                if (config.idPaths) {
                    const ids = extractByPaths(toolResult, config.idPaths);
                    for (const id of ids) {
                        if (typeof id === 'string' && id.trim()) {
                            entityRefs.get(collectionKey)!.add(id.trim());
                        }
                    }
                }

                // Extract from arrayPaths (arrays of objects)
                if (config.arrayPaths) {
                    for (const arrayPath of config.arrayPaths) {
                        const items = extractByPath(toolResult, arrayPath);
                        for (const item of items) {
                            if (item && typeof item === 'object' && config.idPaths) {
                                // Extract ID from each item
                                const itemIds = extractByPaths(item, config.idPaths);
                                for (const id of itemIds) {
                                    if (typeof id === 'string' && id.trim()) {
                                        entityRefs.get(collectionKey)!.add(id.trim());
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        // Extract structured references
        if (referenceExtraction.structuredReferences) {
            for (const structuredRef of referenceExtraction.structuredReferences) {
                const { bucket, requiredFields, optionalFields } = structuredRef;

                // Extract required fields
                const refObj: any = {};
                let hasAllRequired = true;

                for (const field of requiredFields) {
                    const values = extractByPath(toolResult, field.path);
                    if (values.length > 0) {
                        refObj[field.name] = values[0];
                    } else {
                        hasAllRequired = false;
                        break;
                    }
                }

                // Skip if missing required fields
                if (!hasAllRequired) {
                    continue;
                }

                // Extract optional fields
                if (optionalFields) {
                    for (const field of optionalFields) {
                        const values = extractByPath(toolResult, field.path);
                        if (values.length > 0) {
                            refObj[field.name] = values[0];
                        }
                    }
                }

                // Normalize step for metrics
                if (bucket === 'metrics' && 'step' in refObj) {
                    const normalizedStep = normalizeMetricStep(refObj.step);
                    if (normalizedStep !== undefined) {
                        refObj.step = normalizedStep;
                    } else {
                        delete refObj.step;
                    }
                }

                // Add to bucket
                if (!structuredBuckets.has(bucket)) {
                    structuredBuckets.set(bucket, []);
                }
                structuredBuckets.get(bucket)!.push(refObj);
            }
        }
    }

    // Build final references object
    const refs: CopilotReferences = {};

    // Add simple entity references
    for (const [bucket, ids] of entityRefs.entries()) {
        if (ids.size > 0) {
            (refs as any)[bucket] = Array.from(ids);
        }
    }

    // Add structured references
    for (const [bucket, items] of structuredBuckets.entries()) {
        if (items.length > 0) {
            (refs as any)[bucket] = items;
        }
    }

    return Object.keys(refs).length > 0 ? refs : undefined;
}
