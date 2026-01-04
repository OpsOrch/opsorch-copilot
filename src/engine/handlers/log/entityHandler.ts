/**
 * Log Entity Handler
 *
 * Field names match MCP logEntrySchema:
 * - timestamp: datetime
 * - message: string
 * - severity?: string
 * - service?: string
 * - labels?: Record<string, string>
 */

import type { EntityHandler } from "../handlers.js";
import type { Entity, JsonObject } from "../../../types.js";
import { HandlerUtils } from "../utils.js";

export const logEntityHandler: EntityHandler = async (
  _context,
  toolResult,
): Promise<Entity[]> => {
  const entities: Entity[] = [];

  if (!toolResult.result || typeof toolResult.result !== "object") {
    return entities;
  }

  // query-logs returns LogEntries { entries: LogEntry[], url?: string }
  const logEntries = toolResult.result as { entries?: JsonObject[]; url?: string };
  if (!logEntries.entries || !Array.isArray(logEntries.entries)) {
    return entities;
  }

  const logs = logEntries.entries;

  for (const log of logs) {
    // Extract service (MCP schema: service: z.string().optional())
    const service = log.service;
    if (service && typeof service === "string" && HandlerUtils.validateEntityId(service)) {
      entities.push({
        type: "service",
        value: service,
        extractedAt: Date.now(),
        source: toolResult.name,
        prominence: 0.8,
      });
    }

    // Also extract service names from message content
    const message = log.message;
    if (typeof message === "string") {
      const serviceNames = HandlerUtils.extractServiceNames(message);
      for (const serviceName of serviceNames) {
        entities.push({
          type: "service",
          value: serviceName,
          extractedAt: Date.now(),
          source: toolResult.name,
          prominence: 0.7,
        });
      }
    }

    // Extract timestamp (MCP schema: timestamp: z.string().datetime())
    const timestamp = log.timestamp;
    if (timestamp && typeof timestamp === "string" && HandlerUtils.parseTimestamp(timestamp)) {
      entities.push({
        type: "timestamp",
        value: timestamp,
        extractedAt: Date.now(),
        source: toolResult.name,
        prominence: 0.3,
      });
    }
  }

  return entities;
};
