/**
 * ChatNamer generates human-readable names for conversations using heuristic-based pattern matching.
 * 
 * Uses pattern matching and keyword extraction to create meaningful conversation titles
 * without requiring LLM calls, keeping costs low and performance high.
 */

export interface ChatNamerConfig {
  maxLength: number;
}

const DEFAULT_CONFIG: ChatNamerConfig = {
  maxLength: 60,
};

export class ChatNamer {
  private readonly config: ChatNamerConfig;

  constructor(config: Partial<ChatNamerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Generate a conversation name based on the first user message.
   * Uses heuristics to extract meaningful names.
   */
  generateName(userMessage: string, timestamp: number): string {
    // Apply heuristics in priority order
    const heuristicName = this.applyHeuristics(userMessage);

    // Fall back to message preview if no heuristic matches
    const name = heuristicName || this.createFallbackName(userMessage, timestamp);

    // Sanitize and return
    const sanitized = this.sanitizeName(name);

    console.log(`[ChatNamer] Generated name: "${sanitized}" (heuristic: ${heuristicName ? 'matched' : 'fallback'})`);

    return sanitized;
  }

  /**
   * Apply pattern-based heuristics to extract a name.
   * Returns null if no heuristic matches.
   */
  private applyHeuristics(message: string): string | null {
    // Priority order: service → metric → question type
    return (
      this.extractServiceName(message) ||
      this.extractMetricOrLogQuery(message) ||
      this.extractQuestionType(message) ||
      null
    );
  }

  /**
   * Extract service names (payment-service, checkout-api, etc.)
   */
  private extractServiceName(message: string): string | null {
    // Pattern: service-name, api-name, worker-name, job-name
    const servicePattern = /([a-z][\w-]+)-(service|api|worker|job)\b/i;
    const match = message.match(servicePattern);

    if (!match) {
      return null;
    }

    const serviceName = match[0];
    const formattedName = this.toTitleCase(serviceName.replace(/-/g, ' '));

    // Try to extract action context
    const lowerMessage = message.toLowerCase();

    if (lowerMessage.includes('log')) {
      return `${formattedName} Logs`;
    }
    if (lowerMessage.includes('error') || lowerMessage.includes('5xx') || lowerMessage.includes('fail')) {
      return `${formattedName} Errors`;
    }
    if (lowerMessage.includes('incident')) {
      return `${formattedName} Incidents`;
    }
    if (lowerMessage.includes('metric') || lowerMessage.includes('latency') || lowerMessage.includes('cpu') || lowerMessage.includes('memory')) {
      return `${formattedName} Metrics`;
    }
    if (lowerMessage.includes('deploy')) {
      return `${formattedName} Deployment`;
    }

    // Default: just the service name
    return formattedName;
  }

  /**
   * Extract metric/log queries
   */
  private extractMetricOrLogQuery(message: string): string | null {
    const lowerMessage = message.toLowerCase();

    // Detect correlation patterns
    const correlationPatterns = [
      { pattern: /\b(cpu|memory|latency|disk|network)\s+(vs|versus|and|with)\s+(cpu|memory|latency|disk|network)\b/i, format: 'Correlation' },
      { pattern: /correlat\w*\s+.*?\b(cpu|memory|latency|disk|network)\b/i, format: 'Correlation' },
      { pattern: /\b(cpu|memory|latency|disk|network)\s+correlat/i, format: 'Correlation' },
    ];

    for (const { pattern, format } of correlationPatterns) {
      const match = message.match(pattern);
      if (match) {
        // Extract the metrics mentioned
        const metrics = message.match(/\b(cpu|memory|latency|disk|network|p95|p99|errors?|5xx)\b/gi);
        if (metrics && metrics.length >= 2) {
          const uniqueMetrics = [...new Set(metrics.map(m => this.toTitleCase(m)))];
          return `${uniqueMetrics.slice(0, 2).join(' and ')} ${format}`;
        }
        return `Metric ${format}`;
      }
    }

    // Detect specific metrics
    const metricKeywords = [
      { keywords: ['p95', 'p99', 'percentile'], name: 'Percentile' },
      { keywords: ['latency', 'response time'], name: 'Latency' },
      { keywords: ['cpu'], name: 'CPU' },
      { keywords: ['memory', 'ram'], name: 'Memory' },
      { keywords: ['5xx', '500', 'error'], name: 'Errors' },
      { keywords: ['disk', 'storage'], name: 'Disk' },
      { keywords: ['network', 'bandwidth'], name: 'Network' },
    ];

    for (const { keywords, name } of metricKeywords) {
      if (keywords.some(kw => lowerMessage.includes(kw))) {
        // Check for spike/increase/decrease context
        if (lowerMessage.includes('spike')) {
          return `${name} Spike`;
        }
        if (lowerMessage.includes('increase') || lowerMessage.includes('high')) {
          return `${name} Increase`;
        }
        if (lowerMessage.includes('decrease') || lowerMessage.includes('low')) {
          return `${name} Decrease`;
        }
        if (lowerMessage.includes('anomal')) {
          return `${name} Anomaly`;
        }
        // Default metric query
        return `${name} Analysis`;
      }
    }

    return null;
  }

  /**
   * Extract question type and topic
   */
  private extractQuestionType(message: string): string | null {
    const lowerMessage = message.toLowerCase();

    // Question type patterns with topic extraction
    const patterns = [
      {
        pattern: /what\s+caused\s+(?:the\s+)?(.+?)(?:\?|$)/i,
        format: (topic: string) => `${this.toTitleCase(topic)} Root Cause`,
      },
      {
        pattern: /why\s+(?:is|did|does|was)\s+(.+?)(?:\?|$)/i,
        format: (topic: string) => `${this.toTitleCase(topic)} Investigation`,
      },
      {
        pattern: /show\s+(?:me\s+)?recent\s+(.+?)(?:\?|$)/i,
        format: (topic: string) => `Recent ${this.toTitleCase(topic)}`,
      },
      {
        pattern: /show\s+(?:me\s+)?(.+?)(?:\?|$)/i,
        format: (topic: string) => `${this.toTitleCase(topic)} Query`,
      },
      {
        pattern: /(?:list|find)\s+(.+?)(?:\?|$)/i,
        format: (topic: string) => `${this.toTitleCase(topic)} Search`,
      },
      {
        pattern: /compare\s+(.+?)(?:\?|$)/i,
        format: (topic: string) => `${this.toTitleCase(topic)} Comparison`,
      },
      {
        pattern: /explain\s+(.+?)(?:\?|$)/i,
        format: (topic: string) => `${this.toTitleCase(topic)} Explanation`,
      },
    ];

    for (const { pattern, format } of patterns) {
      const match = message.match(pattern);
      if (match && match[1]) {
        let topic = match[1].trim();
        // Clean up the topic (remove extra words, limit length)
        topic = topic.split(/\s+/).slice(0, 4).join(' ');
        if (topic.length > 30) {
          topic = topic.substring(0, 30);
        }
        return format(topic);
      }
    }

    return null;
  }

  /**
   * Create a fallback name from message preview.
   */
  private createFallbackName(userMessage: string, timestamp: number): string {
    if (!userMessage || userMessage.trim().length === 0) {
      // Empty message - use timestamp
      const date = new Date(timestamp);
      return `Conversation ${date.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit'
      })}`;
    }

    // Take first 40 characters and apply title case
    let preview = userMessage.trim();
    if (preview.length > 40) {
      preview = preview.substring(0, 40);
      // Try to break at word boundary
      const lastSpace = preview.lastIndexOf(' ');
      if (lastSpace > 20) {
        preview = preview.substring(0, lastSpace);
      }
      preview = preview + '...';
    }

    return this.toTitleCase(preview);
  }

  /**
   * Sanitize and truncate the generated name.
   */
  private sanitizeName(name: string): string {
    // Remove newlines and control characters
    let sanitized = name.replace(/[\n\r\t]/g, ' ');

    // Replace multiple spaces with single space
    sanitized = sanitized.replace(/\s+/g, ' ').trim();

    // Truncate to maxLength if needed
    if (sanitized.length > this.config.maxLength) {
      sanitized = sanitized.substring(0, this.config.maxLength - 3);
      // Try to break at word boundary
      const lastSpace = sanitized.lastIndexOf(' ');
      if (lastSpace > this.config.maxLength - 20) {
        sanitized = sanitized.substring(0, lastSpace);
      }
      sanitized = sanitized + '...';
    }

    return sanitized;
  }

  /**
   * Convert to title case.
   */
  private toTitleCase(text: string): string {
    // Words that should stay lowercase (unless first word)
    const lowercase = new Set(['a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'in', 'of', 'on', 'or', 'the', 'to', 'with']);

    return text
      .toLowerCase()
      .split(/\s+/)
      .map((word, index) => {
        // Always capitalize first word
        if (index === 0) {
          return word.charAt(0).toUpperCase() + word.slice(1);
        }
        // Keep lowercase words lowercase unless they're the first word
        if (lowercase.has(word)) {
          return word;
        }
        // Capitalize other words
        return word.charAt(0).toUpperCase() + word.slice(1);
      })
      .join(' ');
  }
}
