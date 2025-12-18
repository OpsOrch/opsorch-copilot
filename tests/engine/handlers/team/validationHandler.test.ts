import { teamValidationHandler } from "../../../../src/engine/handlers/team/validationHandler.js";
import { HandlerContext } from "../../../../src/types.js";
import { test } from "node:test";
import assert from "node:assert/strict";

test("teamValidationHandler", async (t) => {
    const createContext = (): HandlerContext =>
        ({
            chatId: "chat",
            turnNumber: 1,
            userQuestion: "test",
            conversationHistory: [],
            toolResults: [],
        }) as HandlerContext;

    await t.test("query-teams validation", async (t) => {
        const context = createContext();

        await t.test("should validate valid query-teams arguments", async () => {
            const args = {
                name: "velocity",
                tags: { focus: "checkout" },
                metadata: { source: "test" }
            };
            const result = await teamValidationHandler(context, "query-teams", args);
            assert.equal(result.valid, true);
            assert.deepEqual(result.normalizedArgs, args);
        });

        await t.test("should normalize team name by trimming whitespace", async () => {
            const args = { name: "  velocity  " };
            const result = await teamValidationHandler(context, "query-teams", args);
            assert.equal(result.valid, true);
            assert.equal(result.normalizedArgs?.name, "velocity");
        });

        await t.test("should reject empty team name", async () => {
            const args = { name: "" };
            const result = await teamValidationHandler(context, "query-teams", args);
            assert.equal(result.valid, false);
            assert(result.errors?.some(e => e.field === "name" && e.code === "EMPTY_VALUE"));
        });

        await t.test("should reject non-string team name", async () => {
            const args = { name: 123 };
            const result = await teamValidationHandler(context, "query-teams", args);
            assert.equal(result.valid, false);
            assert(result.errors?.some(e => e.field === "name" && e.code === "INVALID_TYPE"));
        });

        await t.test("should validate tags object", async () => {
            const args = { tags: { focus: "checkout", tier: "backend" } };
            const result = await teamValidationHandler(context, "query-teams", args);
            assert.equal(result.valid, true);
        });

        await t.test("should reject non-object tags", async () => {
            const args = { tags: "invalid" };
            const result = await teamValidationHandler(context, "query-teams", args);
            assert.equal(result.valid, false);
            assert(result.errors?.some(e => e.field === "tags" && e.code === "INVALID_TYPE"));
        });

        await t.test("should reject tags with non-string values", async () => {
            const args = { tags: { focus: "checkout", count: 123 } };
            const result = await teamValidationHandler(context, "query-teams", args);
            assert.equal(result.valid, false);
            assert(result.errors?.some(e => e.field.startsWith("tags.") && e.code === "INVALID_TYPE"));
        });

        await t.test("should validate metadata object", async () => {
            const args = { metadata: { source: "test", count: 5, nested: { key: "value" } } };
            const result = await teamValidationHandler(context, "query-teams", args);
            assert.equal(result.valid, true);
        });

        await t.test("should reject non-object metadata", async () => {
            const args = { metadata: "invalid" };
            const result = await teamValidationHandler(context, "query-teams", args);
            assert.equal(result.valid, false);
            assert(result.errors?.some(e => e.field === "metadata" && e.code === "INVALID_TYPE"));
        });

        await t.test("should remove limit field entirely", async () => {
            const args = { name: "velocity", limit: 50 };
            const result = await teamValidationHandler(context, "query-teams", args);
            assert.equal(result.valid, true);
            assert.equal(result.normalizedArgs?.limit, undefined);
            assert.equal(result.normalizedArgs?.name, "velocity");
        });

        await t.test("should validate limit but still remove it", async () => {
            const args = { limit: -5 };
            const result = await teamValidationHandler(context, "query-teams", args);
            assert.equal(result.valid, false);
            assert(result.errors?.some(e => e.field === "limit" && e.code === "INVALID_VALUE"));
        });

        await t.test("should validate scope object", async () => {
            const args = { 
                scope: { 
                    service: "checkout-api", 
                    environment: "prod", 
                    team: "velocity" 
                } 
            };
            const result = await teamValidationHandler(context, "query-teams", args);
            assert.equal(result.valid, true);
        });

        await t.test("should reject empty scope fields", async () => {
            const args = { scope: { service: "" } };
            const result = await teamValidationHandler(context, "query-teams", args);
            assert.equal(result.valid, false);
            assert(result.errors?.some(e => e.field === "scope.service" && e.code === "EMPTY_VALUE"));
        });
    });

    await t.test("get-team validation", async (t) => {
        const context = createContext();

        await t.test("should validate valid team ID", async () => {
            const args = { id: "team-velocity" };
            const result = await teamValidationHandler(context, "get-team", args);
            assert.equal(result.valid, true);
            assert.equal(result.normalizedArgs?.id, "team-velocity");
        });

        await t.test("should normalize team ID by trimming whitespace", async () => {
            const args = { id: "  team-velocity  " };
            const result = await teamValidationHandler(context, "get-team", args);
            assert.equal(result.valid, true);
            assert.equal(result.normalizedArgs?.id, "team-velocity");
        });

        await t.test("should encode special characters in team ID", async () => {
            const args = { id: "team with spaces" };
            const result = await teamValidationHandler(context, "get-team", args);
            assert.equal(result.valid, true);
            assert.equal(result.normalizedArgs?.id, "team%20with%20spaces");
        });

        await t.test("should reject empty team ID", async () => {
            const args = { id: "" };
            const result = await teamValidationHandler(context, "get-team", args);
            assert.equal(result.valid, false);
            assert(result.errors?.some(e => e.field === "id" && e.code === "EMPTY_VALUE"));
        });

        await t.test("should reject non-string team ID", async () => {
            const args = { id: 123 };
            const result = await teamValidationHandler(context, "get-team", args);
            assert.equal(result.valid, false);
            assert(result.errors?.some(e => e.field === "id" && e.code === "INVALID_TYPE"));
        });
    });

    await t.test("get-team-members validation", async (t) => {
        const context = createContext();

        await t.test("should validate valid team ID for members", async () => {
            const args = { id: "team-velocity" };
            const result = await teamValidationHandler(context, "get-team-members", args);
            assert.equal(result.valid, true);
            assert.equal(result.normalizedArgs?.id, "team-velocity");
        });

        await t.test("should reject empty team ID for members", async () => {
            const args = { id: "   " };
            const result = await teamValidationHandler(context, "get-team-members", args);
            assert.equal(result.valid, false);
            assert(result.errors?.some(e => e.field === "id" && e.code === "EMPTY_VALUE"));
        });
    });

    await t.test("should handle unknown tool names gracefully", async () => {
        const context = createContext();
        const args = { someField: "value" };
        const result = await teamValidationHandler(context, "unknown-tool", args);
        assert.equal(result.valid, true);
        assert.deepEqual(result.normalizedArgs, args);
    });
});