import {
  IntentRegistry,
  EntityRegistry,
  FollowUpRegistry,
  ReferenceRegistry,
  ValidationRegistry,
  ScopeInferenceRegistry,
  AnomalyRegistry,
  ServiceDiscoveryRegistry,
  ServiceMatchingRegistry,
  CorrelationRegistry,
  QueryBuilderRegistry,
} from "./handlers/registries.js";
// Import all handlers from the new handler structure
import {
  // Intent handlers
  incidentIntentHandler,
  alertIntentHandler,
  logIntentHandler,
  metricIntentHandler,
  serviceIntentHandler,
  ticketIntentHandler,
  deploymentIntentHandler,
  teamIntentHandler,
  // Entity handlers
  incidentEntityHandler,
  alertEntityHandler,
  logEntityHandler,
  metricEntityHandler,
  serviceEntityHandler,
  ticketEntityHandler,
  deploymentEntityHandler,
  teamEntityHandler,
  // Follow-up handlers
  incidentFollowUpHandler,
  alertFollowUpHandler,
  logFollowUpHandler,
  metricFollowUpHandler,
  serviceFollowUpHandler,
  ticketFollowUpHandler,
  deploymentFollowUpHandler,
  teamFollowUpHandler,
  // Reference handlers
  incidentReferenceHandler,
  serviceReferenceHandler,
  ticketReferenceHandler,
  timestampReferenceHandler,
  teamReferenceHandler,
  // Validation handlers
  incidentValidationHandler,
  alertValidationHandler,
  logValidationHandler,
  metricValidationHandler,
  serviceValidationHandler,
  ticketValidationHandler,
  deploymentValidationHandler,
  teamValidationHandler,
  // Scope inference handlers
  incidentScopeInferenceHandler,
  alertScopeInferenceHandler,
  logScopeInferenceHandler,
  metricScopeInferenceHandler,
  serviceScopeInferenceHandler,
  ticketScopeInferenceHandler,
  deploymentScopeHandler,
  // New handlers
  metricAnomalyHandler,
  metricCorrelationHandler,
  incidentCorrelationHandler,
  logCorrelationHandler,
  serviceDiscoveryHandler,
  serviceMatchingHandler,
  // Query builders
  logQueryBuilder,
  metricQueryBuilder,
  alertQueryBuilder,
  incidentQueryBuilder,
  ticketQueryBuilder,
  serviceQueryBuilder,
  deploymentQueryBuilder,
  teamQueryBuilder,
} from "./handlers/index.js";

/**
 * Initialize and configure the global intent registry with all capability handlers.
 * This should be called during application bootstrap.
 */
function createIntentRegistry(): IntentRegistry {
  const registry = new IntentRegistry();

  // Register all capability intent handlers
  registry.register(incidentIntentHandler);
  registry.register(metricIntentHandler);
  registry.register(logIntentHandler);
  registry.register(alertIntentHandler);
  registry.register(ticketIntentHandler);
  registry.register(serviceIntentHandler);
  registry.register(deploymentIntentHandler);
  registry.register(teamIntentHandler);

  console.log("[IntentRegistry] Registered 8 capability intent handlers");

  return registry;
}

/**
 * Initialize and configure the global entity registry with capability handlers.
 */
function createEntityRegistry(): EntityRegistry {
  const registry = new EntityRegistry();

  // Register entity handlers for different tools based on domain configurations
  registry.register("query-incidents", incidentEntityHandler);
  registry.register("get-incident", incidentEntityHandler);
  registry.register("get-incident-timeline", incidentEntityHandler);

  registry.register("query-alerts", alertEntityHandler);

  registry.register("query-services", serviceEntityHandler);
  registry.register("get-service", serviceEntityHandler);

  registry.register("query-logs", logEntityHandler);

  registry.register("query-metrics", metricEntityHandler);

  registry.register("query-tickets", ticketEntityHandler);
  registry.register("get-ticket", ticketEntityHandler);

  registry.register("query-deployments", deploymentEntityHandler);
  registry.register("get-deployment", deploymentEntityHandler);

  registry.register("query-teams", teamEntityHandler);
  registry.register("get-team", teamEntityHandler);
  registry.register("get-team-members", teamEntityHandler);

  console.log(
    "[EntityRegistry] Registered 15 entity handlers for 8 capabilities",
  );

  return registry;
}

