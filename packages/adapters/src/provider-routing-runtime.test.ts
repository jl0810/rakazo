import type {
  AdapterContext,
  AgentRunRequest,
  AgentRuntime,
  AgentRuntimeEvent,
} from "@rakazo/adapter-kit";
import { describe, expect, it } from "vitest";
import { createAgentRuntime } from "./agent-runtime-factory.js";
import { ProviderRoutingAgentRuntime } from "./provider-routing-runtime.js";

class RecordingRuntime implements AgentRuntime {
  readonly providers: string[] = [];

  constructor(private readonly label: string) {}

  describe() {
    return {
      id: this.label,
      contractVersion: "1",
      adapterVersion: "test",
      capabilities: { streaming: true, compaction: false, tools: true, scripted: false },
    };
  }

  async abort(): Promise<void> {}

  async *run(request: AgentRunRequest): AsyncIterable<AgentRuntimeEvent> {
    this.providers.push(request.model.provider);
    yield { type: "text", text: this.label };
    yield { type: "done", text: this.label };
  }
}

const context: AdapterContext = {
  operationId: "op",
  traceId: "trace",
  workspaceId: "workspace",
  userId: "user",
  signal: new AbortController().signal,
};

function request(provider: string): AgentRunRequest {
  return {
    botId: "bot",
    threadId: "thread",
    runId: `run-${provider}`,
    prompt: "hello",
    instructions: "",
    history: [],
    tools: [],
    model: { provider, id: "model" },
  };
}

async function textFrom(runtime: AgentRuntime, input: AgentRunRequest): Promise<string[]> {
  const text: string[] = [];
  for await (const event of runtime.run(input, context)) {
    if (event.type === "text") text.push(event.text);
  }
  return text;
}

describe("ProviderRoutingAgentRuntime", () => {
  it("uses the provider router for Devin-compatible deployments", () => {
    expect(createAgentRuntime("devin-cli").describe().id).toBe("rakazo-provider-router");
    expect(createAgentRuntime("pi").describe().id).toBe("pi");
  });

  it("keeps Devin transport scoped to Devin while custom providers use the fallback runtime", async () => {
    const pi = new RecordingRuntime("pi");
    const devin = new RecordingRuntime("devin-acp");
    const runtime = new ProviderRoutingAgentRuntime({
      fallback: pi,
      routes: { "devin-cli": devin, scripted: devin },
    });

    expect(await textFrom(runtime, request("scripted"))).toEqual(["devin-acp"]);
    expect(await textFrom(runtime, request("devin-cli"))).toEqual(["devin-acp"]);
    expect(await textFrom(runtime, request("openai"))).toEqual(["pi"]);
    expect(await textFrom(runtime, request("anthropic"))).toEqual(["pi"]);
    expect(devin.providers).toEqual(["scripted", "devin-cli"]);
    expect(pi.providers).toEqual(["openai", "anthropic"]);
  });
});
