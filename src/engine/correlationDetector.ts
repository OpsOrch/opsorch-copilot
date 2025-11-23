import { ToolResult } from '../types.js';
import { DomainRegistry } from './domainRegistry.js';
import { isValidTimestamp, normalizeTimestamp, getTimestampMs } from './timestampUtils.js';

const DEFAULT_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Represents an event extracted from tool results
 */
export interface CorrelationEvent {
  timestamp: string; // ISO 8601
  source: 'metric' | 'log' | 'incident';
  type: string; // e.g., 'cpu_spike', 'error_burst', 'severity_change'
  value?: number;
  metadata?: any;
}

/**
 * Represents a group of correlated events
 */
export interface CorrelationGroup {
  timeWindow: string;
  events: CorrelationEvent[];
  strength: number;
}

/**
 * Represents a correlation between events
 */
export interface Correlation {
  events: CorrelationEvent[];
  strength: number; // 0.0-1.0
  timeDeltaMs: number; // Time between events
  description: string;
}

const MAX_TIME_DELTA_MS = 5 * 60 * 1000; // 5 minutes
const STRONG_CORRELATION_THRESHOLD = 0.8;
const MODERATE_CORRELATION_THRESHOLD = 0.5;

/**
 * CorrelationDetector identifies temporal correlations between metrics, logs, and incidents
 * to help identify root causes and related issues.
 */
export class CorrelationDetector {
  constructor(private registry: DomainRegistry) { }

