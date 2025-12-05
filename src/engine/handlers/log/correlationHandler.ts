/**
 * Log Correlation Handler
 *
 * Detects correlations between log events and other system events.
 * Extracted from CorrelationDetector class to follow handler-based architecture.
 */

import type { CorrelationHandler } from "../handlers.js";
import type {
  CorrelationEvent,
  Correlation,
  ToolResult,
  JsonObject,
} from "../../../types.js";
import { isValidTimestamp, normalizeTimestamp } from "../../timestampUtils.js";

const MODERATE_CORRELATION_THRESHOLD = 0.5;

/**
 * Log correlation handler that detects correlations involving log events
 */
export const logCorrelationHandler: CorrelationHandler = async (
  context,
  events,
): Promise<Correlation[]> => {
  const correlations: Correlation[] = [];

  // Filter for log events and events that could correlate with logs
  const logEvents = events.filter((e) => e.source === "log");
  const otherEvents = events.filter((e) => e.source !== "log");

  // Find correlations between log events and other events
  for (const logEvent of logEvents) {
    for (const otherEvent of otherEvents) {
      const correlation = calculateLogCorrelation(logEvent, otherEvent);
      if (
        correlation &&
        correlation.strength >= MODERATE_CORRELATION_THRESHOLD
      ) {
        correlations.push(correlation);
      }
    }
  }

  // Find correlations between log events themselves
  for (let i = 0; i < logEvents.length; i++) {
    for (let j = i + 1; j < logEvents.length; j++) {
      const correlation = calculateLogCorrelation(logEvents[i], logEvents[j]);
      if (
        correlation &&
        correlation.strength >= MODERATE_CORRELATION_THRESHOLD
      ) {
        correlations.push(correlation);
      }
    }
  }

  // Sort by strength (strongest first)
  correlations.sort((a, b) => b.strength - a.strength);

  return correlations;
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
 * Calculate correlation between two events, with special handling for log events
 */
function calculateLogCorrelation(
  event1: CorrelationEvent,
  event2: CorrelationEvent,
): Correlation | null {
  const time1 = new Date(event1.timestamp).getTime();
  const time2 = new Date(event2.timestamp).getTime();
  const timeDelta = Math.abs(time2 - time1);

  // Maximum time delta for correlation (5 minutes)
  const maxTimeDelta = 5 * 60 * 1000;

  if (timeDelta > maxTimeDelta) {
    return null;
  }

  const strength = calculateCorrelationStrength(
    event1,
    event2,
    timeDelta,
    maxTimeDelta,
  );

  if (strength < MODERATE_CORRELATION_THRESHOLD) {
    return null;
  }

  const description = generateCorrelationDescription(event1, event2, timeDelta);

  return {
    events: [event1, event2],
    strength,
    timeDeltaMs: timeDelta,
    description,
  };
}

/**
 * Calculate correlation strength between two events with log-specific logic
 */
function calculateCorrelationStrength(
  event1: CorrelationEvent,
  event2: CorrelationEvent,
  timeDelta: number,
  maxTimeDelta: number,
): number {
  // Base strength on temporal proximity (closer = stronger)
  const temporalStrength = 1 - timeDelta / maxTimeDelta;

  // Boost strength for certain event type combinations involving logs
  let typeBoost = 0;

  // Error burst + metric spike = strong correlation
  if (
    (event1.type === "error_burst" && event2.type === "metric_spike") ||
    (event1.type === "metric_spike" && event2.type === "error_burst")
  ) {
    typeBoost = 0.3;
  }

  // Error burst + severity change = strong correlation
  if (
    (event1.type === "error_burst" && event2.type === "severity_change") ||
    (event1.type === "severity_change" && event2.type === "error_burst")
  ) {
    typeBoost = 0.3;
  }

  // Critical error + incident creation = strong correlation
  if (
    (event1.type === "critical_error" && event2.type === "incident_created") ||
    (event1.type === "incident_created" && event2.type === "critical_error")
  ) {
    typeBoost = 0.35;
  }

  // Error burst + deploy = moderate correlation (deployment issues)
  if (
    (event1.type === "error_burst" && event2.type === "deploy") ||
    (event1.type === "deploy" && event2.type === "error_burst")
  ) {
    typeBoost = 0.25;
  }

  // Multiple error bursts = moderate correlation (cascading failures)
  if (event1.type === "error_burst" && event2.type === "error_burst") {
    typeBoost = 0.2;
  }

  // Critical error + metric drop = moderate correlation (service degradation)
  if (
    (event1.type === "critical_error" && event2.type === "metric_drop") ||
    (event1.type === "metric_drop" && event2.type === "critical_error")
  ) {
    typeBoost = 0.25;
  }

  // General log + incident/metric event = moderate correlation
  if (
    (event1.source === "log" && event2.source !== "log") ||
    (event1.source !== "log" && event2.source === "log")
  ) {
    typeBoost = Math.max(typeBoost, 0.15);
  }

  return Math.min(1.0, temporalStrength + typeBoost);
}

/**
 * Generate human-readable correlation description
 */
function generateCorrelationDescription(
  event1: CorrelationEvent,
  event2: CorrelationEvent,
  timeDelta: number,
): string {
  const deltaSeconds = Math.round(timeDelta / 1000);
  const deltaMinutes = Math.round(deltaSeconds / 60);

  const timeStr =
    deltaMinutes > 0
      ? `${deltaMinutes} minute(s)`
      : `${deltaSeconds} second(s)`;

  return `${event1.type} followed by ${event2.type} within ${timeStr}`;
}



/**
 * Helper: Get time window for grouping
 */
function getTimeWindow(timestamp: string, windowMs: number): string {
  const time = new Date(timestamp).getTime();
  const windowStart = Math.floor(time / windowMs) * windowMs;
  return new Date(windowStart).toISOString();
}
