import assert from "node:assert/strict";
import { test } from "node:test";
import { GeminiLlm } from "../src/llms/gemini.js";

test("gemini", async (t) => {
    await t.test("should throw error when API key is missing", () => {
        assert.throws(
            () => new GeminiLlm(""),
            /GEMINI_API_KEY is required/,
            "Should throw error for missing API key",
        );
    });

    await t.test(
        "should throw error when API key is null or undefined",
        () => {
            assert.throws(() => new GeminiLlm(null as unknown as string), /GEMINI_API_KEY is required/);
            assert.throws(
                () => new GeminiLlm(undefined as unknown as string),
                /GEMINI_API_KEY is required/,
            );
        },
    );

    await t.test("should successfully create instance with valid API key", () => {
        const llm = new GeminiLlm("test-api-key-12345");
        assert.ok(llm, "Should create GeminiLlm instance");
    });

    await t.test("should surface provider errors", async () => {
        const llm = new GeminiLlm("invalid-key-that-will-fail");

        const logs: string[] = [];
        const originalLog = console.log;
        const originalWarn = console.warn;
        const originalError = console.error;

        console.log = (...args: unknown[]) => {
            logs.push(args.join(" "));
        };
        console.warn = (...args: unknown[]) => {
            logs.push(args.join(" "));
        };
        console.error = (...args: unknown[]) => {
            logs.push(args.join(" "));
        };

        try {
            await assert.rejects(
                llm.chat(
                    [{ role: "user" as const, content: "Test message" }],
                    [],
                ),
            );

            // Should log error details
            const hasErrorLog = logs.some((log) =>
                log.includes("[Gemini] Request failed"),
            );
            assert.ok(hasErrorLog, "Should log request failure");
        } finally {
            console.log = originalLog;
            console.warn = originalWarn;
            console.error = originalError;
        }
    });

    await t.test("should log request information", async () => {
        const llm = new GeminiLlm("invalid-key");

        const logs: string[] = [];
        const originalLog = console.log;

        console.log = (...args: unknown[]) => {
            logs.push(args.join(" "));
        };

        try {
            await assert.rejects(
                llm.chat(
                    [
                        { role: "user" as const, content: "First" },
                        { role: "assistant" as const, content: "Response" },
                        { role: "user" as const, content: "Second" },
                    ],
                    [
                        { name: "tool1", description: "Test tool 1" },
                        { name: "tool2", description: "Test tool 2" },
                    ],
                ),
            );

            // Should log request metadata
            const requestLog = logs.find((log) => log.includes("[Gemini] Request:"));
            assert.ok(requestLog, "Should log request information");

            // Parse the JSON from the log
            const jsonMatch = requestLog?.match(/\{.*\}/);
            if (jsonMatch) {
                const requestData = JSON.parse(jsonMatch[0]);
                assert.strictEqual(
                    requestData.model,
                    "gemini-3-flash-preview",
                    "Should log correct model name",
                );
                assert.strictEqual(
                    requestData.messagesCount,
                    3,
                    "Should log correct message count",
                );
                assert.strictEqual(
                    requestData.toolsCount,
                    2,
                    "Should log correct tools count",
                );
            }
        } finally {
            console.log = originalLog;
        }
    });
});
