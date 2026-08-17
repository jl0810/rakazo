// Renders the Devin MCP config from its template by substituting ${VAR}
// placeholders with environment variables at container start. Keeps real
// credentials out of the public repo; set the values in Dokploy's
// environment settings instead.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const templatePath =
  process.env.MCP_CONFIG_TEMPLATE ?? "/root/.config/devin/mcp_config.template.json";
const outputPath = process.env.MCP_CONFIG_OUTPUT ?? "/root/.config/devin/mcp_config.json";

const template = readFileSync(templatePath, "utf8");
const missing = [];
const rendered = template.replace(/\$\{(\w+)\}/g, (_, name) => {
  const value = process.env[name];
  if (value === undefined || value === "") missing.push(name);
  return value ?? "";
});

if (missing.length > 0) {
  console.warn(`[render-mcp-config] missing env vars: ${[...new Set(missing)].join(", ")}`);
}

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, rendered);
console.log(`[render-mcp-config] wrote ${outputPath}`);
