import type { AgentRunRequest, ConnectorTool } from "@rakazo/adapter-kit";
import { describe, expect, it } from "vitest";
import { rakazoCapabilityInstruction } from "./capability-instructions.js";
import { buildAcpPrompt } from "./devin-acp-runtime.js";

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
];

describe("Rakazo capability instructions", () => {
  it("separates runtime skills from Rakazo tools and preserves browser login sessions", () => {
    const instruction = rakazoCapabilityInstruction(tools);
    expect(instruction).toContain("model provider only supplies reasoning");
    expect(instruction).toContain("social.publish");
    expect(instruction).toContain("separate from any model runtime's installed skills");
    expect(instruction).toContain("request_takeover");
    expect(instruction).toContain("persistent computer");
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
  });
});
