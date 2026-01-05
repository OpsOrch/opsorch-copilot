/**
 * Service Reference Handler
 *
 * Resolves references like "that service", "this microservice", etc.
 *
 * MCP serviceSchema field used:
 * - name: string
 */

import type { ReferenceHandler } from "../handlers.js";

export const serviceReferenceHandler: ReferenceHandler = async (
  context,
  referenceText,
): Promise<string | null> => {
  let serviceEntities: Array<{
    value: string;
    timestamp: number;
    prominence?: number;
  }> = [];

  // Extract services from conversation turn entities
  for (const turn of context.conversationHistory) {
    if (turn.entities) {
      for (const entity of turn.entities) {
        if (entity.type === "service") {
          serviceEntities.push({
            value: entity.value,
            timestamp: entity.extractedAt || turn.timestamp || Date.now(),
            prominence: entity.prominence || 1.0,
          });
        }
      }
    }
  }

  // Also check current turn's tool results for immediate context
  for (const result of context.toolResults) {
    if (result.name === "query-services" || result.name === "get-service") {
      const content = result.result;
      if (content) {
        let servicesArray: Array<Record<string, unknown>> = [];
        if (Array.isArray(content)) {
          servicesArray = content as Array<Record<string, unknown>>;
        } else if (typeof content === "object" && content !== null) {
          servicesArray = [content as Record<string, unknown>];
        }

        for (const service of servicesArray) {
          const name = service.name;
          if (name && typeof name === "string") {
            serviceEntities.push({
              value: name,
              timestamp: Date.now(),
              prominence: 1.0,
            });
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
