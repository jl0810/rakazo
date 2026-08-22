import type {
  AdapterContext,
  AgentRunRequest,
  AgentRuntime,
  AgentRuntimeEvent,
} from "@rakazo/adapter-kit";

export interface ProviderRoutingRuntimeOptions {
  fallback: AgentRuntime;
  routes: Record<string, AgentRuntime>;
  id?: string;
}

/**
 * Keeps model-provider transport choices behind the AgentRuntime boundary.
 * Rakazo still assembles one capability set and executor for every provider.
 */
export class ProviderRoutingAgentRuntime implements AgentRuntime {
  private readonly activeRuns = new Map<string, AgentRuntime>();

  constructor(private readonly options: ProviderRoutingRuntimeOptions) {}

  describe() {
    return {
      id: this.options.id ?? "provider-router",
      contractVersion: "1",
      adapterVersion: "0.1.0",
      capabilities: { streaming: true, compaction: true, tools: true, scripted: false },
    };
  }

  async abort(runId: string): Promise<void> {
    await this.activeRuns.get(runId)?.abort(runId);
  }

  async *run(request: AgentRunRequest, context: AdapterContext): AsyncIterable<AgentRuntimeEvent> {
    const runtime = this.options.routes[request.model.provider] ?? this.options.fallback;
    this.activeRuns.set(request.runId, runtime);
    try {
      yield* runtime.run(request, context);
    } finally {
      if (this.activeRuns.get(request.runId) === runtime) this.activeRuns.delete(request.runId);
    }
  }
}
