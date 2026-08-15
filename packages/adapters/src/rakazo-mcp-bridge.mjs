#!/usr/bin/env node
/**
 * Rakazo MCP Bridge — stdio MCP server that proxies tool calls
 * from the Devin CLI agent to Rakazo's connector executor.
 *
 * The ACP runtime starts a temporary HTTP server wrapping
 * request.executeTool, then spawns this script via the Devin
 * session's mcpServers config. The Devin agent calls tools
 * through standard MCP protocol; this bridge forwards each
 * call to the HTTP endpoint and returns the result.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const tools = JSON.parse(process.env.RAKAZO_MCP_TOOLS || "[]");
const EXECUTOR_URL = process.env.RAKAZO_TOOL_EXECUTOR_URL;

if (!EXECUTOR_URL) {
  process.stderr.write("[rakazo-mcp] Missing RAKAZO_TOOL_EXECUTOR_URL\n");
  process.exit(1);
}

async function main() {
  const server = new Server(
    { name: "rakazo-connectors", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema || { type: "object", properties: {} },
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
      const response = await fetch(EXECUTOR_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, args: args ?? {} }),
      });
      const result = await response.json();
      return {
        content: [
          {
            type: "text",
            text: typeof result === "string" ? result : JSON.stringify(result, null, 2),
          },
        ],
        isError: Boolean(result?.error),
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        isError: true,
        content: [{ type: "text", text: `Rakazo connector error: ${message}` }],
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  process.stderr.write(`[rakazo-mcp] Fatal: ${err}\n`);
  process.exit(1);
});
