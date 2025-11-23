import assert from 'node:assert/strict';
import { test } from 'node:test';
import { McpFactory } from '../src/mcpFactory.js';
import { OpsOrchMcp } from '../src/mcps/opsorch.js';
import { RuntimeConfig } from '../src/types.js';
import { NullLlm } from '../src/llms/null.js';

test('McpFactory', async (t) => {
    await t.test('creates OpsOrchMcp with correct URL', () => {
        const config: RuntimeConfig = {
            mcpUrl: 'http://localhost:3000',
            llm: new NullLlm(),
        };

        const mcp = McpFactory.create(config);
        assert.ok(mcp instanceof OpsOrchMcp);
    });

    await t.test('passes mcpUrl to OpsOrchMcp', () => {
        const testUrl = 'http://test-server:8080';
        const config: RuntimeConfig = {
            mcpUrl: testUrl,
            llm: new NullLlm(),
        };

        const mcp = McpFactory.create(config) as OpsOrchMcp;
        assert.ok(mcp);
    });
});
