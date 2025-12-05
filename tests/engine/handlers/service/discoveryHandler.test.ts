
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
    serviceDiscoveryHandler,
    discoverServices,
    clearServiceCache,
    setCachedServices,
    getCachedServices
} from '../../../../src/engine/handlers/service/discoveryHandler.js';
import { Tool, HandlerContext } from '../../../../src/types.js';
import { McpClient } from '../../../../src/mcpClient.js';

interface MockToolRequest {
    name: string;
    arguments?: Record<string, unknown>;
}

interface MockToolResponse {
    result: unknown;
}

class MockMcpClient {
    public calls: MockToolRequest[] = [];
    public mockResponse: MockToolResponse | null = null;

    async callTool(request: MockToolRequest, _config?: unknown): Promise<MockToolResponse> {
        this.calls.push(request);
        if (this.mockResponse) {
            return this.mockResponse;
        }
        return { result: [] };
    }
}

test('Service Discovery Handler', async (t) => {

    t.beforeEach(() => {
        clearServiceCache();
    });

    await t.test('serviceDiscoveryHandler should return empty if cache empty', async () => {
        const services = await serviceDiscoveryHandler({
            chatId: 'test',
            turnNumber: 0,
            conversationHistory: [],
            toolResults: [],
            userQuestion: ''
        } as HandlerContext);
        assert.deepEqual(services, []);
    });

    await t.test('discoverServices should return empty if no service query tool found', async () => {
        const mcp = new MockMcpClient();
        const tools: Tool[] = [
            { name: 'random-tool', description: '', inputSchema: {} }
        ];

        const services = await discoverServices(mcp as unknown as McpClient, tools);
        assert.deepEqual(services, []);
    });

    await t.test('discoverServices should call compatible tool and cache results', async () => {
        const mcp = new MockMcpClient();
        mcp.mockResponse = {
            result: [
                { name: 'payment-service', type: 'service' },
                { name: 'auth-service' }
            ]
        };
        const tools: Tool[] = [
            { name: 'query-services', description: '', inputSchema: {} }
        ];

        const services = await discoverServices(mcp as unknown as McpClient, tools);

        assert.equal(services.length, 2);
        assert.ok(services.includes('payment-service'));
        assert.ok(services.includes('auth-service'));

        const cached = getCachedServices();
        assert.deepEqual(cached, services);
    });

    await t.test('discoverServices should use cache if valid', async () => {
        const mcp = new MockMcpClient();
        setCachedServices(['cached-svc']);

        const tools: Tool[] = [
            { name: 'query-services', description: '', inputSchema: {} }
        ];

        // Should return cached services without calling tool
        const services = await discoverServices(mcp as unknown as McpClient, tools);
        assert.deepEqual(services, ['cached-svc']);
        assert.equal(mcp.calls.length, 0);
    });
});
