import { TimelineEvent, TimelineSummary } from "../types.js";

const SUMMARIZATION_THRESHOLD = 20;
const MAX_KEY_EVENTS = 15;
const GROUPING_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

/**
 * TimelineSummarizer condenses long incident timelines to key events
 * to help the LLM focus on important changes rather than processing hundreds of events.
 */
export class TimelineSummarizer {
  /**
   * Check if timeline needs summarization
   */
  needsSummarization(events: TimelineEvent[]): boolean {
    return events.length > SUMMARIZATION_THRESHOLD;
  }

  /**
   * Summarize timeline events
   */
  summarize(
    events: TimelineEvent[],
    maxEvents: number = MAX_KEY_EVENTS,
  ): TimelineSummary {
    if (!this.needsSummarization(events)) {
      return {
        totalEvents: events.length,
        summarizedEvents: events.length,
        keyEvents: events,
        groupedEvents: [],
        omittedCount: 0,
      };
    }

    // Sort events by timestamp
    const sortedEvents = [...events].sort((a, b) => {
      return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
    });

    // Identify key events
    const keyEvents = this.identifyKeyEvents(sortedEvents);

    // Group similar consecutive events
    const groupedEvents = this.groupEvents(sortedEvents);

    // Limit key events to maxEvents
    const limitedKeyEvents = keyEvents.slice(0, maxEvents);

    const omittedCount = Math.max(
      0,
      events.length -
        limitedKeyEvents.length -
        groupedEvents.reduce((sum, g) => sum + g.count, 0),
    );

    return {
      totalEvents: events.length,
      summarizedEvents: limitedKeyEvents.length + groupedEvents.length,
      keyEvents: limitedKeyEvents,
      groupedEvents,
      omittedCount,
    };
  }

  /**
   * Identify key events (severity changes, status changes, deploys)
   */
  identifyKeyEvents(events: TimelineEvent[]): TimelineEvent[] {
    const keyEvents: TimelineEvent[] = [];
    const keyEventTypes = new Set([
      "severity_change",
      "status_change",
      "deploy",
      "deployment",
      "incident_created",
      "incident_resolved",
      "escalation",
      "assignment_change",
    ]);

    for (const event of events) {
      // Check if event type is considered key
      if (keyEventTypes.has(event.kind)) {
        keyEvents.push(event);
        continue;
      }

      // Check if event body contains key indicators
      const body = event.body?.toLowerCase() || "";
      if (
        body.includes("severity") ||
        body.includes("status") ||
        body.includes("deploy") ||
        body.includes("escalat") ||
        body.includes("resolv") ||
        body.includes("assign")
      ) {
        keyEvents.push(event);
        continue;
      }

      // Include user comments (not automated)
      if (
        event.actor &&
        typeof event.actor === "object" &&
        event.actor.type === "user"
      ) {
        keyEvents.push(event);
      }
    }

    // Always include first and last events
    if (events.length > 0) {
      if (!keyEvents.includes(events[0])) {
        keyEvents.unshift(events[0]);
      }
      const lastEvent = events[events.length - 1];
      if (!keyEvents.includes(lastEvent)) {
        keyEvents.push(lastEvent);
      }
    }

    return keyEvents;
  }

  /**
   * Group similar consecutive events
   */
  groupEvents(events: TimelineEvent[]): TimelineSummary["groupedEvents"] {
    const groups: Map<
      string,
      {
        count: number;
        firstTimestamp: string;
        lastTimestamp: string;
      }
    > = new Map();

    // Group events by type within time windows
    for (let i = 0; i < events.length; i++) {
      const event = events[i];
      const eventTime = new Date(event.timestamp).getTime();

      // Look for similar events within the grouping window
      const groupKey = this.getGroupKey(event);
      if (!groupKey) continue;

      const existing = groups.get(groupKey);
      if (existing) {
        const timeDiff = eventTime - new Date(existing.lastTimestamp).getTime();
        if (timeDiff <= GROUPING_WINDOW_MS) {
          // Add to existing group
          existing.count++;
          existing.lastTimestamp = event.timestamp;
        } else {
          // Start new group with same key
          const newKey = `${groupKey}_${groups.size}`;
          groups.set(newKey, {
            count: 1,
            firstTimestamp: event.timestamp,
            lastTimestamp: event.timestamp,
          });
        }
      } else {
        // Start new group
        groups.set(groupKey, {
          count: 1,
          firstTimestamp: event.timestamp,
          lastTimestamp: event.timestamp,
        });
      }
    }

    // Convert to result format, only include groups with multiple events
    const result: TimelineSummary["groupedEvents"] = [];
    for (const [key, group] of groups.entries()) {
      if (group.count >= 3) {
        // Only group if 3+ similar events
        const baseKey = key.split("_")[0]; // Remove suffix
        result.push({
          type: baseKey,
          count: group.count,
          timeRange: {
            start: group.firstTimestamp,
            end: group.lastTimestamp,
          },
        });
      }
    }

    return result;
  }

  /**
   * Get grouping key for similar events
   */
  private getGroupKey(event: TimelineEvent): string | null {
    const kind = event.kind?.toLowerCase();
    const body = event.body?.toLowerCase() || "";

    // Group notification events
    if (kind === "notification" || body.includes("notification")) {
      return "notifications";
    }

    // Group alert events
    if (kind === "alert" || body.includes("alert")) {
      return "alerts";
    }

    // Group automated actions
    if (
      kind === "automation" ||
      body.includes("automated") ||
      body.includes("auto-")
    ) {
      return "automated_actions";
    }

    // Group status updates (but not changes)
    if (
      kind === "status_update" ||
      (body.includes("status") && !body.includes("change"))
    ) {
      return "status_updates";
    }

    // Group monitoring events
    if (kind === "monitoring" || body.includes("monitor")) {
      return "monitoring_events";
    }

    // Don't group key events
    return null;
  }

  /**
   * Format summary for LLM consumption
   */
  formatSummary(summary: TimelineSummary): string {
    let formatted = `Timeline Summary (${summary.totalEvents} total events):\n\n`;

    // Key events
    if (summary.keyEvents.length > 0) {
      formatted += "Key Events:\n";
      for (const event of summary.keyEvents) {
        const time = new Date(event.timestamp).toISOString().substring(11, 19); // HH:MM:SS
        formatted += `- ${time}: ${event.kind} - ${event.body}\n`;
      }
      formatted += "\n";
    }

    // Grouped events
    if (summary.groupedEvents.length > 0) {
      formatted += "Grouped Events:\n";
      for (const group of summary.groupedEvents) {
        const startTime = new Date(group.timeRange.start)
          .toISOString()
          .substring(11, 19);
        const endTime = new Date(group.timeRange.end)
          .toISOString()
          .substring(11, 19);
        formatted += `- ${group.count} ${group.type} (${startTime} - ${endTime})\n`;
      }
      formatted += "\n";
    }

    if (summary.omittedCount > 0) {
      formatted += `(${summary.omittedCount} routine events omitted)\n`;
    }

    return formatted;
  }
}
