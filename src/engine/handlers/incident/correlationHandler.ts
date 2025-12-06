/**
 * Incident Correlation Handler
 *
 * Detects correlations between incident events and other system events.
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
 * Incident correlation handler that detects correlations involving incident events
 */
export const incidentCorrelationHandler: CorrelationHandler = async (
  _context,
  events,
): Promise<Correlation[]> => {
  // Filter for incident events and events that could correlate with incidents
  const incidentEvents = events.filter((e) => e.source === "incident");
  const otherEvents = events.filter((e) => e.source !== "incident");

  // Find correlations between incident events and other events
  const crossCorrelations = findCorrelations(incidentEvents, otherEvents);

  // Find correlations between incident events themselves
  const intraCorrelations = findIntraCorrelations(incidentEvents);

  return sortByStrength([...crossCorrelations, ...intraCorrelations]);
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