  /**
   * Extract events from tool results using domain registry to categorize tools
   */
  extractEvents(results: ToolResult[]): CorrelationEvent[] {
    const events: CorrelationEvent[] = [];

    for (const result of results) {
      // Get domain for this tool
      const domain = this.registry.getDomainForTool(result.name);

      if (!domain) continue;

      // Route to appropriate extractor based on domain name
      if (domain.name === 'metric') {
        events.push(...this.extractMetricEvents(result));
      } else if (domain.name === 'log') {
        events.push(...this.extractLogEvents(result));
      } else if (domain.name === 'incident') {
        events.push(...this.extractIncidentEvents(result));
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
    maxTimeDeltaMs: number = MAX_TIME_DELTA_MS
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
          maxTimeDeltaMs
        );

        if (strength >= MODERATE_CORRELATION_THRESHOLD) {
          const description = this.generateCorrelationDescription(
            event1,
            event2,
            timeDelta
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
   * Extract metric events from query-metrics result
   */
  private extractMetricEvents(result: ToolResult): CorrelationEvent[] {
    const events: CorrelationEvent[] = [];
    const payload = result.result;

    if (!payload || typeof payload !== 'object') {
      return events;
    }

    // Look for time series data
    const series = this.findArray(payload, ['series', 'data', 'results']);

    if (series && Array.isArray(series)) {
      for (const s of series) {
        if (typeof s === 'object' && s !== null) {
          // Extract data points
          const values = s.values || s.datapoints || [];
          const timestamps = s.timestamps || [];

          for (let i = 0; i < values.length; i++) {
            const value = Array.isArray(values[i]) ? values[i][1] : values[i];
            const timestamp = timestamps[i] || values[i]?.[0];

            if (timestamp && isValidTimestamp(timestamp)) {
              // Detect spikes or anomalies
              if (typeof value === 'number' && this.isAnomaly(value, values)) {
                events.push({
                  timestamp: normalizeTimestamp(timestamp),
                  source: 'metric',
                  type: value > 0 ? 'metric_spike' : 'metric_drop',
                  value,
                  metadata: { metric: s.name || s.metric || 'unknown' },
                });
              }
            }
          }
        }
      }
    }

    return events;
  }

  /**
   * Extract log events from query-logs result
   */
  private extractLogEvents(result: ToolResult): CorrelationEvent[] {
    const events: CorrelationEvent[] = [];
    const payload = result.result;

    if (!payload || typeof payload !== 'object') {
      return events;
    }

    const entries = this.findArray(payload, ['entries', 'logs', 'data']);

    if (entries && Array.isArray(entries)) {
      // Group errors by time window to detect bursts
      const errorsByWindow = new Map<string, number>();

      for (const entry of entries) {
        if (typeof entry === 'object' && entry !== null) {
          const timestamp =
            entry.timestamp || entry.time || entry['@timestamp'];

          if (timestamp && isValidTimestamp(timestamp)) {
            const normalizedTime = normalizeTimestamp(timestamp);
            const timeWindow = this.getTimeWindow(normalizedTime, 60000); // 1-minute windows

            // Count errors in this window
            const count = errorsByWindow.get(timeWindow) || 0;
            errorsByWindow.set(timeWindow, count + 1);
          }
        }
      }

      // Create events for error bursts (more than 5 errors in a minute)
      for (const [timeWindow, count] of errorsByWindow.entries()) {
        if (count >= 5) {
          events.push({
            timestamp: timeWindow,
            source: 'log',
            type: 'error_burst',
            value: count,
            metadata: { errorCount: count },
          });
        }
      }
    }

    return events;
  }

  /**
   * Extract incident events from incident results
   */
  private extractIncidentEvents(result: ToolResult): CorrelationEvent[] {
    const events: CorrelationEvent[] = [];
    const payload = result.result;

    if (!payload || typeof payload !== 'object') {
      return events;
    }

    // Check if this is a timeline tool using domain config
    const domain = this.registry.getDomainForTool(result.name);
    const isTimelineTool = domain?.name === 'incident' && result.name.includes('timeline');

    // Handle timeline events
    if (isTimelineTool) {
      const timelineEvents = this.findArray(payload, ['events', 'timeline']);

      if (timelineEvents && Array.isArray(timelineEvents)) {
        for (const event of timelineEvents) {
          if (typeof event === 'object' && event !== null) {
            const timestamp = event.timestamp || event.at || event.time;
            const kind = event.kind || event.type;

            if (timestamp && isValidTimestamp(timestamp)) {
              // Look for significant events
              if (
                kind === 'severity_change' ||
                kind === 'status_change' ||
                kind === 'deploy'
              ) {
                events.push({
                  timestamp: normalizeTimestamp(timestamp),
                  source: 'incident',
                  type: kind,
                  metadata: event,
                });
              }
            }
          }
        }
      }
    }

    // Handle incident creation/updates
    const incidents = this.findArray(payload, ['incidents', 'data']);
    if (incidents && Array.isArray(incidents)) {
      for (const incident of incidents) {
        if (typeof incident === 'object' && incident !== null) {
          const startTime =
            incident.startTime || incident.start || incident.createdAt;

          if (startTime && isValidTimestamp(startTime)) {
            events.push({
              timestamp: normalizeTimestamp(startTime),
              source: 'incident',
              type: 'incident_created',
              metadata: { id: incident.id, severity: incident.severity },
            });
          }
        }
      }
    }

    return events;
  }

  /**
   * Calculate correlation strength between two events
   */
  private calculateCorrelationStrength(
    event1: CorrelationEvent,
    event2: CorrelationEvent,
    timeDelta: number,
    maxTimeDelta: number
  ): number {
    // Base strength on temporal proximity (closer = stronger)
    const temporalStrength = 1 - timeDelta / maxTimeDelta;

    // Boost strength for certain event type combinations
    let typeBoost = 0;

    // Metric spike + error burst = strong correlation
    if (
      (event1.type === 'metric_spike' && event2.type === 'error_burst') ||
      (event1.type === 'error_burst' && event2.type === 'metric_spike')
    ) {
      typeBoost = 0.3;
    }

    // Incident + metric/log event = moderate correlation
    if (
      (event1.source === 'incident' && event2.source !== 'incident') ||
      (event1.source !== 'incident' && event2.source === 'incident')
    ) {
      typeBoost = 0.2;
    }

    // Severity change + error burst = strong correlation
    if (
      (event1.type === 'severity_change' && event2.type === 'error_burst') ||
      (event1.type === 'error_burst' && event2.type === 'severity_change')
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
    timeDelta: number
  ): string {
    const deltaSeconds = Math.round(timeDelta / 1000);
    const deltaMinutes = Math.round(deltaSeconds / 60);

    const timeStr =
      deltaMinutes > 0 ? `${deltaMinutes} minute(s)` : `${deltaSeconds} second(s)`;

    return `${event1.type} followed by ${event2.type} within ${timeStr}`;
  }

  /**
   * Helper: Find array in nested object
   */
  private findArray(obj: any, keys: string[]): any[] | null {
    for (const key of keys) {
      if (obj[key] && Array.isArray(obj[key])) {
        return obj[key];
      }
    }
    return null;
  }



  /**
   * Helper: Get time window for grouping
   */
  private getTimeWindow(timestamp: string, windowMs: number): string {
    const time = new Date(timestamp).getTime();
    const windowStart = Math.floor(time / windowMs) * windowMs;
    return new Date(windowStart).toISOString();
  }

  /**
   * Helper: Check if value is an anomaly in the series
   */
  private isAnomaly(value: number, series: any[]): boolean {
    const numbers = series
      .map((v) => (Array.isArray(v) ? v[1] : v))
      .filter((v) => typeof v === 'number');

    if (numbers.length < 3) {
      return false;
    }

    const mean = numbers.reduce((sum, n) => sum + n, 0) / numbers.length;
    const variance =
      numbers.reduce((sum, n) => sum + Math.pow(n - mean, 2), 0) /
      numbers.length;
    const stdDev = Math.sqrt(variance);

    // Value is anomaly if it's more than 2 standard deviations from mean
    return Math.abs(value - mean) > 2 * stdDev;
  }
}
