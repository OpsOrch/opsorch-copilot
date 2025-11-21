import { Tool, ToolCall, ToolResult } from '../types.js';
import { McpClient } from '../mcpClient.js';

/**
 * Mock MCP client for testing purposes.
 * Allows tests to provide custom tool lists and call handlers.
 */
export class MockMcp implements McpClient {
    private cachedTools: Tool[] = [];

    constructor(
        private toolProvider: () => Promise<Tool[]>,
        private callHandler: (call: ToolCall) => Promise<ToolResult>
    ) { }

    async listTools(): Promise<Tool[]> {
        this.cachedTools = await this.toolProvider();
        return this.cachedTools;
    }

    async callTool(call: ToolCall): Promise<ToolResult> {
        return this.callHandler(call);
    }

    async ensureTools(): Promise<void> {
        this.cachedTools = await this.toolProvider();
    }

    hasTool(name: string): boolean {
        return this.cachedTools.some(t => t.name === name);
    }

    getTools(): Tool[] {
        return this.cachedTools;
    }
}
