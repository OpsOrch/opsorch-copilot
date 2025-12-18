import { teamQueryBuilder } from "../../../../src/engine/handlers/team/queryBuilder.js";
import { HandlerContext } from "../../../../src/types.js";
import { test } from "node:test";
import assert from "node:assert/strict";

test("teamQueryBuilder", async (t) => {
    const createContext = (): HandlerContext =>
        ({
            chatId: "chat",
            turnNumber: 1,
            userQuestion: "test",
            conversationHistory: [],
            toolResults: [],
        }) as HandlerContext;

    await t.test("should extract team names from various patterns", async (t) => {
        const context = createContext();

        await t.test("should extract from 'velocity team' pattern", async () => {
            const result = await teamQueryBuilder(context, "query-teams", "tell me about velocity team");
            assert.equal(result.name, "velocity");
        });

        await t.test("should extract from 'team-velocity' pattern", async () => {
            const result = await teamQueryBuilder(context, "query-teams", "show me team-velocity");
            assert.equal(result.name, "velocity");
        });

        await t.test("should extract from 'the velocity team' pattern", async () => {
            const result = await teamQueryBuilder(context, "query-teams", "who is on the velocity team");
            assert.equal(result.name, "velocity");
        });
    });

    await t.test("should extract service ownership queries", async (t) => {
        const context = createContext();

        await t.test("should extract from 'who owns service' pattern", async () => {
            const result = await teamQueryBuilder(context, "query-teams", "who owns checkout service");
            assert.deepEqual(result.scope, { service: "checkout" });
        });

        await t.test("should extract from 'team for service' pattern", async () => {
            const result = await teamQueryBuilder(context, "query-teams", "team for payments service");
            assert.deepEqual(result.scope, { service: "payments" });
        });
    });

    await t.test("should not include limit field", async () => {
        const context = createContext();
        const result = await teamQueryBuilder(context, "query-teams", "show me velocity team");
        
        assert.equal(result.limit, undefined);
    });
});