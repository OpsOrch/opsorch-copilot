import { teamReferenceHandler } from "../../../../src/engine/handlers/team/referenceHandler.js";
import { HandlerContext, ConversationTurn, ToolResult, Entity, TurnExecutionTrace, JsonObject } from "../../../../src/types.js";
import { test } from "node:test";
import assert from "node:assert/strict";

// Helper to create a ConversationTurn with executionTrace from tool results
function createTurnWithToolsAndEntities(
    toolResults: { name: string; result: unknown; arguments?: JsonObject }[],
    entities: Entity[] = [],
    timestamp = Date.now()
): ConversationTurn {
    const executionTrace: TurnExecutionTrace = {
        traceId: `trace-${timestamp}`,
        startTime: timestamp,
        endTime: timestamp + 100,
        totalDurationMs: 100,
        iterations: [{
            iterationNumber: 1,
            plannedTools: [],
            heuristicModifications: [],
            toolExecutions: toolResults.map(tr => ({
                toolName: tr.name,
                arguments: tr.arguments,
                cacheHit: false,
                executionTimeMs: 50,
                success: true,
            })),
            durationMs: 100,
        }],
    };
    return {
        userMessage: "test",
        timestamp,
        entities,
        executionTrace,
    };
}

test("teamReferenceHandler", async (t) => {
    const createContext = (conversationHistory: ConversationTurn[] = [], toolResults: ToolResult[] = []): HandlerContext =>
        ({
            chatId: "chat",
            turnNumber: 1,
            userQuestion: "test",
            conversationHistory,
            toolResults,
        }) as HandlerContext;

    await t.test("should return null when no team entities exist", async () => {
        const context = createContext();
        const result = await teamReferenceHandler(context, "that team");
        assert.equal(result, null);
    });

    await t.test("should extract team from query-teams tool result", async () => {
        const toolResults: ToolResult[] = [{
            name: "query-teams",
            arguments: {},
            result: [
                { id: "team-velocity", name: "Velocity Team" },
                { id: "team-platform", name: "Platform Team" }
            ]
        }];
        const context = createContext([], toolResults);

        const result = await teamReferenceHandler(context, "that team");
        assert.equal(result, "team-velocity"); // Should return first/most prominent
    });

    await t.test("should extract team from get-team tool result", async () => {
        const toolResults: ToolResult[] = [{
            name: "get-team",
            arguments: { id: "team-velocity" },
            result: { id: "team-velocity", name: "Velocity Team" }
        }];
        const context = createContext([], toolResults);

        const result = await teamReferenceHandler(context, "this team");
        assert.equal(result, "team-velocity");
    });

    await t.test("should extract team from get-team-members tool arguments", async () => {
        const toolResults: ToolResult[] = [{
            name: "get-team-members",
            arguments: { id: "team-velocity" },
            result: [{ id: "user1", name: "John Doe" }]
        }];
        const context = createContext([], toolResults);

        const result = await teamReferenceHandler(context, "that team");
        assert.equal(result, "team-velocity");
    });

    await t.test("should extract team from conversation entities", async () => {
        const entities = [
            { type: "team" as const, value: "team-velocity", prominence: 0.9, extractedAt: Date.now(), source: "test" }
        ];
        const turn = createTurnWithToolsAndEntities([], entities);
        const context = createContext([turn]);

        const result = await teamReferenceHandler(context, "the team");
        assert.equal(result, "team-velocity");
    });

    await t.test("should prioritize exact name matches in reference text", async () => {
        const toolResults: ToolResult[] = [{
            name: "query-teams",
            arguments: {},
            result: [
                { id: "team-velocity", name: "Velocity Team" },
                { id: "team-platform", name: "Platform Team" }
            ]
        }];
        const context = createContext([], toolResults);

        const result = await teamReferenceHandler(context, "the platform team");
        assert.equal(result, "team-platform");
    });

    await t.test("should handle 'that team' by returning most recent", async () => {
        const oldTurn = createTurnWithToolsAndEntities([{
            name: "get-team",
            arguments: {},
            result: { id: "team-old", name: "Old Team" }
        }], [], Date.now() - 10000);

        const recentTurn = createTurnWithToolsAndEntities([{
            name: "get-team",
            arguments: {},
            result: { id: "team-recent", name: "Recent Team" }
        }], [], Date.now());

        // Also add current tool results for immediate context
        const toolResults: ToolResult[] = [{
            name: "get-team",
            arguments: {},
            result: { id: "team-recent", name: "Recent Team" }
        }];

        const context = createContext([oldTurn, recentTurn], toolResults);

        const result = await teamReferenceHandler(context, "that team");
        assert.equal(result, "team-recent");
    });

    await t.test("should handle 'the team' by prioritizing prominence", async () => {
        const entities1 = [{ type: "team" as const, value: "team-low", prominence: 0.5, extractedAt: Date.now(), source: "test" }];
        const entities2 = [{ type: "team" as const, value: "team-high", prominence: 0.9, extractedAt: Date.now(), source: "test" }];

        const turn1 = createTurnWithToolsAndEntities([], entities1);
        const turn2 = createTurnWithToolsAndEntities([], entities2);
        const context = createContext([turn1, turn2]);

        const result = await teamReferenceHandler(context, "the team");
        assert.equal(result, "team-high");
    });

    await t.test("should extract team name from 'the velocity team' pattern", async () => {
        const toolResults: ToolResult[] = [{
            name: "query-teams",
            arguments: {},
            result: [
                { id: "team-velocity", name: "velocity" },
                { id: "team-platform", name: "platform" }
            ]
        }];
        const context = createContext([], toolResults);

        const result = await teamReferenceHandler(context, "the velocity team");
        assert.equal(result, "team-velocity");
    });

    await t.test("should extract team name from 'velocity team' pattern", async () => {
        const toolResults: ToolResult[] = [{
            name: "query-teams",
            arguments: {},
            result: [{ id: "team-velocity", name: "velocity" }]
        }];
        const context = createContext([], toolResults);

        const result = await teamReferenceHandler(context, "velocity team");
        assert.equal(result, "team-velocity");
    });

    await t.test("should extract team name from 'team velocity' pattern", async () => {
        const toolResults: ToolResult[] = [{
            name: "query-teams",
            arguments: {},
            result: [{ id: "team-velocity", name: "velocity" }]
        }];
        const context = createContext([], toolResults);

        const result = await teamReferenceHandler(context, "team velocity");
        assert.equal(result, "team-velocity");
    });

    await t.test("should extract team name from 'team-velocity' pattern", async () => {
        const toolResults: ToolResult[] = [{
            name: "query-teams",
            arguments: {},
            result: [{ id: "team-velocity", name: "velocity" }]
        }];
        const context = createContext([], toolResults);

        const result = await teamReferenceHandler(context, "team-velocity");
        assert.equal(result, "team-velocity");
    });

    await t.test("should return null for domain mismatch", async () => {
        const toolResults: ToolResult[] = [{
            name: "query-teams",
            arguments: {},
            result: [{ id: "team-velocity", name: "Velocity Team" }]
        }];
        const context = createContext([], toolResults);

        const result = await teamReferenceHandler(context, "that service");
        assert.equal(result, null);
    });

    await t.test("should return null for incident reference", async () => {
        const toolResults: ToolResult[] = [{
            name: "query-teams",
            arguments: {},
            result: [{ id: "team-velocity", name: "Velocity Team" }]
        }];
        const context = createContext([], toolResults);

        const result = await teamReferenceHandler(context, "that incident");
        assert.equal(result, null);
    });

    await t.test("should allow team reference even with other entity words if 'team' is present", async () => {
        const toolResults: ToolResult[] = [{
            name: "query-teams",
            arguments: {},
            result: [{ id: "team-velocity", name: "Velocity Team" }]
        }];
        const context = createContext([], toolResults);

        const result = await teamReferenceHandler(context, "that team service");
        assert.equal(result, "team-velocity");
    });

    await t.test("should handle multiple teams and sort by prominence then recency", async () => {
        const oldHighProminence = createTurnWithToolsAndEntities([], [{
            type: "team",
            value: "team-old-high",
            prominence: 0.9,
            extractedAt: Date.now() - 10000,
            source: "test"
        }], Date.now() - 10000);

        const recentLowProminence = createTurnWithToolsAndEntities([], [{
            type: "team",
            value: "team-recent-low",
            prominence: 0.3,
            extractedAt: Date.now(),
            source: "test"
        }], Date.now());

        const context = createContext([oldHighProminence, recentLowProminence]);

        const result = await teamReferenceHandler(context, "the team");
        assert.equal(result, "team-old-high"); // Higher prominence wins
    });

    await t.test("should handle case insensitive matching", async () => {
        const toolResults: ToolResult[] = [{
            name: "query-teams",
            arguments: {},
            result: [{ id: "team-velocity", name: "Velocity Team" }]
        }];
        const context = createContext([], toolResults);

        const result = await teamReferenceHandler(context, "THE VELOCITY TEAM");
        assert.equal(result, "team-velocity");
    });

    await t.test("should handle teams with no name gracefully", async () => {
        const toolResults: ToolResult[] = [{
            name: "query-teams",
            arguments: {},
            result: [{ id: "team-velocity" }] // No name field
        }];
        const context = createContext([], toolResults);

        const result = await teamReferenceHandler(context, "that team");
        assert.equal(result, "team-velocity");
    });

    await t.test("should handle invalid tool results gracefully", async () => {
        const toolResults: ToolResult[] = [{
            name: "query-teams",
            arguments: {},
            result: null
        }];
        const context = createContext([], toolResults);

        const result = await teamReferenceHandler(context, "that team");
        assert.equal(result, null);
    });
});