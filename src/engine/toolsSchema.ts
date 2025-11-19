import { Tool, ToolCall } from '../types.js';

export function createMissingArgChecker(tools: Tool[]) {
  const toolMap = new Map(tools.map((tool) => [tool.name, tool]));

  return function getMissingRequiredArgs(call: ToolCall): string[] {
    const tool = toolMap.get(call.name);
    const schema = tool?.inputSchema;
    if (!schema || typeof schema !== 'object') {
      return [];
    }
    const required = Array.isArray((schema as any).required) ? ((schema as any).required as string[]) : [];
    if (!required.length) return [];
    const args = call.arguments || {};
    const missing: string[] = [];
    for (const field of required) {
      const value = (args as Record<string, any>)[field];
      if (value === undefined || value === null) {
        missing.push(field);
      } else if (typeof value === 'string' && !value.trim()) {
        missing.push(field);
      }
    }
    return missing;
  };
}
