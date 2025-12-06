/**
 * Log Correlation Handler
 *
 * Detects correlations between log events and other system events.
 * Uses shared correlation utilities for consistent logic across all handlers.
 */

import type { CorrelationHandler } from "../handlers.js";
import type {
  CorrelationEvent,
  Correlation,
  ToolResult,
  JsonObject,
} from "../../../types.js";
import { isValidTimestamp, normalizeTimestamp } from "../../timestampUtils.js";
import {
  findCorrelations,
  findIntraCorrelations,
  sortByStrength,
} from "../correlationUtils.js";

/**
 * Log correlation handler that detects correlations involving log events
 */
export const logCorrelationHandler: CorrelationHandler = async (
  _context,
  events,
): Promise<Correlation[]> => {
  // Filter for log events and events that could correlate with logs
  const logEvents = events.filter((e) => e.source === "log");
  const otherEvents = events.filter((e) => e.source !== "log");

  // Find correlations between log events and other events
  const crossCorrelations = findCorrelations(logEvents, otherEvents);

  // Find correlations between log events themselves
  const intraCorrelations = findIntraCorrelations(logEvents);

  return sortByStrength([...crossCorrelations, ...intraCorrelations]);
};

/**
 * Extract log events from tool results
 *
 * MCP logEntrySchema: { timestamp, message, severity?, service?, labels?, fields?, metadata? }
 */
export function extractLogEvents(result: ToolResult): CorrelationEvent[] {
  const events: CorrelationEvent[] = [];
  const payload = result.result;

  if (!payload || typeof payload !== "object") {
    return events;
  }

  // query-logs returns z.array(logEntrySchema) directly
  if (!Array.isArray(payload)) {
    return events;
  }

  const entries = payload as JsonObject[];

  // Group errors by time window to detect bursts
  const errorsByWindow = new Map<string, number>();

  for (const logEntry of entries) {
    if (typeof logEntry !== "object" || logEntry === null || Array.isArray(logEntry)) {
      continue;
    }

    // MCP schema: timestamp: z.string().datetime()
    const timestamp = logEntry.timestamp;

    if (typeof timestamp === "string" && isValidTimestamp(timestamp)) {
      const normalizedTime = normalizeTimestamp(timestamp);
      const timeWindow = getTimeWindow(normalizedTime, 60000); // 1-minute windows

      // Count errors in this window
      const count = errorsByWindow.get(timeWindow) || 0;
      errorsByWindow.set(timeWindow, count + 1);
    }
  }

  // Create events for error bursts (more than 5 errors in a minute)
  for (const [timeWindow, count] of errorsByWindow.entries()) {
    if (count >= 5) {
      events.push({
        timestamp: timeWindow,
        source: "log",
        type: "error_burst",
        value: count,
        metadata: { errorCount: count },
      });
    }
  }

  // Also create events for individual high-severity log entries
  for (const logEntry of entries) {
    if (typeof logEntry !== "object" || logEntry === null || Array.isArray(logEntry)) {
      continue;
    }

    // MCP schema: timestamp: z.string().datetime()
    const timestamp = logEntry.timestamp;
    // MCP schema: severity: z.string().optional()
    const severity = logEntry.severity;
    // MCP schema: message: z.string()
    const message = logEntry.message;

    if (typeof timestamp === "string" && isValidTimestamp(timestamp)) {
      // Create events for critical/fatal logs
      if (
        typeof severity === "string" &&
        (severity.toLowerCase() === "critical" ||
          severity.toLowerCase() === "fatal")
      ) {
        const metadata: JsonObject = { level: severity };
        if (typeof message === "string") {
          metadata.message = message.substring(0, 100);
        }
        events.push({
          timestamp: normalizeTimestamp(timestamp),
          source: "log",
          type: "critical_error",
          metadata,
        });
      }
    }
  }

  return events;
}

/**
 * Helper: Get time window for grouping
 */
function getTimeWindow(timestamp: string, windowMs: number): string {
  const time = new Date(timestamp).getTime();
  const windowStart = Math.floor(time / windowMs) * windowMs;
  return new Date(windowStart).toISOString();
}

