import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { allTools } from "./mcp/tools/index.js";
import type { ToolDefinition } from "./mcp/tools/toolFactory.js";

export function createServer() {
  const server = new McpServer({
    name: "dokploy",
    version: "1.0.0",
  });

  for (const tool of allTools as ToolDefinition<any>[]) {
    if (!tool || !tool.name || !tool.schema) {
      console.warn(`Skipping invalid tool definition:`, tool);
      continue;
    }
    server.tool(tool.name, tool.description, tool.schema.shape, tool.handler);
  }

  return server;
}
