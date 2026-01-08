import type { FollowUpHandler } from "../handlers.js";
import type { ToolCall, JsonObject, JsonValue, HandlerContext } from "../../../types.js";
import { HandlerUtils } from "../utils.js";

const isRecord = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const collectPlanObjects = (result: JsonValue): JsonObject[] => {
  if (Array.isArray(result)) {
    return result.filter(isRecord);
  }

  if (isRecord(result)) {
    if (Array.isArray(result.plans)) {
      return result.plans.filter(isRecord);
    }
    if (Array.isArray(result.items)) {
      return result.items.filter(isRecord);
    }
    return [result];
  }

  return [];
};

const addService = (services: Set<string>, value: unknown): void => {
  if (typeof value === "string" && value.trim()) {
    services.add(value);
  }
};

const collectServicesFromResult = (result: JsonValue, fields: string[]): Set<string> => {
  const services = new Set<string>();
  const records = collectPlanObjects(result);

  for (const record of records) {
    for (const field of fields) {
      addService(services, record[field]);
    }
  }

  return services;
};

const collectServiceFromScope = (context: HandlerContext, toolResult: { arguments?: JsonObject }): string | null => {
  const scope = toolResult.arguments?.scope as JsonObject | undefined;
  const service = scope?.service;

  if (typeof service !== "string" || !service.trim()) {
    return null;
  }

  if (HandlerUtils.isDuplicateToolCall(context, "query-orchestration-plans", service)) {
    return null;
  }

  return service;
};

export const orchestrationFollowUpHandler: FollowUpHandler = async (
  context,
  toolResult,
): Promise<ToolCall[]> => {
  const followUps: ToolCall[] = [];
  const result = toolResult.result;

  if (toolResult.name === "query-orchestration-plans") {
    const plans = collectPlanObjects(result);
    for (const plan of plans.slice(0, 3)) {
      if (typeof plan.id !== "string" || !plan.id) continue;
      followUps.push({
        name: "get-orchestration-plan",
        arguments: { id: plan.id },
      });
    }
    return followUps;
  }

  const services = new Set<string>();
  const serviceFromScope = collectServiceFromScope(context, toolResult);
  if (serviceFromScope) {
    services.add(serviceFromScope);
  }

  if (toolResult.name === "query-incidents" || toolResult.name === "query-alerts") {
    const servicesFromResults = collectServicesFromResult(result, ["service"]);
    servicesFromResults.forEach((service) => services.add(service));
  }

  if (toolResult.name === "query-services" || toolResult.name === "get-service") {
    const servicesFromResults = collectServicesFromResult(result, ["name", "id"]);
    servicesFromResults.forEach((service) => services.add(service));
  }

  if (services.size > 0) {
    const uniqueServices = [...services].slice(0, 3);
    for (const service of uniqueServices) {
      if (HandlerUtils.isDuplicateToolCall(context, "query-orchestration-plans", service)) {
        continue;
      }
      followUps.push({
        name: "query-orchestration-plans",
        arguments: {
          scope: { service },
        },
      });
    }
    return followUps;
  }

  if (toolResult.name === "query-incidents" && Array.isArray(result) && result.length > 0) {
    followUps.push({
      name: "query-orchestration-plans",
      arguments: {
        query: "incident response",
      },
    });
  }

  return followUps;
};
