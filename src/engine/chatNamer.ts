import { ChatNamerConfig, Entity } from "../types.js";

interface ExtractedEntities {
  incidents: string[];
  services: string[];
  metrics: string[];
  timeRanges: string[];
  topics: string[];
}

export class ChatNamer {
  private readonly config: ChatNamerConfig;

  constructor(config: ChatNamerConfig = { maxLength: 60 }) {
    this.config = config;
  }

  /**
   * Generate a conversation name based on the user message and LLM response.
   * Analyzes both inputs to extract the most meaningful name.
   */
  generateName(
    userMessage: string,
    llmResponse: string,
    timestamp: number,
    knownEntities: Entity[] = [],
  ): string {
    const startTime = Date.now();

    // Context from extracted entities
    const knownIncidents = knownEntities
      .filter((e) => e.type === "incident")
      .map((e) => e.value);

    const knownServices = knownEntities
      .filter((e) => e.type === "service")
      .map((e) => e.value);

    // Context from parsing (for types not covered by Entity handlers yet, like metrics/topics)
    const responseEntities = this.extractEntitiesFromResponse(llmResponse);
    const userEntities = this.extractEntitiesFromResponse(userMessage);

    // Merge entities
    const mergedEntities: ExtractedEntities = {
      incidents: [
        ...new Set([
          ...knownIncidents,
          ...responseEntities.incidents,
          ...userEntities.incidents,
        ]),
      ],
      services: [
        ...new Set([
          ...knownServices,
          ...responseEntities.services,
          ...userEntities.services,
        ]),
      ],
      metrics: [
        ...new Set([...responseEntities.metrics, ...userEntities.metrics]),
      ],
      timeRanges: [
        ...new Set([
          ...responseEntities.timeRanges,
          ...userEntities.timeRanges,
        ]),
      ],
      topics: [
        ...new Set([...userEntities.topics, ...responseEntities.topics]),
      ],
    };

    // Determine intent from user message
    const intent = this.determineIntent(userMessage);

    // Try to synthesize a name
    let name = this.synthesizeName(mergedEntities, intent, userMessage);

    // Fall back if synthesis didn't produce a name
    if (!name || name.trim().length === 0) {
      name = this.createFallbackName(userMessage, timestamp);
    }

    // Sanitize the final name
    const sanitizedName = this.sanitizeName(name);

    // Log the result
    const executionTime = Date.now() - startTime;
    console.log("[ChatNamer]", {
      name: sanitizedName,
      entities: mergedEntities,
      intent,
      executionTime: `${executionTime}ms`,
    });

    return sanitizedName;
  }

  /**
   * Extract key entities from the LLM response (incidents, services, metrics).
   */
  private extractEntitiesFromResponse(response: string): ExtractedEntities {
    if (!response || response.trim().length === 0) {
      return {
        incidents: [],
        services: [],
        metrics: [],
        timeRanges: [],
        topics: [],
      };
    }

    return {
      incidents: [], // Handled by knownEntities mostly, keeping empty for interface compatibility or if we want to keep regex as backup?
      // The user wants to use handlers. I will remove strict regex parsing for incidents/services from here to force reliance on handlers,
      // BUT 'metrics', 'topics', 'timeRanges' are NOT in Entity type, so they must stay.
      // Actually, for safety, I will perform a lighter regex or just empty for incidents/services to rely on knownEntities?
      // If I remove extractIncidents/extractServices entirely, I should return empty arrays here.
      services: [],
      metrics: this.extractMetrics(response),
      timeRanges: this.extractTimeRanges(response),
      topics: this.extractTopics(response),
    };
  }

  /**
   * Extract incidents - REMOVED (Replaced by Entity handlers)
   */
  // private extractIncidents(text: string): string[] { ... }

  /**
   * Extract services - REMOVED (Replaced by Entity handlers)
   */
  // private extractServices(text: string): string[] { ... }

