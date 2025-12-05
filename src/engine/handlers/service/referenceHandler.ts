/**
 * Service Reference Handler
 *
 * Resolves references like "that service", "this microservice", etc.
 *
 * MCP serviceSchema field used:
 * - name: string
 */

import type { ReferenceHandler } from "../handlers.js";
import type { JsonObject } from "../../../types.js";

export const serviceReferenceHandler: ReferenceHandler = async (
  context,
  referenceText,
): Promise<string | null> => {
  let serviceEntities: Array<{
    value: string;
    timestamp: number;
    prominence?: number;
  }> = [];

  for (const turn of context.conversationHistory) {
    if (turn.toolResults) {
      for (const result of turn.toolResults) {
        // MCP tool names: query-services, get-service
        if (result.name === "query-services" || result.name === "get-service") {
          const content = result.result;
          if (content) {
            // query-services returns z.array(serviceSchema)
            let servicesArray: JsonObject[] = [];
            if (Array.isArray(content)) {
              servicesArray = content as JsonObject[];
            } else if (typeof content === "object" && content !== null) {
              // get-service returns serviceSchema directly
              servicesArray = [content as JsonObject];
            }

            for (const service of servicesArray) {
              // MCP schema: name: z.string()
              const name = service.name;
              if (name && typeof name === "string") {
                serviceEntities.push({
                  value: name,
                  timestamp: turn.timestamp || Date.now(),
                  prominence: 1.0,
                });
              }
            }
          }
        }
      }
    }
  }

  if (serviceEntities.length === 0) return null;

  // Refine using reference text
  if (referenceText) {
    const lowerRef = referenceText.toLowerCase();

    // Check for domain mismatch
    if (
      (lowerRef.includes("incident") ||
        lowerRef.includes("issue") ||
        lowerRef.includes("log") ||
        lowerRef.includes("metric") ||
        lowerRef.includes("alert") ||
        lowerRef.includes("ticket")) &&
      !lowerRef.includes("service")
    ) {
      return null;
    }

    // Prioritize exact matches if reference text contains a service name
    const matchingEntities = serviceEntities.filter((entity) =>
      lowerRef.includes(entity.value.toLowerCase()),
    );

    if (matchingEntities.length > 0) {
      serviceEntities = matchingEntities;
    }
  }

  serviceEntities.sort((a, b) => {
    const prominenceDiff = (b.prominence || 0) - (a.prominence || 0);
    if (prominenceDiff !== 0) return prominenceDiff;
    return b.timestamp - a.timestamp;
  });

  return serviceEntities[0].value;
};
