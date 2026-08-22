import type { AgentRuntime } from "@rakazo/adapter-kit";
import { DevinAcpRuntime } from "./devin-acp-runtime.js";
import { DevinAgentRuntime } from "./devin-runtime.js";
import { PiAgentRuntime } from "./pi-runtime.js";
import { ProviderRoutingAgentRuntime } from "./provider-routing-runtime.js";
import { ScriptedAgentRuntime } from "./scripted-runtime.js";

export interface AgentRuntimeFactoryOptions {
  devinApiKey?: string;
  devinOrgId?: string;
}

export function createAgentRuntime(
  kind: string,
  options: AgentRuntimeFactoryOptions = {},
): AgentRuntime {
  if (kind === "scripted") return new ScriptedAgentRuntime();
  if (kind === "devin") {
    return new DevinAgentRuntime({
      apiKey: options.devinApiKey ?? "",
      orgId: options.devinOrgId ?? "",
    });
  }
  if (kind === "devin-cli") {
    const devin = new DevinAcpRuntime();
    return new ProviderRoutingAgentRuntime({
      id: "rakazo-provider-router",
      fallback: new PiAgentRuntime(),
      routes: {
        "devin-cli": devin,
        // Existing Devin deployments use scripted as the no-BYOK sentinel.
        // Preserve Devin as their default while routing configured providers through Pi.
        scripted: devin,
      },
    });
  }
  return new PiAgentRuntime();
}
