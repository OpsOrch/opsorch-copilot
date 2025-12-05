/**
 * Incident Correlation Handler
 *
 * Detects correlations between incident events and other system events.
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
 * Incident correlation handler that detects correlations involving incident events
 */
export const incidentCorrelationHandler: CorrelationHandler = async (
  context,
  events,
): Promise<Correlation[]> => {
  const correlations: Correlation[] = [];

  // Filter for incident events and events that could correlate with incidents
  const incidentEvents = events.filter((e) => e.source === "incident");
  const otherEvents = events.filter((e) => e.source !== "incident");

  // Find correlations between incident events and other events
  for (const incidentEvent of incidentEvents) {
    for (const otherEvent of otherEvents) {
      const correlation = calculateIncidentCorrelation(
        incidentEvent,
        otherEvent,
      );
      if (
        correlation &&
        correlation.strength >= MODERATE_CORRELATION_THRESHOLD
      ) {
        correlations.push(correlation);
      }
    }
  }

  // Find correlations between incident events themselves
  for (let i = 0; i < incidentEvents.length; i++) {
    for (let j = i + 1; j < incidentEvents.length; j++) {
      const correlation = calculateIncidentCorrelation(
        incidentEvents[i],
        incidentEvents[j],
      );
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
 * Extract incident events from tool results
 *
 * MCP timelineEntrySchema: { id, incidentId, at, kind, body, actor?, metadata? }
 * MCP incidentSchema: { id, title, description?, status, severity, service?, createdAt, updatedAt, ... }
 */
export function extractIncidentEvents(result: ToolResult): CorrelationEvent[] {
  const events: CorrelationEvent[] = [];
  const payload = result.result;

  if (!payload || typeof payload !== "object") {
    return events;
  }

  // Check if this is a timeline tool
  const isTimelineTool = result.name.includes("timeline");

  // Handle timeline events - get-incident-timeline returns z.array(timelineEntrySchema)
  if (isTimelineTool && Array.isArray(payload)) {
    for (const entry of payload) {
      if (typeof entry === "object" && entry !== null && !Array.isArray(entry)) {
        const eventObj = entry as JsonObject;
        // MCP schema: at: z.string().datetime(), kind: z.string()
        const at = eventObj.at;
        const kind = eventObj.kind;

        if (
          typeof at === "string" &&
          isValidTimestamp(at) &&
          typeof kind === "string"
        ) {
          // Look for significant events
          if (
            kind === "severity_change" ||
            kind === "status_change" ||
            kind === "deploy"
          ) {
            events.push({
              timestamp: normalizeTimestamp(at),
              source: "incident",
              type: kind,
              metadata: eventObj,
            });
          }
        }
      }
    }
  }

  // Handle incident results - query-incidents returns z.array(incidentSchema)
  if (Array.isArray(payload)) {
    for (const incident of payload) {
      if (typeof incident === "object" && incident !== null && !Array.isArray(incident)) {
        const incidentObj = incident as JsonObject;
        // MCP schema: createdAt: z.string().datetime()
        const createdAt = incidentObj.createdAt;

        if (typeof createdAt === "string" && isValidTimestamp(createdAt)) {
          events.push({
            timestamp: normalizeTimestamp(createdAt),
            source: "incident",
            type: "incident_created",
            // MCP schema: id: z.string(), severity: z.string()
            metadata: { id: incidentObj.id, severity: incidentObj.severity },
          });
        }
      }
    }
  } else if (typeof payload === "object" && !Array.isArray(payload)) {
    // get-incident returns incidentSchema directly
    const incidentObj = payload as JsonObject;
    const createdAt = incidentObj.createdAt;

    if (typeof createdAt === "string" && isValidTimestamp(createdAt)) {
      events.push({
        timestamp: normalizeTimestamp(createdAt),
        source: "incident",
        type: "incident_created",
        metadata: { id: incidentObj.id, severity: incidentObj.severity },
      });
    }
  }

  return events;
}

/**
 * Calculate correlation between two events, with special handling for incident events
 */
function calculateIncidentCorrelation(
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
 * Calculate correlation strength between two events with incident-specific logic
 */
function calculateCorrelationStrength(
  event1: CorrelationEvent,
  event2: CorrelationEvent,
  timeDelta: number,
  maxTimeDelta: number,
): number {
  // Base strength on temporal proximity (closer = stronger)
  const temporalStrength = 1 - timeDelta / maxTimeDelta;

  // Boost strength for certain event type combinations involving incidents
  let typeBoost = 0;

  // Severity change + error burst = strong correlation
  if (
    (event1.type === "severity_change" && event2.type === "error_burst") ||
    (event1.type === "error_burst" && event2.type === "severity_change")
  ) {
    typeBoost = 0.3;
  }

  // Severity change + metric spike = strong correlation
  if (
    (event1.type === "severity_change" && event2.type === "metric_spike") ||
    (event1.type === "metric_spike" && event2.type === "severity_change")
  ) {
    typeBoost = 0.3;
  }

  // Deploy + incident creation = strong correlation (deployment issues)
  if (
    (event1.type === "deploy" && event2.type === "incident_created") ||
    (event1.type === "incident_created" && event2.type === "deploy")
  ) {
    typeBoost = 0.35;
  }

  // Deploy + metric spike = moderate correlation
  if (
    (event1.type === "deploy" && event2.type === "metric_spike") ||
    (event1.type === "metric_spike" && event2.type === "deploy")
  ) {
    typeBoost = 0.25;
  }

  // Status change + other events = moderate correlation
  if (
    (event1.type === "status_change" && event2.source !== "incident") ||
    (event1.source !== "incident" && event2.type === "status_change")
  ) {
    typeBoost = Math.max(typeBoost, 0.2);
  }

  // Multiple incident events = moderate correlation (cascading incidents)
  if (
    event1.source === "incident" &&
    event2.source === "incident" &&
    event1.type !== event2.type
  ) {
    typeBoost = Math.max(typeBoost, 0.25);
  }

  // General incident + metric/log event = moderate correlation
  if (
    (event1.source === "incident" && event2.source !== "incident") ||
    (event1.source !== "incident" && event2.source === "incident")
  ) {
    typeBoost = Math.max(typeBoost, 0.2);
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


