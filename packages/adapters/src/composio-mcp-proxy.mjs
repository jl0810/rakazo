#!/usr/bin/env node
import { createInterface } from "node:readline";

const URL = process.env.COMPOSIO_MCP_URL;
const API_KEY = process.env.COMPOSIO_API_KEY;
const EXTRA_HEADERS = process.env.COMPOSIO_MCP_EXTRA_HEADERS;

if (!URL || !API_KEY) {
  process.stderr.write("[composio-mcp-proxy] Missing COMPOSIO_MCP_URL or COMPOSIO_API_KEY\n");
  process.exit(1);
}

let mcpSessionId = null;
let protocolVersion = null;

const extraHeaders = EXTRA_HEADERS ? JSON.parse(EXTRA_HEADERS) : {};

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });

async function forward(jsonRpcMessage) {
  let parsed;
  try {
    parsed = JSON.parse(jsonRpcMessage);
  } catch (err) {
    process.stderr.write(`[composio-mcp-proxy] Skip unparseable line: ${err.message}\n`);
    return;
  }

  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json",
    "X-API-Key": API_KEY,
    ...extraHeaders,
  };
  if (mcpSessionId) headers["Mcp-Session-Id"] = mcpSessionId;
  if (protocolVersion) headers["MCP-Protocol-Version"] = protocolVersion;

  try {
    const response = await fetch(URL, {
      method: "POST",
      headers,
      body: JSON.stringify(parsed),
    });

    const respSessionId = response.headers.get("mcp-session-id");
    if (respSessionId) mcpSessionId = respSessionId;

    if (!response.ok) {
      const errBody = await response.text().catch(() => "");
      process.stderr.write(`[composio-mcp-proxy] HTTP ${response.status}: ${errBody.slice(0, 200)}\n`);
      if (parsed.id !== undefined) {
        process.stdout.write(JSON.stringify({
          jsonrpc: "2.0",
          id: parsed.id,
          error: { code: -32603, message: `Composio HTTP ${response.status}` },
        }) + "\n");
      }
      return;
    }

    const responseBody = await response.text();
    if (responseBody.trim().length === 0) return;

    if (parsed.method === "initialize") {
      try {
        const r = JSON.parse(responseBody);
        if (r?.result?.protocolVersion) protocolVersion = r.result.protocolVersion;
      } catch {}
    }

    process.stdout.write(responseBody.trim() + "\n");
  } catch (err) {
    process.stderr.write(`[composio-mcp-proxy] Network error: ${err.message}\n`);
    if (parsed.id !== undefined) {
      process.stdout.write(JSON.stringify({
        jsonrpc: "2.0",
        id: parsed.id,
        error: { code: -32603, message: err.message },
      }) + "\n");
    }
  }
}

rl.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  forward(trimmed).catch((err) => {
    process.stderr.write(`[composio-mcp-proxy] Unhandled error: ${err.message}\n`);
  });
});

rl.on("close", () => process.exit(0));
