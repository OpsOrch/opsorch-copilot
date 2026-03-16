import type { FollowUpHandler } from "../handlers.js";
import type { ToolCall, JsonObject, JsonValue, HandlerContext } from "../../../types.js";
import { HandlerUtils } from "../utils.js";

const ORCHESTRATION_STOP_WORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "for",
  "with",
  "from",
  "into",
  "onto",
  "that",
  "this",
  "these",
  "those",
  "what",
  "when",
  "where",
  "which",
  "who",
  "why",
  "how",
  "please",
  "check",
  "show",
  "find",
  "look",
  "need",
  "more",
  "details",
  "incident",
  "incidents",
  "issue",
  "issues",
  "alert",
  "alerts",
  "error",
  "errors",
  "failed",
  "failing",
  "failure",
  "failures",
  "service",
  "services",
  "plan",
  "plans",
  "orchestration",
  "response",
]);

const ORCHESTRATION_KEY_FIELDS = [
  "title",
  "name",
  "summary",
  "description",
  "severity",
  "status",
  "state",
  "type",
  "category",
  "kind",
  "source",
  "component",
  "operation",
  "reason",
  "metricName",
  "metric",
  "signal",
  "condition",
  "runbook",
] as const;

class SuggestionTracker {
  private seen = new Set<string>();
  private context: HandlerContext;

  constructor(context: HandlerContext) {
    this.context = context;
  }

  add(call: ToolCall): boolean {
    const scope = call.arguments?.scope as JsonObject | undefined;
    const service = (scope?.service as string) ?? "_no_service_";
    const key = `${call.name}:${service}`;

    if (this.seen.has(key)) {
      return false;
    }

    if (service !== "_no_service_") {
      if (HandlerUtils.isDuplicateToolCall(this.context, call.name, service)) {
        return false;
      }
    }

    this.seen.add(key);
    return true;
  }

  filter(calls: ToolCall[]): ToolCall[] {
    return calls.filter((call) => this.add(call));
  }
}

const isRecord = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const collectAllRecordsDeep = (value: JsonValue): JsonObject[] => {
  const records: JsonObject[] = [];

  const traverse = (current: JsonValue) => {
    if (Array.isArray(current)) {
      for (const item of current) {
        traverse(item);
      }
    } else if (isRecord(current)) {
      records.push(current);
      for (const key in current) {
        if (Object.prototype.hasOwnProperty.call(current, key)) {
          traverse(current[key]);
        }
      }
    }
  };

  traverse(value);
  return records;
};

const addService = (services: Set<string>, value: unknown): void => {
  if (typeof value === "string" && value.trim()) {
    services.add(value);
  }
};

const collectServicesFromResult = (result: JsonValue, fields: string[]): Set<string> => {
  const services = new Set<string>();
  const records = collectAllRecordsDeep(result);

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

const addKeywordsFromText = (
  text: unknown,
  sink: string[],
  seen: Set<string>,
  limit: number,
): void => {
  if (typeof text !== "string" || !text.trim()) {
    return;
  }

  const matches = text.toLowerCase().match(/[a-z0-9][a-z0-9._:-]*/g) ?? [];
  for (const match of matches) {
    const normalized = match.replace(/^[_:.-]+|[_:.-]+$/g, "");
    if (
      normalized.length < 3 ||
      ORCHESTRATION_STOP_WORDS.has(normalized) ||
      seen.has(normalized)
    ) {
      continue;
    }

    seen.add(normalized);
    sink.push(normalized);

    if (sink.length >= limit) {
      return;
    }
  }
};

const addKeywordsFromRecord = (
  record: JsonObject,
  fields: readonly string[],
  sink: string[],
  seen: Set<string>,
  limit: number,
): void => {
  for (const field of fields) {
    if (sink.length >= limit) {
      return;
    }

    const value = record[field];
    if (typeof value === "string") {
      addKeywordsFromText(value, sink, seen, limit);
      continue;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        if (sink.length >= limit) {
          return;
        }
        addKeywordsFromText(item, sink, seen, limit);
      }
      continue;
    }

    if (isRecord(value)) {
      for (const nestedValue of Object.values(value)) {
        if (sink.length >= limit) {
          return;
        }
        addKeywordsFromText(nestedValue, sink, seen, limit);
      }
    }
  }
};

