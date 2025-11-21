import { ToolResult } from '../types.js';

/**
 * Represents an entity extracted from tool results or conversation
 */
export interface Entity {
  type: 'incident' | 'service' | 'timestamp' | 'ticket';
  value: string;
  extractedAt: number; // timestamp when extracted
  source: string; // tool name that provided it
}

/**
 * Conversation context containing extracted entities
 */
export interface ConversationContext {
  entities: Map<string, Entity[]>; // type -> entities
  chatId: string;
}

/**
 * EntityExtractor extracts and resolves entity references from tool results
 * and user questions to enable natural conversation flow.
 */
export class EntityExtractor {
  /**
   * Extract entities from tool results
   */
  extractFromResults(results: ToolResult[]): Entity[] {
    const entities: Entity[] = [];
    const now = Date.now();

    for (const result of results) {
      // Extract incident IDs
      const incidentIds = this.extractIncidentIds(result.result);
      for (const id of incidentIds) {
        entities.push({
          type: 'incident',
          value: id,
          extractedAt: now,
          source: result.name,
        });
      }

      // Extract service names
      const services = this.extractServices(result.result);
      for (const service of services) {
        entities.push({
          type: 'service',
          value: service,
          extractedAt: now,
          source: result.name,
        });
      }

      // Extract timestamps
      const timestamps = this.extractTimestamps(result.result);
      for (const timestamp of timestamps) {
        entities.push({
          type: 'timestamp',
          value: timestamp,
          extractedAt: now,
          source: result.name,
        });
      }

      // Extract ticket IDs
      const ticketIds = this.extractTicketIds(result.result);
      for (const id of ticketIds) {
        entities.push({
          type: 'ticket',
          value: id,
          extractedAt: now,
          source: result.name,
        });
      }
    }

    return entities;
  }

  /**
   * Resolve references in user question to actual entity values
   */
  resolveReference(
    question: string,
    context: ConversationContext
  ): Map<string, string> {
    const resolutions = new Map<string, string>();
    const normalized = question.toLowerCase();

    // Resolve incident references
    if (this.hasIncidentReference(normalized)) {
      const incident = this.getMostRecentEntity(context, 'incident');
      if (incident) {
        resolutions.set('{{incident}}', incident.value);
        resolutions.set('that incident', incident.value);
        resolutions.set('this incident', incident.value);
        resolutions.set('the incident', incident.value);
      }
    }

    // Resolve service references
    if (this.hasServiceReference(normalized)) {
      const service = this.getMostRecentEntity(context, 'service');
      if (service) {
        resolutions.set('{{service}}', service.value);
        resolutions.set('that service', service.value);
        resolutions.set('this service', service.value);
        resolutions.set('the service', service.value);
      }
    }

    // Resolve time references
    if (this.hasTimeReference(normalized)) {
      const timestamp = this.getMostRecentEntity(context, 'timestamp');
      if (timestamp) {
        const resolvedTime = this.resolveTimeReference(normalized, timestamp.value);
        if (resolvedTime) {
          resolutions.set('{{time}}', resolvedTime);
          resolutions.set('since then', resolvedTime);
          resolutions.set('after that', resolvedTime);
          resolutions.set('before that', resolvedTime);
        }
      }
    }

    // Resolve ticket references
    if (this.hasTicketReference(normalized)) {
      const ticket = this.getMostRecentEntity(context, 'ticket');
      if (ticket) {
        resolutions.set('{{ticket}}', ticket.value);
        resolutions.set('that ticket', ticket.value);
        resolutions.set('this ticket', ticket.value);
        resolutions.set('the ticket', ticket.value);
      }
    }

    return resolutions;
  }

