import { teamFollowUpHandler } from "../../../../src/engine/handlers/team/followUpHandler.js";
import { HandlerContext, ToolResult } from "../../../../src/types.js";
import { test } from 'node:test';
import assert from 'node:assert/strict';

test("teamFollowUpHandler", async (t) => {
    const createContext = (question: string): HandlerContext =>
        ({
            chatId: "chat",
            turnNumber: 1,
            userQuestion: question,
            conversationHistory: [],
            toolResults: [],
        }) as HandlerContext;

    const createTeamResult = (team: any): ToolResult => ({
        name: "query-teams",
        arguments: {},
        result: team,
    });

    await t.test("should suggest team members for single team", async () => {
        const team = {
            id: "team-velocity",
            name: "Velocity Team"
        };
        const context = createContext("tell me about velocity team");
        const toolResult = createTeamResult(team);
        
        const suggestions = await teamFollowUpHandler(context, toolResult);
        
        assert(suggestions.some(s => 
            s.name === "get-team-members" && 
            s.arguments.id === "team-velocity"
        ));
    });

    await t.test("should suggest services owned by team", async () => {
        const team = {
            id: "team-velocity",
            name: "Velocity Team"
        };
        const context = createContext("tell me about velocity team");
        const toolResult = createTeamResult(team);
        
        const suggestions = await teamFollowUpHandler(context, toolResult);
        
        assert(suggestions.some(s => 
            s.name === "query-services" && 
            s.arguments.scope && 
            typeof s.arguments.scope === "object" &&
            (s.arguments.scope as any).team === "Velocity Team"
        ));
    });

    await t.test("should handle invalid tool result gracefully", async () => {
        const context = createContext("tell me about teams");
        const toolResult = { ...createTeamResult(null), result: null };
        
        const suggestions = await teamFollowUpHandler(context, toolResult);
        
        assert.equal(suggestions.length, 0);
    });
});