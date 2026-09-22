import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const composeFile = path.resolve("infra/dokploy/dokploy-compose.yml");
const dockerfile = path.resolve("infra/dokploy/Dockerfile");

function serviceBlock(compose: string, service: string): string {
  const match = compose.match(
    new RegExp(`(?:^|\\n)  ${service}:\\n([\\s\\S]*?)(?=\\n  [a-zA-Z0-9_-]+:\\n|\\nvolumes:|$)`),
  );
  if (!match?.[1]) throw new Error(`Missing ${service} service in ${composeFile}`);
  return match[1];
}

describe("Dokploy deployment contract", () => {
  it.each(["api", "worker"])("passes Composio credentials to the %s service", (service) => {
    const compose = readFileSync(composeFile, "utf8");
    expect(serviceBlock(compose, service)).toMatch(/COMPOSIO_API_KEY=\$\{COMPOSIO_API_KEY\}/);
  });

  it.each(["api", "worker"])("does not expose operator MCP credentials to %s", (service) => {
    const compose = readFileSync(composeFile, "utf8");
    const block = serviceBlock(compose, service);
    expect(block).not.toMatch(/DOKPLOY_API_KEY|DOKPLOY_URL|POSTGRES_MCP_URL/);
    expect(block).not.toContain("render-mcp-config");
  });

  it("does not bundle global infrastructure MCP servers into the runtime image", () => {
    const source = readFileSync(dockerfile, "utf8");
    expect(source).not.toMatch(/mcp_config\.template|render-mcp-config|dokploy-mcp|uvx/);
  });
});
