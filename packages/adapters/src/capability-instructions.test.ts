import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentRunRequest, ConnectorTool } from "@rakazo/adapter-kit";
import { describe, expect, it } from "vitest";
import { rakazoCapabilityInstruction } from "./capability-instructions.js";
import {
  buildAcpPrompt,
  buildDevinChildEnv,
  selectPermissionOutcome,
  writeRakazoMcpConfig,
} from "./devin-acp-runtime.js";

const tools: ConnectorTool[] = [
  {
    name: "computer_observe",
    description: "Observe the computer",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "computer_act",
    description: "Use the computer",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "request_takeover",
    description: "Ask the user to take over",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "social.publish",
    description: "Publish through a connected social provider",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "list_capabilities",
    description: "List canonical Rakazo capabilities",
    inputSchema: { type: "object", properties: {} },
  },
];

describe("Rakazo capability instructions", () => {
  it("separates runtime skills from Rakazo tools and preserves browser login sessions", () => {
    const instruction = rakazoCapabilityInstruction(tools);
    expect(instruction).toContain("model provider only supplies reasoning");
    expect(instruction).toContain("social.publish");
    expect(instruction).toContain("separate from any model runtime's installed skills");
    expect(instruction).toContain("request_takeover");
    expect(instruction).toContain("persistent computer");
    expect(instruction).toContain("call list_capabilities");
    expect(instruction).toContain(
      "never ask for or extract raw passwords, cookies, or session tokens",
    );
  });

  it("tells Devin to use the MCP bridge instead of its skill catalog", () => {
    const request: AgentRunRequest = {
      botId: "bot",
      threadId: "thread",
      runId: "run",
      prompt: "Post after I log in",
      instructions: rakazoCapabilityInstruction(tools),
      history: [],
      tools,
      model: { provider: "devin-cli", id: "glm-5-2" },
    };
    const prompt = buildAcpPrompt(request);
    expect(prompt).toContain('"rakazo-connectors" MCP server');
    expect(prompt).toContain("These are Rakazo tools, not Devin skills");
    expect(prompt).toContain("mcp_list_tools");
    expect(prompt).toContain("mcp_call_tool");
    expect(prompt).toContain("social.publish");
    expect(prompt).toContain("Do not inspect Devin skill directories");
  });

  it("gives Devin an isolated environment without application secrets", () => {
    const env = buildDevinChildEnv(
      {
        LANG: "en_US.UTF-8",
        DATABASE_URL: "postgres://must-not-leak",
        COMPOSIO_API_KEY: "must-not-leak",
        DOKPLOY_API_KEY: "must-not-leak",
        OPENROUTER_API_KEY: "must-not-leak",
        DEVIN_XDG_DATA_HOME: "/provider-auth",
      },
      "/tmp/rakazo-devin-test",
      "glm-test",
    );
    expect(env).toMatchObject({
      LANG: "en_US.UTF-8",
      HOME: "/tmp/rakazo-devin-test/home",
      XDG_CONFIG_HOME: "/tmp/rakazo-devin-test/config",
      XDG_DATA_HOME: "/provider-auth",
      DEVIN_MODEL: "glm-test",
      DEVIN_PERMISSION_MODE: "auto",
    });
    expect(env.DATABASE_URL).toBeUndefined();
    expect(env.COMPOSIO_API_KEY).toBeUndefined();
    expect(env.DOKPLOY_API_KEY).toBeUndefined();
    expect(env.OPENROUTER_API_KEY).toBeUndefined();
  });

  it("writes a per-run MCP config containing only Rakazo", () => {
    const root = mkdtempSync(join(tmpdir(), "rakazo-mcp-test-"));
    try {
      const configPath = join(root, "config", "devin", "mcp_config.json");
      writeRakazoMcpConfig(configPath, join(root, "session.json"));
      const config = JSON.parse(readFileSync(configPath, "utf8")) as {
        mcpServers: Record<string, unknown>;
      };
      expect(Object.keys(config.mcpServers)).toEqual(["rakazo-connectors"]);
      expect(JSON.stringify(config)).not.toMatch(/dokploy|postgres|COMPOSIO_API_KEY/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("allows Rakazo MCP calls and rejects host tool permission requests", () => {
    const options = [{ optionId: "allow_server_session" }, { optionId: "reject_once" }];
    expect(
      selectPermissionOutcome(
        { title: "Call MCP tool", rawInput: { server: "rakazo-connectors" } },
        options,
        new Set(["list_capabilities"]),
      ),
    ).toEqual({ outcome: "selected", optionId: "allow_server_session" });
    expect(
      selectPermissionOutcome(
        { title: "Run shell command", rawInput: { command: "env" } },
        options,
        new Set(["list_capabilities"]),
      ),
    ).toEqual({ outcome: "selected", optionId: "reject_once" });
  });
});
