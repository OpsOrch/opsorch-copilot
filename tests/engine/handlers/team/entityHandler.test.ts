import { teamEntityHandler } from "../../../../src/engine/handlers/team/entityHandler.js";
import { HandlerContext, ToolResult } from "../../../../src/types.js";
import { test } from 'node:test';
import assert from 'node:assert/strict';

test("teamEntityHandler", async (t) => {
    const createContext = (): HandlerContext =>
        ({
            chatId: "chat",
            turnNumber: 1,
            userQuestion: "test",
            conversationHistory: [],
            toolResults: [],
        }) as HandlerContext;

    await t.test("should extract entities from single team", async () => {
        const team = {
            id: "team-velocity",
            name: "Velocity Team"
        };
        const context = createContext();
        const toolResult: ToolResult = {
            name: "get-team",
            arguments: {},
            result: team,
        };
        
        const entities = await teamEntityHandler(context, toolResult);
        
        assert(entities.length >= 1);
        assert(entities.some(e => e.type === "team"));
    });

    await t.test("should handle invalid tool result gracefully", async () => {
        const context = createContext();
        const toolResult: ToolResult = {
            name: "get-team",
            arguments: {},
            result: null,
        };
        
        const entities = await teamEntityHandler(context, toolResult);
        
        assert.equal(entities.length, 0);
    });
});