import {
  ToolResult,
  CorrelationEvent,
  Correlation,
} from "../types.js";
import { getTimestampMs } from "./timestampUtils.js";
import { extractMetricEvents } from "./handlers/metric/correlationHandler.js";
import { extractLogEvents } from "./handlers/log/correlationHandler.js";
import { extractIncidentEvents } from "./handlers/incident/correlationHandler.js";

const MAX_TIME_DELTA_MS = 5 * 60 * 1000; // 5 minutes
const MODERATE_CORRELATION_THRESHOLD = 0.5;

/**
 * Determine capability type from tool name
 */
function getCapabilityType(toolName: string): string | null {
  if (toolName.includes("incident")) return "incident";
  if (toolName.includes("metric")) return "metric";
  if (toolName.includes("log")) return "log";
  return null;
}

/**
 * CorrelationDetector identifies temporal correlations between metrics, logs, and incidents
 * to help identify root causes and related issues.
 */
export class CorrelationDetector {
  /**
   * Extract events from tool results using capability-specific handlers
   */
  extractEvents(results: ToolResult[]): CorrelationEvent[] {
    const events: CorrelationEvent[] = [];

    for (const result of results) {
      // Get capability type for this tool
      const capabilityType = getCapabilityType(result.name);

      if (!capabilityType) continue;

      try {
        // Route to appropriate extractor based on capability type
        if (capabilityType === "metric") {
          events.push(...extractMetricEvents(result));
        } else if (capabilityType === "log") {
          events.push(...extractLogEvents(result));
        } else if (capabilityType === "incident") {
          events.push(...extractIncidentEvents(result));
        }
      } catch (error) {
        console.error(
          `Error extracting ${capabilityType} events from ${result.name}:`,
          error,
        );
        // Continue with other results
      }
    }

    // Sort events by timestamp
    events.sort((a, b) => {
      const timeA = getTimestampMs(a.timestamp);
      const timeB = getTimestampMs(b.timestamp);
      return timeA - timeB;
    });

    return events;
  }

  /**
   * Detect correlations between events
   */
  detectCorrelations(
    events: CorrelationEvent[],
    maxTimeDeltaMs: number = MAX_TIME_DELTA_MS,
  ): Correlation[] {
    const correlations: Correlation[] = [];

    // Look for events that occur close together in time
    for (let i = 0; i < events.length; i++) {
      const event1 = events[i];
      const time1 = getTimestampMs(event1.timestamp);

      for (let j = i + 1; j < events.length; j++) {
        const event2 = events[j];
        const time2 = getTimestampMs(event2.timestamp);
        const timeDelta = Math.abs(time2 - time1);

        // Stop looking if events are too far apart
        if (timeDelta > maxTimeDeltaMs) {
          break;
        }

        // Calculate correlation strength based on temporal proximity and event types
        const strength = this.calculateCorrelationStrength(
          event1,
          event2,
          timeDelta,
          maxTimeDeltaMs,
        );

        if (strength >= MODERATE_CORRELATION_THRESHOLD) {
          const description = this.generateCorrelationDescription(
            event1,
            event2,
            timeDelta,
          );

          correlations.push({
            events: [event1, event2],
            strength,
            timeDeltaMs: timeDelta,
            description,
          });
        }
      }
    }

    // Sort by strength (strongest first)
    correlations.sort((a, b) => b.strength - a.strength);

    return correlations;
  }

  /**
   * Identify root cause candidate (earliest event in strongest correlation)
   */
  identifyRootCause(correlations: Correlation[]): CorrelationEvent | null {
    if (correlations.length === 0) {
      return null;
    }

    // Get the strongest correlation
    const strongest = correlations[0];

    // Return the earliest event in the correlation
    const sortedEvents = [...strongest.events].sort((a, b) => {
      const timeA = getTimestampMs(a.timestamp);
      const timeB = getTimestampMs(b.timestamp);
      return timeA - timeB;
    });

    return sortedEvents[0];
  }

  /**
   * Calculate correlation strength between two events
   */
  private calculateCorrelationStrength(
    event1: CorrelationEvent,
    event2: CorrelationEvent,
    timeDelta: number,
    maxTimeDelta: number,
  ): number {
    // Base strength on temporal proximity (closer = stronger)
    const temporalStrength = 1 - timeDelta / maxTimeDelta;

    // Boost strength for certain event type combinations
    let typeBoost = 0;

    // Metric spike + error burst = strong correlation
    if (
      (event1.type === "metric_spike" && event2.type === "error_burst") ||
      (event1.type === "error_burst" && event2.type === "metric_spike")
    ) {
      typeBoost = 0.3;
    }

    // Incident + metric/log event = moderate correlation
    if (
      (event1.source === "incident" && event2.source !== "incident") ||
      (event1.source !== "incident" && event2.source === "incident")
    ) {
      typeBoost = 0.2;
    }

    // Severity change + error burst = strong correlation
    if (
      (event1.type === "severity_change" && event2.type === "error_burst") ||
      (event1.type === "error_burst" && event2.type === "severity_change")
    ) {
      typeBoost = 0.3;
    }

    return Math.min(1.0, temporalStrength + typeBoost);
  }

  /**
   * Generate human-readable correlation description
   */
  private generateCorrelationDescription(
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
}