/**
 * Initialize and configure the global follow-up registry with capability handlers.
 */
function createFollowUpRegistry(): FollowUpRegistry {
  const registry = new FollowUpRegistry();

  // Register follow-up handlers for different tools based on domain configurations
  registry.register("query-incidents", incidentFollowUpHandler);
  registry.register("get-incident", incidentFollowUpHandler);
  registry.register("get-incident-timeline", incidentFollowUpHandler);

  registry.register("query-alerts", alertFollowUpHandler);

  registry.register("query-services", serviceFollowUpHandler);
  registry.register("get-service", serviceFollowUpHandler);

  registry.register("query-logs", logFollowUpHandler);

  registry.register("query-metrics", metricFollowUpHandler);

  registry.register("query-tickets", ticketFollowUpHandler);
  registry.register("get-ticket", ticketFollowUpHandler);
  registry.register("query-deployments", deploymentFollowUpHandler);
  registry.register("get-deployment", deploymentFollowUpHandler);

  registry.register("query-teams", teamFollowUpHandler);
  registry.register("get-team", teamFollowUpHandler);
  registry.register("get-team-members", teamFollowUpHandler);

  console.log(
    "[FollowUpRegistry] Registered 15 follow-up handlers for 8 capabilities",
  );

  return registry;
}

/**
 * Initialize and configure the global reference registry with capability handlers.
 */
function createReferenceRegistry(): ReferenceRegistry {
  const registry = new ReferenceRegistry();

  // Register reference handlers for different entity types based on domain configurations
  registry.register("incident", incidentReferenceHandler);
  registry.register("service", serviceReferenceHandler);
  registry.register("ticket", ticketReferenceHandler);
  registry.register("timestamp", timestampReferenceHandler);
  registry.register("team", teamReferenceHandler);
  // Note: alert, log, and metric don't have reference handlers in their domain configs

  console.log(
    "[ReferenceRegistry] Registered 5 reference handlers for 5 capabilities",
  );

  return registry;
}

/**
 * Initialize and configure the global validation registry with capability handlers.
 */
function createValidationRegistry(): ValidationRegistry {
  const registry = new ValidationRegistry();

  // Register validation handlers for different tools based on capability configurations
  registry.register("query-incidents", incidentValidationHandler);
  registry.register("get-incident", incidentValidationHandler);
  registry.register("get-incident-timeline", incidentValidationHandler);

  registry.register("query-alerts", alertValidationHandler);

  registry.register("query-services", serviceValidationHandler);
  registry.register("get-service", serviceValidationHandler);

  registry.register("query-logs", logValidationHandler);

  registry.register("query-metrics", metricValidationHandler);

  registry.register("query-tickets", ticketValidationHandler);
  registry.register("get-ticket", ticketValidationHandler);
  registry.register("query-deployments", deploymentValidationHandler);
  registry.register("get-deployment", deploymentValidationHandler);

  registry.register("query-teams", teamValidationHandler);
  registry.register("get-team", teamValidationHandler);
  registry.register("get-team-members", teamValidationHandler);

  console.log(
    "[ValidationRegistry] Registered 15 validation handlers for 8 capabilities",
  );

  return registry;
}

/**
 * Initialize and configure the global scope inference registry with capability handlers.
 */
