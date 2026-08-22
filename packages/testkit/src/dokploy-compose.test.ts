import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const composeFile = path.resolve("infra/dokploy/docker-compose.yml");

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
    expect(serviceBlock(compose, service)).toMatch(/COMPOSIO_API_KEY:\s*"\$\{COMPOSIO_API_KEY\}"/);
  });
});