const buildOrchestrationQuery = (
  userQuestion: string,
  records: JsonObject[],
  extraTexts: unknown[] = [],
): string => {
  const keywords: string[] = [];
  const seen = new Set<string>();

  addKeywordsFromText(userQuestion, keywords, seen, 5);

  for (const text of extraTexts) {
    if (keywords.length >= 10) {
      break;
    }
    addKeywordsFromText(text, keywords, seen, 10);
  }

  for (const record of records) {
    if (keywords.length >= 12) {
      break;
    }
    addKeywordsFromRecord(record, ORCHESTRATION_KEY_FIELDS, keywords, seen, 12);
  }

  return keywords.join(" ").trim() || "incident response";
};

export const orchestrationFollowUpHandler: FollowUpHandler = async (
  context,
  toolResult,
): Promise<ToolCall[]> => {
  const followUps: ToolCall[] = [];
  const result = toolResult.result;
  const tracker = new SuggestionTracker(context);

  if (toolResult.name === "query-orchestration-plans") {
    const plans = collectAllRecordsDeep(result);
    const validPlans = plans.filter(p => typeof p.id === "string" && p.id && (p.title || p.name || p.description));
    const plansToUse = validPlans.length > 0 ? validPlans : plans.filter(p => typeof p.id === "string" && p.id);
    const uniquePlanIds = new Set<string>();
    
    for (const plan of plansToUse) {
       if(uniquePlanIds.size >= 3) break;
       const planId = plan.id as string;
       if(!uniquePlanIds.has(planId)){
         uniquePlanIds.add(planId);
         followUps.push({
           name: "get-orchestration-plan",
           arguments: { id: planId },
         });
       }
    }
    return tracker.filter(followUps);
  }

  const services = new Set<string>();
  const serviceFromScope = collectServiceFromScope(context, toolResult);
  if (serviceFromScope) {
    services.add(serviceFromScope);
  }

  if (toolResult.name === "query-incidents" || toolResult.name === "get-incident") {
    const records = collectAllRecordsDeep(result);
    const servicesFromRecords = new Set<string>();
    records.forEach(r => addService(servicesFromRecords, r["service"]));
    servicesFromRecords.forEach((service) => services.add(service));

    const firstIncidentWithTitle = records.find(r => typeof r.title === "string" && r.title);
    const queryContext = buildOrchestrationQuery(
      context.userQuestion,
      records,
      [firstIncidentWithTitle?.title],
    );
    
    if (servicesFromRecords.size > 0 || serviceFromScope) {
      const targetService = (servicesFromRecords.values().next().value || serviceFromScope) as string;

      followUps.push({
        name: "query-orchestration-plans",
        arguments: {
           scope: { service: targetService },
           query: queryContext
        },
      });
    } else if (records.length > 0) {
       followUps.push({
         name: "query-orchestration-plans",
         arguments: {
            query: queryContext
         },
       });
    }
  }

  if (toolResult.name === "query-alerts" || toolResult.name === "get-alert") {
    const records = collectAllRecordsDeep(result);
    const servicesFromRecords = new Set<string>();
    records.forEach(r => addService(servicesFromRecords, r["service"]));
    servicesFromRecords.forEach((service) => services.add(service));

    const firstAlert = records.find(r => (typeof r.name === "string" && r.name) || (typeof r.description === "string" && r.description));
    const titleOrDesc = firstAlert?.name || firstAlert?.description;
    const queryContext = buildOrchestrationQuery(
      context.userQuestion,
      records,
      [titleOrDesc],
    );

    if (servicesFromRecords.size > 0 || serviceFromScope) {
       const targetService = (servicesFromRecords.values().next().value || serviceFromScope) as string;
       
       followUps.push({
        name: "query-orchestration-plans",
        arguments: {
           scope: { service: targetService },
           query: queryContext
        },
      });
    }
  }

  if (toolResult.name === "query-services" || toolResult.name === "get-service") {
    const servicesFromResults = collectServicesFromResult(result, ["name", "id"]);
    servicesFromResults.forEach((service) => services.add(service));
  }

  if (services.size > 0) {
    const uniqueServices = [...services].slice(0, 3);
    for (const service of uniqueServices) {
      const alreadyHasQuery = followUps.some(f => f.name === "query-orchestration-plans" && (f.arguments?.scope as JsonObject)?.service === service);
      if (alreadyHasQuery) {
         continue;
      }

      const args: JsonObject = {
        scope: { service }
      };

      const combinedQuery = buildOrchestrationQuery(context.userQuestion, []);
      if (combinedQuery.trim()) {
         args.query = combinedQuery;
      }

      followUps.push({
        name: "query-orchestration-plans",
        arguments: args,
      });
    }
  }

  return tracker.filter(followUps);
};
