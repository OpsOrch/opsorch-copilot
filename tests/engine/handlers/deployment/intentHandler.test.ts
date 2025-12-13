import { deploymentIntentHandler } from "../../../../src/engine/handlers/deployment/intentHandler.js";
import { HandlerContext } from "../../../../src/types.js";
import { test } from "node:test";
import assert from "node:assert/strict";

test("deploymentIntentHandler", async (t) => {
    const createContext = (question: string): HandlerContext =>
        ({
            chatId: "chat",
            turnNumber: 1,
            userQuestion: question,
            conversationHistory: [],
            toolResults: [],
        }) as HandlerContext;

    await t.test("should identify deployment status checks", async () => {
        const context = createContext("show me recent deployments");
        const result = await deploymentIntentHandler(context);
        assert.equal(result.intent, "status_check");
        assert(result.confidence > 0.6);
        assert(result.suggestedTools.includes("query-deployments"));
    });

    await t.test("should identify specific deployment queries", async () => {
        const context = createContext("deployment status for service foo");
        const result = await deploymentIntentHandler(context);
        assert.equal(result.intent, "status_check");
        assert(result.confidence > 0.6);
        assert(result.suggestedTools.includes("query-deployments"));
    });

    await t.test("should return unknown intent for unrelated queries", async () => {
        const context = createContext("how are you?");
        const result = await deploymentIntentHandler(context);
        assert.equal(result.intent, "unknown");
        assert.equal(result.confidence, 0);
    });

    await t.test("should suggest get-deployment when id is present", async () => {
        const context = createContext("check deployment d-1234 for payments");
        const result = await deploymentIntentHandler(context);
        assert(result.suggestedTools.includes("get-deployment"));
        assert(result.confidence > 0.5);
    });
});
