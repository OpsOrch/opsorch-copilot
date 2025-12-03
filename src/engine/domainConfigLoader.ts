import { domainRegistry } from './domainRegistry.js';
import {
  alertDomain,
  incidentDomain,
  metricDomain,
  logDomain,
  serviceDomain,
  ticketDomain,
} from './domains/index.js';
import type { DomainConfig } from '../types.js';

/**
 * Domain configuration loader
 * Loads and validates domain configurations into the registry
 */
export class DomainConfigLoader {
  /**
   * Load all built-in domain configurations
   */
  loadBuiltInDomains(): void {
    const domains: DomainConfig[] = [
      alertDomain,
      incidentDomain,
      metricDomain,
      logDomain,
      serviceDomain,
      ticketDomain,
    ];

    for (const domain of domains) {
      try {
        this.validateDomain(domain);
        domainRegistry.register(domain);
      } catch (error) {
        throw new Error(
          `Failed to load domain '${domain.name}': ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  }

  /**
   * Validate a domain configuration
   */
  private validateDomain(domain: DomainConfig): void {
    // Check required fields
    if (!domain.name || typeof domain.name !== 'string') {
      throw new Error('Domain must have a valid name');
    }

    if (!domain.version || typeof domain.version !== 'string') {
      throw new Error(`Domain '${domain.name}' must have a valid version`);
    }

    if (!Array.isArray(domain.toolPatterns) || domain.toolPatterns.length === 0) {
      throw new Error(`Domain '${domain.name}' must have at least one tool pattern`);
    }

    if (!Array.isArray(domain.entities) || domain.entities.length === 0) {
      throw new Error(`Domain '${domain.name}' must have at least one entity configuration`);
    }

    if (!Array.isArray(domain.references)) {
      throw new Error(`Domain '${domain.name}' must have a references array (can be empty)`);
    }

    // Validate tool patterns
    for (const pattern of domain.toolPatterns) {
      if (!pattern.match || typeof pattern.match !== 'string') {
        throw new Error(`Domain '${domain.name}' has invalid tool pattern: missing match`);
      }

      if (!['exact', 'glob', 'regex'].includes(pattern.type)) {
        throw new Error(
          `Domain '${domain.name}' has invalid tool pattern type: ${pattern.type}`
        );
      }
    }

    // Validate entities
    for (const entity of domain.entities) {
      if (!entity.type || typeof entity.type !== 'string') {
        throw new Error(`Domain '${domain.name}' has entity without type`);
      }

      if (!Array.isArray(entity.idPaths) || entity.idPaths.length === 0) {
        throw new Error(
          `Domain '${domain.name}' entity '${entity.type}' must have at least one idPath`
        );
      }
    }

    // Validate references
    for (const ref of domain.references) {
      if (!ref.pattern || typeof ref.pattern !== 'string') {
        throw new Error(`Domain '${domain.name}' has reference without pattern`);
      }

      if (!ref.entityType || typeof ref.entityType !== 'string') {
        throw new Error(`Domain '${domain.name}' has reference without entityType`);
      }
    }
  }

  /**
   * Get statistics about loaded domains
   */
  getStats() {
    return domainRegistry.getStats();
  }
}

/**
 * Global singleton instance
 */
export const domainConfigLoader = new DomainConfigLoader();

/**
 * Initialize domains on module load
 */
domainConfigLoader.loadBuiltInDomains();
