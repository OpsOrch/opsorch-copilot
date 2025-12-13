import { deploymentEntityHandler } from "../../../../src/engine/handlers/deployment/entityHandler.js";
import { HandlerContext, ToolResult } from "../../../../src/types.js";
import { test } from "node:test";
import assert from "node:assert/strict";

const mockContext = {} as HandlerContext;

test("deploymentEntityHandler", async (t) => {
    await t.test("should return empty array for invalid result", async () => {
        const result: ToolResult = {
            name: "query-deployments",
            result: null,
        };
        const entities = await deploymentEntityHandler(mockContext, result);
        assert.deepEqual(entities, []);
    });

    await t.test("should extract entities from single deployment", async () => {
        const result: ToolResult = {
            name: "get-deployment",
            result: {
                id: "d-123",
                service: "payment-service",
                status: "success",
            },
        };
        const entities = await deploymentEntityHandler(mockContext, result);
        assert.equal(entities.length, 1);
        assert.match(entities[0].type, /deployment/);
        assert.equal(entities[0].value, "d-123");
    });

    await t.test("should extract entities from deployment array", async () => {
        const result: ToolResult = {
            name: "query-deployments",
            result: [
                {
                    id: "d-123",
                    service: "payment-service",
                },
                {
                    id: "d-456",
                    service: "auth-service",
                },
            ],
        };
        const entities = await deploymentEntityHandler(mockContext, result);
        assert.equal(entities.length, 2);
        assert.equal(entities[0].value, "d-123");
        assert.equal(entities[1].value, "d-456");
    });

    await t.test("should validate entity IDs", async () => {
        const result: ToolResult = {
            name: "query-deployments",
            result: [
                { id: "" }, // Invalid ID
                { id: "valid-id" },
            ],
        };
        const entities = await deploymentEntityHandler(mockContext, result);
        assert.equal(entities.length, 1);
        assert.equal(entities[0].value, "valid-id");
    });
});