function createScopeInferenceRegistry(): ScopeInferenceRegistry {
  const registry = new ScopeInferenceRegistry();

  // Register scope inference handlers for each capability
  registry.register("incident", incidentScopeInferenceHandler);
  registry.register("alert", alertScopeInferenceHandler);
  registry.register("service", serviceScopeInferenceHandler);
  registry.register("log", logScopeInferenceHandler);
  registry.register("metric", metricScopeInferenceHandler);
  registry.register("ticket", ticketScopeInferenceHandler);
  registry.register("deployment", deploymentScopeHandler);

  console.log(
    "[ScopeInferenceRegistry] Registered 7 scope inference handlers for 7 capabilities",
  );

  return registry;
}

/**
 * Initialize and configure the global anomaly registry with capability handlers.
 */
function createAnomalyRegistry(): AnomalyRegistry {
  const registry = new AnomalyRegistry();

  // Register anomaly handlers for each capability
  registry.register("metric", metricAnomalyHandler);

  console.log(
    "[AnomalyRegistry] Registered 1 anomaly handler for metric capability",
  );

  return registry;
}

/**
 * Initialize and configure the global service discovery registry.
 */
function createServiceDiscoveryRegistry(): ServiceDiscoveryRegistry {
  const registry = new ServiceDiscoveryRegistry();

  // Register service discovery handler
  registry.register(serviceDiscoveryHandler);

  console.log(
    "[ServiceDiscoveryRegistry] Registered 1 service discovery handler",
  );

  return registry;
}

/**
 * Initialize and configure the global service matching registry.
 */
function createServiceMatchingRegistry(): ServiceMatchingRegistry {
  const registry = new ServiceMatchingRegistry();

  // Register service matching handler
  registry.register(serviceMatchingHandler);

  console.log(
    "[ServiceMatchingRegistry] Registered 1 service matching handler",
  );

  return registry;
}

/**
 * Initialize and configure the global correlation registry with capability handlers.
 */
function createCorrelationRegistry(): CorrelationRegistry {
  const registry = new CorrelationRegistry();

  // Register correlation handlers for different event types
  registry.register("metric_spike", metricCorrelationHandler);
  registry.register("metric_drop", metricCorrelationHandler);
  registry.register("error_burst", logCorrelationHandler);
  registry.register("critical_error", logCorrelationHandler);
  registry.register("incident_created", incidentCorrelationHandler);
  registry.register("severity_change", incidentCorrelationHandler);
  registry.register("status_change", incidentCorrelationHandler);
  registry.register("deploy", incidentCorrelationHandler);

  console.log(
    "[CorrelationRegistry] Registered 8 correlation handlers for 3 capabilities",
  );

  return registry;
}

/**
 * Initialize and configure the global query builder registry.
 */
function createQueryBuilderRegistry(): QueryBuilderRegistry {
  const registry = new QueryBuilderRegistry();

  registry.register("query-logs", logQueryBuilder);
  registry.register("query-metrics", metricQueryBuilder);
  registry.register("query-alerts", alertQueryBuilder);
  registry.register("query-incidents", incidentQueryBuilder);
  registry.register("query-tickets", ticketQueryBuilder);
  registry.register("query-services", serviceQueryBuilder);
  registry.register("query-deployments", deploymentQueryBuilder);
  registry.register("query-teams", teamQueryBuilder);

  console.log(
    "[QueryBuilderRegistry] Registered 8 query builder handlers",
  );

  return registry;
}

/**
 * Global singleton instances of all registries with capability handlers registered.
 */
export const intentRegistry = createIntentRegistry();
export const entityRegistry = createEntityRegistry();
export const followUpRegistry = createFollowUpRegistry();
export const referenceRegistry = createReferenceRegistry();
export const validationRegistry = createValidationRegistry();
export const scopeInferenceRegistry = createScopeInferenceRegistry();
export const anomalyRegistry = createAnomalyRegistry();
export const serviceDiscoveryRegistry = createServiceDiscoveryRegistry();
export const serviceMatchingRegistry = createServiceMatchingRegistry();
export const correlationRegistry = createCorrelationRegistry();
export const queryBuilderRegistry = createQueryBuilderRegistry();
