/**
 * Service Discovery Handler
 *
 * Discovers available services from MCP tools.
 * Extracted from serviceDiscovery.ts to follow handler-based architecture.
 */

import type { ServiceDiscoveryHandler } from "../handlers.js";
import type { Tool, JsonObject, JsonValue } from "../../../types.js";
import { McpClient } from "../../../mcpClient.js";
import { withRetry } from "../../retryStrategy.js";

// Simple in-memory cache for services to avoid fetching on every request
let cachedServices: string[] = [];
let lastFetchTime = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Service discovery handler that fetches available services using MCP tools
 */
export const serviceDiscoveryHandler: ServiceDiscoveryHandler = async (
  _context,
): Promise<string[]> => {
  // Return cached if valid
  if (cachedServices.length > 0 && Date.now() - lastFetchTime < CACHE_TTL_MS) {
    return cachedServices;
  }

  // We need access to MCP client and tools, but the handler context doesn't provide them
  // For now, return empty array - this will be properly integrated when we refactor the engine classes
  console.warn(
    "[ServiceDiscoveryHandler] MCP client not available in handler context, returning cached services",
  );
  return cachedServices;
};

/**
 * Fetch available services using the service domain's query tool.
 * This is the core service discovery logic extracted from serviceDiscovery.ts
 */
export async function discoverServices(
  mcp: McpClient,
  tools: Tool[],
): Promise<string[]> {
  // Return cached if valid
  if (cachedServices.length > 0 && Date.now() - lastFetchTime < CACHE_TTL_MS) {
    return cachedServices;
  }

  // Find a query tool for services
  const serviceQueryTool = tools.find(
    (t) => t.name.includes("service") && t.name.includes("query"),
  );

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
      "service-discovery",
    );

    if (result && result.result) {
      const payload = result.result;
      let services: string[] = [];

      if (Array.isArray(payload)) {
        services = payload
          .map((s: JsonValue) =>
            typeof s === "string" ? s : (s as JsonObject)?.name ? String((s as JsonObject).name) : "",
          )
          .filter(Boolean);
      } else if (
        payload &&
        typeof payload === "object" &&
        (payload as JsonObject).services &&
        Array.isArray((payload as JsonObject).services)
      ) {
        services = ((payload as JsonObject).services as JsonValue[])
          .map((s: JsonValue) =>
            typeof s === "string" ? s : (s as JsonObject)?.name ? String((s as JsonObject).name) : "",
          )
          .filter(Boolean);
      }

      if (services.length > 0) {
        cachedServices = services;
        lastFetchTime = Date.now();
        console.log(
          `[ServiceDiscovery] Discovered ${services.length} services using ${serviceQueryTool.name}`,
        );
      }
      return services;
    }
  } catch (error) {
    console.warn(`[ServiceDiscovery] Failed to fetch services:`, error);
  }

  return [];
}

/**
 * Clear the service cache
 */
export function clearServiceCache(): void {
  cachedServices = [];
  lastFetchTime = 0;
}

/**
 * Get cached services without making network calls
 */
export function getCachedServices(): string[] {
  return [...cachedServices];
}

/**
 * Set cached services (useful for testing or manual population)
 */
export function setCachedServices(services: string[]): void {
  cachedServices = [...services];
  lastFetchTime = Date.now();
}
