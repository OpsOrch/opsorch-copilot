import { RuntimeConfig } from "./types.js";
import { McpClient } from "./mcpClient.js";
import { OpsOrchMcp } from "./mcps/opsorch.js";

export class McpFactory {
  static create(config: RuntimeConfig): McpClient {
    return new OpsOrchMcp(config.mcpUrl);
  }
}
