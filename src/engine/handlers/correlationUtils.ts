/**
 * Shared Correlation Utilities
 *
 * Common logic for calculating correlation strength and generating descriptions
 * across all correlation handlers (metric, log, incident).
 */

import type { CorrelationEvent, Correlation } from "../../types.js";

// Time window for considering events as potentially correlated
export const MAX_TIME_DELTA_MS = 5 * 60 * 1000; // 5 minutes

// Minimum correlation strength to report
export const MODERATE_CORRELATION_THRESHOLD = 0.5;

/**
 * Event type combination boosts for correlation strength.
 * Key format: "type1:type2" (sorted alphabetically)
 */
const TYPE_BOOSTS: Record<string, number> = {
    // Strong correlations (0.3-0.35)
    "critical_error:incident_created": 0.35,
    "deploy:incident_created": 0.35,
    "error_burst:metric_spike": 0.3,
    "error_burst:severity_change": 0.3,
    "metric_spike:severity_change": 0.3,

    // Moderate correlations (0.2-0.25)
    "deploy:error_burst": 0.25,
    "deploy:metric_spike": 0.25,
    "incident_created:metric_drop": 0.25,
    "critical_error:metric_drop": 0.25,
    "metric_spike:metric_spike": 0.2,
    "error_burst:error_burst": 0.2,
};

/**
 * Source combination boosts when no specific type match found.
 * Key format: "source1:source2" (sorted alphabetically)
 */
const SOURCE_BOOSTS: Record<string, number> = {
    "incident:log": 0.15,
    "incident:metric": 0.2,
    "log:metric": 0.15,
};

/**
 * Calculate correlation between two events
 */
export function calculateCorrelation(
    event1: CorrelationEvent,
    event2: CorrelationEvent,
    maxTimeDelta: number = MAX_TIME_DELTA_MS,
): Correlation | null {
    const time1 = new Date(event1.timestamp).getTime();
    const time2 = new Date(event2.timestamp).getTime();
    const timeDelta = Math.abs(time2 - time1);

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
 * Calculate correlation strength between two events
 */
export function calculateCorrelationStrength(
    event1: CorrelationEvent,
    event2: CorrelationEvent,
    timeDelta: number,
    maxTimeDelta: number,
): number {
    // Base strength on temporal proximity (closer = stronger)
    const temporalStrength = 1 - timeDelta / maxTimeDelta;

    // Look up type-based boost
    const typeKey = [event1.type, event2.type].sort().join(":");
    let boost = TYPE_BOOSTS[typeKey] || 0;

    // If no type boost found, check for source-based boost
    if (boost === 0 && event1.source !== event2.source) {
        const sourceKey = [event1.source, event2.source].sort().join(":");
        boost = SOURCE_BOOSTS[sourceKey] || 0;
    }

    // Additional boost for cascading incidents (different types, same source)
    if (
        event1.source === "incident" &&
        event2.source === "incident" &&
        event1.type !== event2.type
    ) {
        boost = Math.max(boost, 0.25);
    }

    return Math.min(1.0, temporalStrength + boost);
}

/**
 * Generate human-readable correlation description
 */
export function generateCorrelationDescription(
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
 * Find correlations between two sets of events
 */
export function findCorrelations(
    primaryEvents: CorrelationEvent[],
    otherEvents: CorrelationEvent[],
    maxTimeDelta: number = MAX_TIME_DELTA_MS,
): Correlation[] {
    const correlations: Correlation[] = [];

    // Find correlations between primary events and other events
    for (const primaryEvent of primaryEvents) {
        for (const otherEvent of otherEvents) {
            const correlation = calculateCorrelation(primaryEvent, otherEvent, maxTimeDelta);
            if (correlation) {
                correlations.push(correlation);
            }
        }
    }

    return correlations;
}

/**
 * Find correlations within a single set of events
 */
export function findIntraCorrelations(
    events: CorrelationEvent[],
    maxTimeDelta: number = MAX_TIME_DELTA_MS,
): Correlation[] {
    const correlations: Correlation[] = [];

    for (let i = 0; i < events.length; i++) {
        for (let j = i + 1; j < events.length; j++) {
            const correlation = calculateCorrelation(events[i], events[j], maxTimeDelta);
            if (correlation) {
                correlations.push(correlation);
            }
        }
    }

    return correlations;
}

/**
 * Sort correlations by strength (strongest first)
 */
export function sortByStrength(correlations: Correlation[]): Correlation[] {
    return correlations.sort((a, b) => b.strength - a.strength);
}
