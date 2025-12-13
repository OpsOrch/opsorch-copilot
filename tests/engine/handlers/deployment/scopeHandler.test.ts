import { deploymentScopeHandler } from "../../../../src/engine/handlers/deployment/scopeHandler.js";
import { HandlerContext } from "../../../../src/types.js";
import { test } from "node:test";
import assert from "node:assert/strict";

const baseContext: HandlerContext = {
    chatId: "chat",
    turnNumber: 1,
    userQuestion: "",
    conversationHistory: [],
    toolResults: [],
};

test("deploymentScopeHandler", async (t) => {
    await t.test("infers environment from question", async () => {
        const context = { ...baseContext, userQuestion: "what's the prod deployment" };
        const scope = await deploymentScopeHandler(context);
        assert(scope);
        assert.equal(scope?.environment, "production");
    });

    await t.test("falls back to service entities", async () => {
        const context: HandlerContext = {
            ...baseContext,
            userQuestion: "",
            conversationHistory: [
                {
                    userMessage: "",
                    timestamp: Date.now(),
                    entities: [
                        {
                            type: "service",
                            value: "svc-checkout",
                            extractedAt: Date.now(),
                            source: "user",
                        },
                    ],
                },
            ],
        };
        const scope = await deploymentScopeHandler(context);
        assert(scope);
        assert.equal(scope?.service, "svc-checkout");
    });
});
