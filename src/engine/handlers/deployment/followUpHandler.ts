import type { FollowUpHandler } from "../handlers.js";
import type { ToolCall, JsonObject, ToolResult } from "../../../types.js";
import { HandlerUtils } from "../utils.js";

function normalizeDeployments(result: ToolResult["result"]): JsonObject[] {
    if (!result || typeof result !== "object") return [];

    if (Array.isArray(result)) {
        return result.filter((item): item is JsonObject => !!item && typeof item === "object" && !Array.isArray(item));
    }

    const payload = result as JsonObject;
    if (Array.isArray(payload.deployments)) {
        return payload.deployments.filter((item): item is JsonObject => !!item && typeof item === "object" && !Array.isArray(item));
    }

    return [payload];
}

function extractTimestamp(deployment: JsonObject): string | undefined {
    const timestampFields = [
        "deployedAt",
        "deployed_at",
        "startedAt",
        "started_at",
        "completedAt",
        "completed_at",
        "createdAt",
        "created_at",
        "updatedAt",
        "updated_at",
    ];

    for (const field of timestampFields) {
        const value = deployment[field];
        if (typeof value === "string" && value) {
            return value;
        }
    }

    return undefined;
}

function createTimeWindow(timestamp?: string): { start?: string; end?: string } {
    if (!timestamp) return {};
    const parsed = HandlerUtils.parseTimestamp(timestamp);
    if (!parsed) return {};
    const start = new Date(parsed.getTime() - 15 * 60 * 1000);
    const end = new Date(parsed.getTime() + 30 * 60 * 1000);
    return { start: start.toISOString(), end: end.toISOString() };
}

function shouldDeepDive(status?: string, timestamp?: string): boolean {
    const lowerStatus = status?.toLowerCase() || "";
    if (lowerStatus && (lowerStatus.includes("fail") || lowerStatus.includes("error") || lowerStatus.includes("rollback") || lowerStatus.includes("running"))) {
        return true;
    }

    if (timestamp) {
        const parsed = HandlerUtils.parseTimestamp(timestamp);
        if (parsed) {
            const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
            return parsed.getTime() >= twoHoursAgo;
        }
    }

    return false;
}

export const deploymentFollowUpHandler: FollowUpHandler = async (_context, toolResult) => {
    const deployments = normalizeDeployments(toolResult.result);
    if (!deployments.length) return [];

    const suggestions: ToolCall[] = [];
    const dedupe = new Set<string>();

    const addSuggestion = (call: ToolCall) => {
        const key = `${call.name}:${JSON.stringify(call.arguments)}`;
        if (dedupe.has(key)) return;
        dedupe.add(key);
        suggestions.push(call);
    };

    for (const deployment of deployments.slice(0, 3)) {
        const service = typeof deployment.service === "string" ? deployment.service : undefined;
        const status = typeof deployment.status === "string" ? deployment.status : undefined;
        const version = typeof deployment.version === "string" ? deployment.version : undefined;
        const timestamp = extractTimestamp(deployment);

        if (!service) continue;

        addSuggestion({
            name: "query-incidents",
            arguments: {
                scope: { service },
                statuses: ["investigating", "mitigating", "open"],
                limit: 5,
            },
        });

        if (shouldDeepDive(status, timestamp)) {
            const { start, end } = createTimeWindow(timestamp);
            const searchTerms = ["deployment", service, version?.toString() ?? ""].filter(Boolean).join(" ");
            addSuggestion({
                name: "query-logs",
                arguments: {
                    scope: { service },
                    expression: { search: searchTerms || `deployment ${service}` },
                    ...(start && { start }),
                    ...(end && { end }),
                    limit: 200,
                },
            });

            addSuggestion({
                name: "query-alerts",
                arguments: {
                    scope: { service },
                    statuses: ["firing", "acknowledged"],
                    limit: 5,
                },
            });
        }
    }

    return suggestions;
};
