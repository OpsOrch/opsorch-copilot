import type { EntityHandler } from "../handlers.js";
import type { Entity, JsonObject } from "../../../types.js";

const isRecord = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const collectPlans = (result: unknown): JsonObject[] => {
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

export const orchestrationEntityHandler: EntityHandler = async (
  _context,
  toolResult,
): Promise<Entity[]> => {
  const entities: Entity[] = [];
  const plans = collectPlans(toolResult.result);

  for (const plan of plans) {
    const id = plan.id;
    if (typeof id !== "string" || !id) continue;

    entities.push({
      type: "orchestration_plan",
      value: id,
      extractedAt: Date.now(),
      source: toolResult.name,
      prominence: toolResult.name === "get-orchestration-plan" ? 1.0 : 0.8,
    });
  }

  return entities;
};
