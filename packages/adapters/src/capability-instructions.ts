import type { ConnectorTool } from "@rakazo/adapter-kit";

const MAX_TOOL_NAMES_IN_PROMPT = 80;

export function rakazoCapabilityInstruction(tools: readonly ConnectorTool[]): string {
  const names = tools.map((tool) => tool.name);
  const visible = names.slice(0, MAX_TOOL_NAMES_IN_PROMPT);
  const omitted = names.length - visible.length;
  const catalog = `${visible.join(", ")}${omitted > 0 ? `, and ${omitted} more` : ""}`;
  const graphical = names.includes("computer_observe") && names.includes("computer_act");

  return [
    "Rakazo owns your capabilities; the selected model provider only supplies reasoning.",
    `Rakazo tools available in this run (${names.length}): ${catalog || "none"}.`,
    "Rakazo tools are separate from any model runtime's installed skills. Never use a runtime skill list as evidence that a Rakazo capability is unavailable. Use a matching Rakazo tool before claiming you cannot perform an action.",
    graphical
      ? "For sites that require login, never ask for or extract raw passwords, cookies, or session tokens. Call request_takeover so the user signs in directly on the persistent computer, then continue with computer_observe and computer_act using that browser session."
      : "Never ask the user to paste passwords, cookies, session tokens, or other credentials into chat or workspace files.",
  ].join("\n");
}
