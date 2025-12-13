import { deploymentFollowUpHandler } from "../../../../src/engine/handlers/deployment/followUpHandler.js";
import { HandlerContext, ToolResult } from "../../../../src/types.js";
import { test } from "node:test";
import assert from "node:assert/strict";

const context: HandlerContext = {
    chatId: "chat",
    turnNumber: 1,
    userQuestion: "",
    conversationHistory: [],
    toolResults: [],
};

test("deploymentFollowUpHandler", async (t) => {
    await t.test("suggests incident and telemetry follow ups", async () => {
        const result: ToolResult = {
            name: "query-deployments",
            result: [
                {
                    id: "d-1",
                    service: "svc-payments",
                    status: "failed",
                    deployedAt: new Date().toISOString(),
                },
            ],
        };

        const suggestions = await deploymentFollowUpHandler(context, result);
        const incidentCall = suggestions.find((call) => call.name === "query-incidents");
        assert(incidentCall);
        assert.equal((incidentCall?.arguments.scope as { service: string }).service, "svc-payments");

        const logCall = suggestions.find((call) => call.name === "query-logs");
        assert(logCall, "Expected a log investigation");
        assert.equal((logCall?.arguments.scope as { service: string }).service, "svc-payments");

        const alertsCall = suggestions.find((call) => call.name === "query-alerts");
        assert(alertsCall, "Expected alert correlation");
    });

    await t.test("returns empty array when no service present", async () => {
        const result: ToolResult = {
            name: "query-deployments",
            result: [
                {
                    id: "d-2",
                    status: "success",
                },
            ],
        };

        const suggestions = await deploymentFollowUpHandler(context, result);
        assert.equal(suggestions.length, 0);
    });
});
