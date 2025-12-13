import type {
  HandlerContext,
  QueryScope,
  JsonObject,
  Entity,
  ToolResult,
  ConversationTurn,
} from "../../../types.js";
import { HandlerUtils } from "../utils.js";

const ENVIRONMENT_KEYWORDS: Record<string, string[]> = {
  production: ["prod", "production", "live"],
  staging: ["stage", "staging"],
  development: ["dev", "development"],
  qa: ["qa", "test", "testing", "preprod"],
};

const SERVICE_PATTERNS: RegExp[] = [
  /service\s+([a-z0-9_\-/.]+)/i,
  /([a-z0-9_\-/.]+)\s+service/i,
  /svc[-_\s]?([a-z0-9_\-/.]+)/i,
];

const UUID_PATTERN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;

const GENERIC_ID_PATTERNS: RegExp[] = [
  /deployment\s+(?:id\s+)?([a-z0-9._-]{3,})/gi,
  /deploy\s+(?:id\s+)?([a-z0-9._-]{3,})/gi,
  /release\s+(?:id\s+)?([a-z0-9._-]{3,})/gi,
  /build\s+(?:id\s+)?([a-z0-9._-]{3,})/gi,
  /([a-z]{1,5}-\d{3,})/gi,
];

const VERSION_PATTERNS: RegExp[] = [
  /v\d+(?:\.\d+){1,3}\b/gi,
  /\b\d+\.\d+\.\d+\b/g,
];

export function detectEnvironmentFromText(text?: string): string | undefined {
  if (!text) return undefined;
  const lower = text.toLowerCase();
  for (const [environment, keywords] of Object.entries(ENVIRONMENT_KEYWORDS)) {
    if (keywords.some((keyword) => lower.includes(keyword))) {
      return environment;
    }
  }
  return undefined;
}

export function inferServiceFromQuestion(text?: string): string | undefined {
  if (!text) return undefined;
  for (const pattern of SERVICE_PATTERNS) {
    const match = pattern.exec(text);
    if (match?.[1]) {
      return match[1].trim();
    }
  }
  return undefined;
}

function collectEntities(history: ConversationTurn[]): Entity[] {
  const entities: Entity[] = [];
  for (const turn of history) {
    if (Array.isArray(turn.entities)) {
      entities.push(...turn.entities);
    }
  }
  return entities;
}

function applyScopeFromArgs(args: JsonObject | undefined, scope: QueryScope): boolean {
  if (!args) return false;
  const scopeArg = args.scope;
  if (!scopeArg || typeof scopeArg !== "object" || Array.isArray(scopeArg)) {
    return false;
  }
  const scopeObj = scopeArg as JsonObject;
  let changed = false;
  if (!scope.service && typeof scopeObj.service === "string") {
    scope.service = scopeObj.service;
    changed = true;
  }
  if (!scope.environment && typeof scopeObj.environment === "string") {
    scope.environment = scopeObj.environment;
    changed = true;
  }
  if (!scope.team && typeof scopeObj.team === "string") {
    scope.team = scopeObj.team;
    changed = true;
  }
  return changed;
}

function applyScopeFromDeployment(obj: JsonObject, scope: QueryScope): boolean {
  let changed = false;
  if (!scope.service && typeof obj.service === "string") {
    scope.service = obj.service;
    changed = true;
  }
  if (!scope.environment && typeof obj.environment === "string") {
    scope.environment = obj.environment;
    changed = true;
  }
  if (!scope.team && typeof obj.team === "string") {
    scope.team = obj.team;
    changed = true;
  }
  return changed;
}

export function buildDeploymentScope(context: HandlerContext): QueryScope | null {
  const scope: QueryScope = {};
  let hasScope = false;

  const question = context.userQuestion || "";
  const toolResults: ToolResult[] = Array.isArray(context.toolResults)
    ? context.toolResults
    : [];
  const history: ConversationTurn[] = Array.isArray(context.conversationHistory)
    ? context.conversationHistory
    : [];

  const questionEnvironment = detectEnvironmentFromText(question);
  if (questionEnvironment) {
    scope.environment = questionEnvironment;
    hasScope = true;
  }

  const questionService = inferServiceFromQuestion(question);
  if (questionService) {
    scope.service = questionService;
    hasScope = true;
  }

  // Inspect current iteration tool results (latest first)
  for (let i = toolResults.length - 1; i >= 0; i -= 1) {
    const toolResult = toolResults[i];
    if (!toolResult) continue;
    if (
      toolResult.arguments &&
      typeof toolResult.arguments === "object" &&
      !Array.isArray(toolResult.arguments)
    ) {
      const args = toolResult.arguments as JsonObject;
      if (applyScopeFromArgs(args, scope)) {
        hasScope = true;
      }
    }

    if (toolResult.result && typeof toolResult.result === "object") {
      const payload = toolResult.result;
      if (Array.isArray(payload)) {
        for (const item of payload) {
          if (item && typeof item === "object" && !Array.isArray(item)) {
            if (applyScopeFromDeployment(item as JsonObject, scope)) {
              hasScope = true;
            }
          }
        }
      } else {
        const payloadObj = payload as JsonObject;
        if (Array.isArray(payloadObj.deployments)) {
          for (const deployment of payloadObj.deployments) {
            if (
              deployment &&
              typeof deployment === "object" &&
              !Array.isArray(deployment)
            ) {
              if (applyScopeFromDeployment(deployment as JsonObject, scope)) {
                hasScope = true;
              }
            }
          }
        } else if (applyScopeFromDeployment(payloadObj, scope)) {
          hasScope = true;
        }
      }
    }
  }

  if (!scope.service) {
    const entities = collectEntities(history);
    const recentService = HandlerUtils.findMostRecentEntity(entities, "service");
    if (recentService) {
      scope.service = recentService.value;
      hasScope = true;
    }
  }

  return hasScope ? scope : null;
}

export function extractDeploymentIdCandidates(text?: string): string[] {
  if (!text) return [];
  const matches = new Set<string>();
  let uuidMatch: RegExpExecArray | null;
  UUID_PATTERN.lastIndex = 0;
  while ((uuidMatch = UUID_PATTERN.exec(text)) !== null) {
    matches.add(uuidMatch[0]);
  }

  for (const pattern of GENERIC_ID_PATTERNS) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const candidate = match[1];
      if (candidate) {
        matches.add(candidate.trim());
      }
    }
  }

  return Array.from(matches);
}

export function extractVersionCandidates(text?: string): string[] {
  if (!text) return [];
  const matches = new Set<string>();
  for (const pattern of VERSION_PATTERNS) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      matches.add(match[0].trim());
    }
  }
  return Array.from(matches);
}

export function buildKeywordQuery(text?: string): string | undefined {
  if (!text) return undefined;
  const blockers = new Set([
    "deployment",
    "deployments",
    "deploy",
    "recent",
    "latest",
    "status",
    "last",
    "for",
    "about",
    "service",
  ]);
  const keywords = HandlerUtils.extractKeywords(text).filter(
    (keyword) => !blockers.has(keyword),
  );
  if (!keywords.length) return undefined;
  return keywords.slice(0, 6).join(" ");
}
