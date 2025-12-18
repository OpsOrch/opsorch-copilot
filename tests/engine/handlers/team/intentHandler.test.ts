import { teamIntentHandler } from "../../../../src/engine/handlers/team/intentHandler.js";
import { HandlerContext } from "../../../../src/types.js";
import { test } from "node:test";
import assert from "node:assert/strict";

test("teamIntentHandler", async (t) => {
    const createContext = (question: string): HandlerContext =>
        ({
            chatId: "chat",
            turnNumber: 1,
            userQuestion: question,
            conversationHistory: [],
            toolResults: [],
        }) as HandlerContext;

    await t.test("should identify team queries with 'team' keyword", async () => {
        const context = createContext("tell me about velocity team");
        const result = await teamIntentHandler(context);
        assert.equal(result.intent, "investigation");
        assert(result.confidence >= 0.75);
        assert(result.suggestedTools.includes("query-teams"));
    });

    await t.test("should identify ownership queries", async () => {
        const context = createContext("who owns the checkout service");
        const result = await teamIntentHandler(context);
        assert.equal(result.intent, "investigation");
        assert(result.confidence > 0.8);
        assert(result.suggestedTools.includes("query-teams"));
    });

    await t.test("should identify team member queries", async () => {
        const context = createContext("who is on the velocity team");
        const result = await teamIntentHandler(context);
        assert.equal(result.intent, "investigation");
        assert(result.confidence > 0.8);
        assert(result.suggestedTools.includes("query-teams"));
    });

    await t.test("should return unknown intent for unrelated queries", async () => {
        const context = createContext("what is the weather today");
        const result = await teamIntentHandler(context);
        assert.equal(result.intent, "unknown");
        assert.equal(result.confidence, 0);
    });

    await t.test("should handle case-insensitive matching", async () => {
        const context = createContext("WHO OWNS THE CHECKOUT SERVICE");
        const result = await teamIntentHandler(context);
        assert.equal(result.intent, "investigation");
        assert(result.confidence > 0.8);
    });
});