  /**
   * Extract metrics from text (CPU, latency, p95, errors, etc.)
   */
  private extractMetrics(text: string): string[] {
    const metrics: string[] = [];
    const lowerText = text.toLowerCase();

    const metricKeywords = [
      "latency",
      "cpu",
      "memory",
      "error",
      "5xx",
      "4xx",
      "p95",
      "p99",
      "p50",
      "throughput",
      "request",
      "response time",
      "disk",
      "network",
      "timeout",
    ];

    for (const keyword of metricKeywords) {
      if (lowerText.includes(keyword)) {
        // Normalize plural forms
        const normalized =
          keyword.endsWith("s") &&
          keyword !== "p95" &&
          keyword !== "p99" &&
          keyword !== "p50"
            ? keyword.slice(0, -1)
            : keyword;
        if (!metrics.includes(normalized)) {
          metrics.push(normalized);
        }
      }
    }

    return metrics;
  }

  /**
   * Extract topic/domain from text (payment, checkout, database, etc.)
   */
  private extractTopics(text: string): string[] {
    const topics: string[] = [];
    const lowerText = text.toLowerCase();

    const topicKeywords = [
      "payment",
      "payments",
      "checkout",
      "billing",
      "order",
      "orders",
      "database",
      "cache",
      "auth",
      "authentication",
      "webhook",
      "webhooks",
      "api",
      "gateway",
    ];

    for (const keyword of topicKeywords) {
      if (lowerText.includes(keyword)) {
        // Normalize plural forms
        const normalized = keyword.endsWith("s")
          ? keyword.slice(0, -1)
          : keyword;
        if (!topics.includes(normalized)) {
          topics.push(normalized);
        }
      }
    }

    return topics;
  }

  /**
   * Extract time ranges from text (last 30 minutes, between X and Y, etc.)
   */
  private extractTimeRanges(text: string): string[] {
    const timeRanges: string[] = [];

    // Pattern: last N minutes/hours/days
    const lastPattern = /last\s+(\d+)\s+(minute|hour|day|min|hr)s?/gi;
    const lastMatches = text.matchAll(lastPattern);
    for (const match of lastMatches) {
      const num = match[1];
      const unit = match[2].toLowerCase();
      const shortUnit = unit.startsWith("min")
        ? "m"
        : unit.startsWith("h")
          ? "h"
          : "d";
      timeRanges.push(`Last ${num}${shortUnit}`);
    }

    // Pattern: past hour/day
    const pastPattern = /past\s+(hour|day|week)/gi;
    const pastMatches = text.matchAll(pastPattern);
    for (const match of pastMatches) {
      timeRanges.push(`Past ${match[1]}`);
    }

    // Keyword: recent
    if (/\brecent\b/i.test(text)) {
      timeRanges.push("Recent");
    }

    return timeRanges;
  }

  /**
   * Determine the question intent from user message
   */
  private determineIntent(userMessage: string): string | null {
    const lowerMessage = userMessage.toLowerCase();

    // Root cause analysis
    if (
      /what caused/i.test(lowerMessage) ||
      /why did/i.test(lowerMessage) ||
      /what happened/i.test(lowerMessage) ||
      /root cause/i.test(lowerMessage)
    ) {
      return "root-cause";
    }

    // Investigation
    if (
      /show me/i.test(lowerMessage) ||
      /\bfind\b/i.test(lowerMessage) ||
      /search/i.test(lowerMessage) ||
      /look for/i.test(lowerMessage)
    ) {
      return "investigation";
    }

    // Correlation
    if (
      /compare/i.test(lowerMessage) ||
      /correlat/i.test(lowerMessage) ||
      /relationship between/i.test(lowerMessage) ||
      /\bvs\b/i.test(lowerMessage)
    ) {
      return "correlation";
    }

    // Status check
    if (
      /^is\b/i.test(lowerMessage) ||
      /^are\b/i.test(lowerMessage) ||
      /status of/i.test(lowerMessage) ||
      /health of/i.test(lowerMessage)
    ) {
      return "status-check";
    }

    // Troubleshooting
    if (
      /\bfix\b/i.test(lowerMessage) ||
      /resolve/i.test(lowerMessage) ||
      /debug/i.test(lowerMessage) ||
      /issue with/i.test(lowerMessage) ||
      /problem with/i.test(lowerMessage)
    ) {
      return "troubleshooting";
    }

    return null;
  }