  /**
   * Apply resolutions to question text
   */
  applyResolutions(
    question: string,
    resolutions: Map<string, string>
  ): string {
    let resolved = question;

    for (const [placeholder, value] of resolutions.entries()) {
      // Case-insensitive replacement
      const regex = new RegExp(placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      resolved = resolved.replace(regex, value);
    }

    return resolved;
  }

  /**
   * Extract incident IDs from result payload
   */
  private extractIncidentIds(payload: any): string[] {
    const ids = new Set<string>();
    this.traversePayload(payload, (value, key) => {
      if (
        (key === 'id' || key === 'incidentId' || key === 'incident_id') &&
        typeof value === 'string' &&
        this.looksLikeIncidentId(value)
      ) {
        ids.add(value);
      }
    });
    return Array.from(ids);
  }

  /**
   * Extract service names from result payload
   */
  private extractServices(payload: any): string[] {
    const services = new Set<string>();
    this.traversePayload(payload, (value, key) => {
      if (
        (key === 'service' ||
          key === 'serviceName' ||
          key === 'service_name' ||
          key === 'serviceId' ||
          key === 'service_id') &&
        typeof value === 'string' &&
        value.trim()
      ) {
        services.add(value.trim());
      }
    });
    return Array.from(services);
  }

  /**
   * Extract ISO timestamps from result payload
   */
  private extractTimestamps(payload: any): string[] {
    const timestamps = new Set<string>();
    this.traversePayload(payload, (value, key) => {
      if (
        (key === 'timestamp' ||
          key === 'startTime' ||
          key === 'start_time' ||
          key === 'endTime' ||
          key === 'end_time' ||
          key === 'createdAt' ||
          key === 'created_at' ||
          key === 'at') &&
        typeof value === 'string' &&
        this.isIsoTimestamp(value)
      ) {
        timestamps.add(value);
      }
    });
    return Array.from(timestamps).slice(0, 5); // Limit to 5 most recent
  }

  /**
   * Extract ticket IDs from result payload
   */
  private extractTicketIds(payload: any): string[] {
    const ids = new Set<string>();
    this.traversePayload(payload, (value, key) => {
      if (
        (key === 'ticketId' || key === 'ticket_id' || key === 'id') &&
        typeof value === 'string' &&
        this.looksLikeTicketId(value)
      ) {
        ids.add(value);
      }
    });
    return Array.from(ids);
  }

  /**
   * Traverse payload and call visitor for each value
   */
  private traversePayload(
    payload: any,
    visitor: (value: any, key?: string) => void,
    depth = 0
  ): void {
    if (depth > 10) return; // Prevent infinite recursion

    if (Array.isArray(payload)) {
      for (const item of payload) {
        this.traversePayload(item, visitor, depth + 1);
      }
    } else if (payload && typeof payload === 'object') {
      for (const [key, value] of Object.entries(payload)) {
        visitor(value, key);
        if (typeof value === 'object') {
          this.traversePayload(value, visitor, depth + 1);
        }
      }
    }
  }

  /**
   * Check if value looks like an incident ID
   */
  private looksLikeIncidentId(value: string): boolean {
    // Match patterns like: INC-123, INCIDENT-456, inc_789
    return /^(INC|INCIDENT|inc)[_-]?\d+$/i.test(value);
  }

  /**
   * Check if value looks like a ticket ID
   */
  private looksLikeTicketId(value: string): boolean {
    // Match patterns like: TICKET-123, TKT-456, JIRA-789
    return /^(TICKET|TKT|JIRA|ticket|tkt)[_-]?\d+$/i.test(value);
  }

  /**
   * Check if value is an ISO timestamp
   */
  private isIsoTimestamp(value: string): boolean {
    return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value);
  }

  /**
   * Check if question has incident reference
   */
  private hasIncidentReference(question: string): boolean {
    return /(that|this|the) incident/i.test(question);
  }

  /**
   * Check if question has service reference
   */
  private hasServiceReference(question: string): boolean {
    return /(that|this|the) service/i.test(question);
  }

  /**
   * Check if question has time reference
   */
  private hasTimeReference(question: string): boolean {
    return /(since then|after that|before that|around that time)/i.test(question);
  }

  /**
   * Check if question has ticket reference
   */
  private hasTicketReference(question: string): boolean {
    return /(that|this|the) ticket/i.test(question);
  }

  /**
   * Get most recent entity of a given type
   */
  private getMostRecentEntity(
    context: ConversationContext,
    type: Entity['type']
  ): Entity | undefined {
    const entities = context.entities.get(type);
    if (!entities || entities.length === 0) return undefined;

    // Return most recently extracted entity
    return entities.reduce((latest, current) =>
      current.extractedAt > latest.extractedAt ? current : latest
    );
  }

  /**
   * Resolve time reference relative to a timestamp
   */
  private resolveTimeReference(
    question: string,
    baseTimestamp: string
  ): string | undefined {
    try {
      const baseTime = new Date(baseTimestamp).getTime();

      if (/since then|after that/i.test(question)) {
        // Return the base timestamp as the start time
        return baseTimestamp;
      }

      if (/before that/i.test(question)) {
        // Return a time before the base timestamp (e.g., 1 hour before)
        const beforeTime = new Date(baseTime - 60 * 60 * 1000);
        return beforeTime.toISOString();
      }

      return baseTimestamp;
    } catch {
      return undefined;
    }
  }
}
