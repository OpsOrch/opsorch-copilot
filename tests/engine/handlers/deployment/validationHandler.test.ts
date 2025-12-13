import { deploymentValidationHandler } from "../../../../src/engine/handlers/deployment/validationHandler.js";
import { HandlerContext, JsonObject } from "../../../../src/types.js";
import { test } from "node:test";
import assert from "node:assert/strict";

const context = {
    chatId: "chat",
    turnNumber: 1,
    userQuestion: "",
    conversationHistory: [],
    toolResults: [],
} as HandlerContext;

test("deploymentValidationHandler", async (t) => {
    await t.test("validates get-deployment id", async () => {
        const result = await deploymentValidationHandler(context, "get-deployment", { id: 123 } as unknown as JsonObject);
        assert(!result.valid);
        assert(result.errors?.some((error) => error.field === "id"));
    });

    await t.test("normalizes status filters", async () => {
        const args = { statuses: ["FAILED", "SUCCESS"], limit: 5 } as JsonObject;
        const result = await deploymentValidationHandler(context, "query-deployments", args);
        assert(result.valid);
        assert.deepEqual(result.normalizedArgs?.statuses, ["failed", "success"]);
    });

    await t.test("rejects invalid scope shape", async () => {
        const args = { scope: [] } as JsonObject;
        const result = await deploymentValidationHandler(context, "query-deployments", args);
        assert(!result.valid);
        assert(result.errors?.some((error) => error.field === "scope"));
    });
});
