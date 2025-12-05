import { McpClient } from "../mcpClient.js";
import { Tool, HandlerContext } from "../types.js";
import {
  serviceDiscoveryRegistry,
  serviceMatchingRegistry,
} from "./capabilityRegistry.js";
import {
  discoverServices,
  clearServiceCache as clearHandlerCache,
} from "./handlers/service/discoveryHandler.js";

/**
 * Fetch available services using the service domain's query tool.
 * This helps heuristics match service names in questions.
 * Delegates to service discovery handler.
 */
export async function getKnownServices(
  mcp: McpClient,
  tools: Tool[],
): Promise<string[]> {
  // Create handler context
  const context: HandlerContext = {
    chatId: "service-discovery",
    turnNumber: 1,
    conversationHistory: [],
    toolResults: [],
    userQuestion: "",
  };

  // Try using service discovery handler first
  const handlerServices = await serviceDiscoveryRegistry.execute(context);
  if (handlerServices.length > 0) {
    return handlerServices;
  }

  // Fall back to direct service discovery with MCP
  return await discoverServices(mcp, tools);
}

/**
 * Fuzzy match a service name from a question against known services.
 * Handles cases like "identity one" -> "svc-identity" or "payments" -> "payments-svc"
 * Delegates to service matching handler.
 */
export async function matchServiceFromQuestion(
  question: string,
  knownServices: string[],
): Promise<string | undefined> {
  const context: HandlerContext = {
    chatId: "service-matching",
    turnNumber: 1,
    conversationHistory: [],
    toolResults: [],
    userQuestion: question,
  };

  const match = await serviceMatchingRegistry.execute(
    context,
    question,
    knownServices,
  );
  return match || undefined;
}

export function clearServiceCache() {
  // Clear cache in service discovery handler
  clearHandlerCache();
}
