import {
    CopilotReferences,
    ToolResult,
} from '../types.js';
import { DomainRegistry } from './domainRegistry.js';
import { extractByPath, extractByPaths } from './pathExtractor.js';
import { normalizeMetricStep } from './metricUtils.js';

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

        // GLOBAL: Extract service from scope if present (works for any tool)
        // Many tools (query-incidents, query-metrics, query-logs) use a 'scope' argument
        const scope = toolResult.arguments.scope as any;
        if (scope && typeof scope === 'object' && scope.service) {
            const collectionKey = 'services';
            if (!entityRefs.has(collectionKey)) {
                entityRefs.set(collectionKey, new Set<string>());
            }
            if (typeof scope.service === 'string' && scope.service.trim()) {
                entityRefs.get(collectionKey)!.add(scope.service.trim());
            }
        }

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
                                // idPaths might be like ['$.result.id'] but we need to extract from the item directly
                                // So convert '$.result.id' to '$.id' or  just try both the full path and a simple '$.id'
                                const itemIds = extractByPaths({ item }, config.idPaths.map(p => p.replace(/^\$\.result\./, '$.item.')));
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
