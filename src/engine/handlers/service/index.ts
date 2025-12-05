/**
 * Service Domain Handlers
 *
 * This module exports all handlers for service-related operations.
 * Includes intent classification, entity extraction, follow-up suggestions,
 * reference resolution, validation, scope inference, service discovery, matching, and query building.
 */

export { serviceIntentHandler } from "./intentHandler.js";
export { serviceEntityHandler } from "./entityHandler.js";
export { serviceFollowUpHandler } from "./followUpHandler.js";
export { serviceReferenceHandler } from "./referenceHandler.js";
export { serviceValidationHandler } from "./validationHandler.js";
export { serviceScopeInferenceHandler } from "./scopeHandler.js";
export { serviceDiscoveryHandler } from "./discoveryHandler.js";
export { serviceMatchingHandler } from "./matchingHandler.js";
export { serviceQueryBuilder } from "./queryBuilder.js";

