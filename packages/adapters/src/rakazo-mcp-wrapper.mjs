#!/usr/bin/env node
/**
 * Rakazo MCP Bridge Wrapper
 *
 * Reads per-session config from RAKAZO_MCP_SESSION_FILE,
 * then launches the actual MCP bridge with the right env vars.
 * This allows the Devin CLI's static mcp_config.json to point
 * to this wrapper, while each ACP session gets its own tools
 * and executor URL.
 */

import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const bridgeScript = join(here, "rakazo-mcp-bridge.mjs");

const sessionFile = process.env.RAKAZO_MCP_SESSION_FILE;
if (!sessionFile) {
  process.stderr.write("[rakazo-mcp-wrapper] Missing RAKAZO_MCP_SESSION_FILE\n");
  process.exit(1);
}

let config;
try {
  config = JSON.parse(readFileSync(sessionFile, "utf-8"));
} catch (err) {
  process.stderr.write(`[rakazo-mcp-wrapper] Failed to read session file: ${err}\n`);
  process.exit(1);
}

const child = spawn(process.execPath, [bridgeScript], {
  env: {
    ...process.env,
    RAKAZO_MCP_TOOLS: JSON.stringify(config.tools || []),
    RAKAZO_TOOL_EXECUTOR_URL: config.executorUrl,
  },
  stdio: ["inherit", "inherit", "inherit"],
});

child.on("exit", (code) => process.exit(code ?? 0));
