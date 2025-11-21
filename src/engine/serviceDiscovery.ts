import { McpClient } from '../mcpClient.js';
import { Tool, ToolResult } from '../types.js';
import { runToolCalls } from './toolRunner.js';

// Simple in-memory cache for services to avoid fetching on every request
let cachedServices: string[] = [];
let lastFetchTime = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Fetch available services if the tool exists.
 * This helps heuristics match service names in questions.
 */
export async function getKnownServices(
    mcp: McpClient,
    tools: Tool[]
): Promise<string[]> {
    // Return cached if valid
    if (cachedServices.length > 0 && Date.now() - lastFetchTime < CACHE_TTL_MS) {
        return cachedServices;
    }

    const hasServiceTool = tools.some((t) => t.name === 'query-services');
    if (!hasServiceTool) {
        return [];
    }

    try {
        // We use runToolCalls directly to avoid circular dependency with CopilotEngine's cache
        // or we can just use mcp.callTool directly since we know the tool name
        const result = await mcp.callTool({
            name: 'query-services',
            arguments: {},
        });

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
                console.log(`[ServiceDiscovery] Discovered ${services.length} services`);
            }
            return services;
        }
    } catch (error) {
        console.warn(`[ServiceDiscovery] Failed to fetch services:`, error);
    }

    return [];
}