  /**
   * Generate name from extracted entities and intent
   */
  private synthesizeName(
    entities: ExtractedEntities,
    intent: string | null,
    userMessage: string,
  ): string {
    const { incidents, services, metrics, timeRanges, topics } = entities;

    // Priority 1: Topic + Multiple Services (e.g., "Payment Checkout and Webhook Issues")
    if (topics.length > 0 && services.length >= 2) {
      const topic = this.formatTopicName(topics[0]);
      const service1 = this.formatServiceName(services[0]).split(" ")[0]; // Get first word
      const service2 = this.formatServiceName(services[1]).split(" ")[0];
      return `${topic} ${service1} and ${service2} Issues`;
    }

    // Priority 2: Topic + Service + Metric (e.g., "Payment Checkout Latency")
    if (topics.length > 0 && services.length > 0 && metrics.length > 0) {
      const topic = this.formatTopicName(topics[0]);
      const service = this.formatServiceName(services[0]).split(" ")[0];
      const metric = this.formatMetricName(metrics[0]);
      return `${topic} ${service} ${metric}`;
    }

    // Priority 3: Topic + Multiple Metrics (e.g., "Payment Latency and Timeout Issues")
    if (topics.length > 0 && metrics.length >= 2) {
      const topic = this.formatTopicName(topics[0]);
      const metric1 = this.formatMetricName(metrics[0]);
      const metric2 = this.formatMetricName(metrics[1]);
      return `${topic} ${metric1} and ${metric2}`;
    }

    // Priority 4: Topic + Service (e.g., "Payment Checkout Issues")
    if (topics.length > 0 && services.length > 0) {
      const topic = this.formatTopicName(topics[0]);
      const service = this.formatServiceName(services[0]).split(" ")[0];
      return `${topic} ${service} Issues`;
    }

    // Priority 5: Topic + Metric (e.g., "Payment Timeout Issues")
    if (topics.length > 0 && metrics.length > 0) {
      const topic = this.formatTopicName(topics[0]);
      const metric = this.formatMetricName(metrics[0]);
      return `${topic} ${metric} Issues`;
    }

    // Priority 6: Topic + Problems/Issues (e.g., "Payment Service Issues")
    if (topics.length > 0 && /problem|issue|error|fail/i.test(userMessage)) {
      const topic = this.formatTopicName(topics[0]);
      return `${topic} Service Issues`;
    }

    // Priority 7: Topic + Intent (e.g., "Payment Investigation")
    if (topics.length > 0 && intent) {
      const topic = this.formatTopicName(topics[0]);
      const intentLabel = this.getIntentLabel(intent);
      return `${topic} ${intentLabel}`;
    }

    // Priority 8: Incident + Service + Metric (most descriptive)
    if (incidents.length > 0 && services.length > 0 && metrics.length > 0) {
      const service = this.formatServiceName(services[0]);
      const metric = this.formatMetricName(metrics[0]);
      return `${service} ${metric} Issue`;
    }

    // Priority 9: Incident + Service
    if (incidents.length > 0 && services.length > 0) {
      const service = this.formatServiceName(services[0]);
      return `${service} Incident`;
    }

    // Priority 10: Incident + Metric
    if (incidents.length > 0 && metrics.length > 0) {
      const metric = this.formatMetricName(metrics[0]);
      return `${metric} Incident`;
    }

    // Priority 11: Service + Metric + Intent
    if (services.length > 0 && metrics.length > 0 && intent) {
      const service = this.formatServiceName(services[0]);
      const metric = this.formatMetricName(metrics[0]);
      const intentLabel = this.getIntentLabel(intent);
      return `${service} ${metric} ${intentLabel}`;
    }

    // Priority 12: Metric Correlation
    if (metrics.length >= 2 && intent === "correlation") {
      const metric1 = this.formatMetricName(metrics[0]);
      const metric2 = this.formatMetricName(metrics[1]);
      return `${metric1} and ${metric2} Correlation`;
    }

    // Priority 13: Service + Intent
    if (services.length > 0 && intent) {
      const service = this.formatServiceName(services[0]);
      const intentLabel = this.getIntentLabel(intent);
      return `${service} ${intentLabel}`;
    }

    // Priority 14: Service + Metric (no intent)
    if (services.length > 0 && metrics.length > 0) {
      const service = this.formatServiceName(services[0]);
      const metric = this.formatMetricName(metrics[0]);
      return `${service} ${metric}`;
    }

    // Priority 15: Topic Only (e.g., "Payment Analysis")
    if (topics.length > 0) {
      const topic = this.formatTopicName(topics[0]);
      return `${topic} Analysis`;
    }

    // Priority 16: Service Only
    if (services.length > 0) {
      const service = this.formatServiceName(services[0]);
      return `${service} Analysis`;
    }

    // Priority 17: Metric + Time Range
    if (metrics.length > 0 && timeRanges.length > 0) {
      const metric = this.formatMetricName(metrics[0]);
      const timeRange = timeRanges[0];
      return `${metric} (${timeRange})`;
    }

    // Priority 18: Metric Only
    if (metrics.length > 0) {
      const metric = this.formatMetricName(metrics[0]);
      return `${metric} Analysis`;
    }

    // Priority 19: Intent + Topic
    if (intent) {
      const intentLabel = this.getIntentLabel(intent);
      return intentLabel;
    }

    // Priority 20: Incident Only (last resort - just use the ID)
    if (incidents.length > 0) {
      return incidents[0];
    }

    // No synthesis possible
    return "";
  }

