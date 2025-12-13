import { deploymentQueryBuilder } from "../../../../src/engine/handlers/deployment/queryBuilder.js";
import { HandlerContext, JsonObject } from "../../../../src/types.js";
import { test } from "node:test";
import assert from "node:assert/strict";

test("deploymentQueryBuilder", async (t) => {
    const createContext = (question: string, overrides: Partial<HandlerContext> = {}): HandlerContext => ({
        chatId: "chat",
        turnNumber: 1,
        userQuestion: question,
        conversationHistory: [],
        toolResults: [],
        ...overrides,
    });

    await t.test("should build default query", async () => {
        const context = createContext("show deployments");
        const args = await deploymentQueryBuilder(context, "query-deployments", "show deployments");
        assert.deepEqual(args, { limit: 10 });
    });

    await t.test("should extract status filters", async () => {
        const context = createContext("show failed deployments");
        const args = await deploymentQueryBuilder(context, "query-deployments", "show failed deployments");
        const statuses = args.statuses as string[];
        assert(statuses.includes("failed"));
    });

    await t.test("should extract multiple statuses", async () => {
        const context = createContext("show running and failed deployments");
        const args = await deploymentQueryBuilder(
            context,
            "query-deployments",
            "show running and failed deployments",
        );
        const statuses = args.statuses as string[];
        assert(statuses.includes("failed"));
        assert(statuses.includes("running"));
        assert(statuses.includes("queued"));
    });

    await t.test("should set limit for 'recent' queries", async () => {
        const context = createContext("recent deployments");
        const args = await deploymentQueryBuilder(context, "query-deployments", "recent deployments");
        assert.equal(args.limit, 5);
    });

    await t.test("should infer scope from conversation history", async () => {
        const context = createContext("deployments", {
            conversationHistory: [
                {
                    userMessage: "",
                    timestamp: Date.now(),
                    entities: [
                        {
                            type: "service",
                            value: "svc-payments",
                            extractedAt: Date.now(),
                            source: "user",
                        },
                    ],
                },
            ],
        } as HandlerContext);
        const args = await deploymentQueryBuilder(context, "query-deployments", "deployments");
        assert.equal((args.scope as JsonObject).service, "svc-payments");
    });

    await t.test("should include deployment id when present", async () => {
        const question = "show deployment d-1553";
        const context = createContext(question);
        const args = await deploymentQueryBuilder(context, "query-deployments", question);
        assert.equal(args.id, "d-1553");
    });

    await t.test("should extract version filters", async () => {
        const question = "need deployments for version v3.2.1";
        const context = createContext(question);
        const args = await deploymentQueryBuilder(context, "query-deployments", question);
        assert.deepEqual(args.versions, ["v3.2.1"]);
    });
});
