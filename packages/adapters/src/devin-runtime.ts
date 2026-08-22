import type {
  AdapterContext,
  AgentRunRequest,
  AgentRuntime,
  AgentRuntimeEvent,
} from "@rakazo/adapter-kit";

const DEVIN_BASE_URL = "https://api.devin.ai/v3";
const POLL_INTERVAL_MS = 3_000;

const running = new Map<string, AbortController>();

type DevinSessionResponse = {
  session_id: string;
  url: string;
  status: string;
  status_detail?: string | null;
};

type DevinMessage = {
  id: string;
  type: string;
  text?: string;
  content?: string;
  timestamp?: string;
};

type DevinMessagesResponse = {
  messages: DevinMessage[];
};

export class DevinAgentRuntime implements AgentRuntime {
  private readonly apiKey: string;
  private readonly orgId: string;

  constructor(opts: { apiKey: string; orgId: string }) {
    this.apiKey = opts.apiKey;
    this.orgId = opts.orgId;
  }

  describe() {
    return {
      id: "devin",
      contractVersion: "1",
      adapterVersion: "0.1.0",
      capabilities: { streaming: false, compaction: false, tools: false, scripted: false },
    };
  }

  async abort(runId: string): Promise<void> {
    running.get(runId)?.abort();
  }

  async *run(request: AgentRunRequest, context: AdapterContext): AsyncIterable<AgentRuntimeEvent> {
    const controller = new AbortController();
    running.set(request.runId, controller);
    const signal = context.signal ?? controller.signal;

    try {
      const fullPrompt = buildPrompt(request);

      yield { type: "progress", text: "Creating Devin session…" };

      const session = await this.createSession(fullPrompt, signal);
      const sessionId = session.session_id;

      yield { type: "progress", text: `Devin session: ${session.url}` };

      let lastMessageCount = 0;
      let assembled = "";

      while (!signal.aborted) {
        await sleep(POLL_INTERVAL_MS, signal);
        if (signal.aborted) break;

        const status = await this.getSessionStatus(sessionId, signal);

        if (status.status === "error") {
          yield { type: "text", text: `Devin error: ${status.status_detail ?? "unknown"}` };
          yield { type: "done", text: assembled };
          return;
        }

        const messages = await this.getMessages(sessionId, signal);
        const newMessages = messages.slice(lastMessageCount);
        lastMessageCount = messages.length;

        for (const msg of newMessages) {
          const text = msg.text ?? msg.content ?? "";
          if (text) {
            assembled += text;
            yield { type: "text", text };
          }
        }

        if (status.status === "exit" || status.status_detail === "finished") {
          if (!assembled) {
            yield { type: "text", text: "Devin completed the task." };
          }
          yield {
            type: "usage",
            inputTokens: 0,
            outputTokens: 0,
            provider: "devin",
            model: "devin",
          };
          yield { type: "done", text: assembled || "Devin completed the task." };
          return;
        }

        if (status.status_detail === "waiting_for_user") {
          yield {
            type: "ask",
            text: "Devin needs your input. Reply to continue.",
            detail: session.url,
          };
          return;
        }

        if (status.status_detail === "waiting_for_approval") {
          yield {
            type: "ask",
            text: "Devin is waiting for approval. Approve in the Devin UI to continue.",
            detail: session.url,
          };
          return;
        }

        yield { type: "progress", text: `Devin status: ${status.status_detail ?? status.status}` };
      }

      yield { type: "done", text: "stopped" };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      yield { type: "text", text: `Devin runtime error: ${message}` };
      yield { type: "done", text: message };
    } finally {
      running.delete(request.runId);
    }
  }

  private async createSession(prompt: string, signal: AbortSignal): Promise<DevinSessionResponse> {
    const res = await fetch(`${DEVIN_BASE_URL}/organizations/${this.orgId}/sessions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ prompt }),
      signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "unknown");
      throw new Error(`Devin create session failed (${res.status}): ${body}`);
    }
    return (await res.json()) as DevinSessionResponse;
  }

  private async getSessionStatus(
    sessionId: string,
    signal: AbortSignal,
  ): Promise<DevinSessionResponse> {
    const res = await fetch(`${DEVIN_BASE_URL}/organizations/${this.orgId}/sessions/${sessionId}`, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
      signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "unknown");
      throw new Error(`Devin get session failed (${res.status}): ${body}`);
    }
    return (await res.json()) as DevinSessionResponse;
  }

  private async getMessages(sessionId: string, signal: AbortSignal): Promise<DevinMessage[]> {
    const res = await fetch(
      `${DEVIN_BASE_URL}/organizations/${this.orgId}/sessions/${sessionId}/messages`,
      {
        headers: { Authorization: `Bearer ${this.apiKey}` },
        signal,
      },
    );
    if (!res.ok) {
      return [];
    }
    const data = (await res.json()) as DevinMessagesResponse;
    return data.messages ?? [];
  }
}

function buildPrompt(request: AgentRunRequest): string {
  const parts: string[] = [];

  if (request.instructions) {
    parts.push(`## Instructions\n${request.instructions}`);
  }

  if (request.history.length > 0) {
    const historyText = request.history.map((msg) => `[${msg.role}]: ${msg.content}`).join("\n\n");
    parts.push(`## Previous context\n${historyText}`);
  }

  parts.push(`## Task\n${request.prompt}`);

  return parts.join("\n\n");
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