  private formatTopicName(topic: string): string {
    // Convert "payment" to "Payment", "checkout" to "Checkout"
    return topic.charAt(0).toUpperCase() + topic.slice(1);
  }

  private formatServiceName(service: string): string {
    // Convert "payment-service" to "Payment Service"
    return service
      .split("-")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
  }

  private formatMetricName(metric: string): string {
    // Convert "cpu" to "CPU", "p95" to "P95", etc.
    const upper = metric.toUpperCase();
    if (
      upper === "CPU" ||
      upper === "P95" ||
      upper === "P99" ||
      upper === "P50"
    ) {
      return upper;
    }
    return metric.charAt(0).toUpperCase() + metric.slice(1);
  }

  private getIntentLabel(intent: string): string {
    const labels: Record<string, string> = {
      "root-cause": "Root Cause",
      investigation: "Investigation",
      correlation: "Correlation",
      "status-check": "Status Check",
      troubleshooting: "Troubleshooting",
    };
    return labels[intent] || "Analysis";
  }

  /**
   * Create a fallback name from message preview.
   */
  private createFallbackName(userMessage: string, timestamp: number): string {
    if (!userMessage || userMessage.trim().length === 0) {
      // Use timestamp-based name
      const date = new Date(timestamp);
      const formatted = date.toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
      return `General Query (${formatted})`;
    }

    // Take first 40 characters and apply title case
    const preview = userMessage.slice(0, 40).trim();
    const titleCased = this.toTitleCase(preview);

    // Add ellipsis if truncated
    if (userMessage.length > 40) {
      return `${titleCased}...`;
    }

    return titleCased;
  }

  /**
   * Sanitize and truncate the generated name.
   */
  private sanitizeName(name: string): string {
    // Remove newlines and control characters
    let sanitized = name.replace(/[\n\r\t]/g, " ");

    // Replace multiple spaces with single space
    sanitized = sanitized.replace(/\s+/g, " ").trim();

    // Truncate to maxLength if needed
    if (sanitized.length > this.config.maxLength) {
      // Find a good break point (space) near the limit
      const truncated = sanitized.slice(0, this.config.maxLength - 3);
      const lastSpace = truncated.lastIndexOf(" ");

      if (lastSpace > this.config.maxLength * 0.7) {
        // Use the space if it's not too far back
        return truncated.slice(0, lastSpace) + "...";
      } else {
        // Just truncate at the limit
        return truncated + "...";
      }
    }

    return sanitized;
  }

  /**
   * Convert to title case.
   */
  private toTitleCase(text: string): string {
    const smallWords = new Set([
      "a",
      "an",
      "and",
      "as",
      "at",
      "but",
      "by",
      "for",
      "in",
      "of",
      "on",
      "or",
      "the",
      "to",
      "with",
    ]);

    return text
      .toLowerCase()
      .split(" ")
      .map((word, index) => {
        // Always capitalize first word
        if (index === 0) {
          return word.charAt(0).toUpperCase() + word.slice(1);
        }
        // Don't capitalize small words unless they're first
        if (smallWords.has(word)) {
          return word;
        }
        // Capitalize everything else
        return word.charAt(0).toUpperCase() + word.slice(1);
      })
      .join(" ");
  }
}
