import { spawn } from "node:child_process";
import type {
  AdapterContext,
  AgentRunRequest,
  AgentRuntime,
  AgentRuntimeEvent,
} from "@rakazo/adapter-kit";

const running = new Map<string, AbortController>();

const DEFAULT_CLI_PATH =
  "/Applications/Devin.app/Contents/Resources/app/extensions/windsurf/devin/bin/devin";
const DEFAULT_MODEL = "glm-5-2";

type CliResult = { stdout: string; stderr: string; exitCode: number; aborted: boolean };

export class DevinCliRuntime implements AgentRuntime {
  private readonly cliPath: string;
  private readonly model: string;

  constructor(opts: { cliPath?: string; model?: string } = {}) {
    this.cliPath = opts.cliPath ?? process.env.DEVIN_CLI_PATH ?? DEFAULT_CLI_PATH;
    this.model = opts.model ?? process.env.DEVIN_MODEL ?? DEFAULT_MODEL;
  }

  describe() {
    return {
      id: "devin-cli",
      contractVersion: "1",
      adapterVersion: "0.1.0",
      capabilities: { streaming: true, compaction: false, tools: false, scripted: false },
    };
  }

  async abort(runId: string): Promise<void> {
    running.get(runId)?.abort();
  }

  async *run(request: AgentRunRequest, context: AdapterContext): AsyncIterable<AgentRuntimeEvent> {
    const controller = new AbortController();
    running.set(request.runId, controller);
    const signal = context.signal ?? controller.signal;

    const queue = createQueue();

    const work = (async () => {
      try {
        const prompt = buildPrompt(request);

        queue.push({ type: "progress", text: `Devin CLI (${this.model}) starting…` });

        const result = await this.runCli(prompt, signal, () => {
          // Progress events are emitted via stderr or specific markers
          // stdout contains the final response - don't push it as progress
        });

        if (result.aborted) {
          queue.push({ type: "done", text: "stopped" });
          return;
        }

        if (result.exitCode !== 0) {
          queue.push({
            type: "text",
            text: `Devin CLI error: ${result.stderr || result.stdout}`,
          });
          queue.push({ type: "done", text: result.stderr || "error" });
          return;
        }

        // Strip CLI status lines from stdout to get just the model response
        const text = result.stdout
          .split("\n")
          .filter((line) => {
            const trimmed = line.trim();
            return (
              trimmed &&
              !trimmed.startsWith("✓") &&
              !trimmed.startsWith("Welcome") &&
              !trimmed.startsWith("Logged in") &&
              !trimmed.startsWith("Organization:") &&
              !trimmed.startsWith("Connected GitHub")
            );
          })
          .join("\n")
          .trim();

        if (text) {
          queue.push({ type: "text", text });
        }

        queue.push({
          type: "usage",
          inputTokens: 0,
          outputTokens: 0,
          provider: "devin-cli",
          model: this.model,
        });

        queue.push({ type: "done", text: text || undefined });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        queue.push({ type: "text", text: `Devin CLI error: ${message}` });
        queue.push({ type: "done", text: message });
      } finally {
        queue.close();
      }
    })();

    try {
      yield* queue.iterate();
      await work;
    } finally {
      running.delete(request.runId);
    }
  }

  private runCli(
    prompt: string,
    signal: AbortSignal,
    onLine: (line: string) => void,
  ): Promise<CliResult> {
    return new Promise((resolve) => {
      const args = [
        "-p",
        "--model",
        this.model,
        "--permission-mode",
        "dangerous",
        "--respect-workspace-trust",
        "false",
        "--",
        prompt,
      ];

      const child = spawn(this.cliPath, args, {
        env: { ...process.env },
        stdio: ["pipe", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";
      let aborted = false;

      child.stdout?.on("data", (data: Buffer) => {
        const chunk = data.toString();
        stdout += chunk;
        for (const line of chunk.split("\n")) {
          if (line.trim()) onLine(line);
        }
      });

      child.stderr?.on("data", (data: Buffer) => {
        stderr += data.toString();
      });

      const onAbort = () => {
        aborted = true;
        child.kill("SIGTERM");
        setTimeout(() => child.kill("SIGKILL"), 5000);
      };
      signal.addEventListener("abort", onAbort, { once: true });

      child.on("close", (code) => {
        signal.removeEventListener("abort", onAbort);
        resolve({ stdout, stderr, exitCode: code ?? 0, aborted });
      });

      child.on("error", (err) => {
        signal.removeEventListener("abort", onAbort);
        resolve({ stdout, stderr: stderr + err.message, exitCode: 1, aborted });
      });
    });
  }
}

function buildPrompt(request: AgentRunRequest): string {
  const parts: string[] = [];

  if (request.instructions) {
    parts.push(`## Instructions\n${request.instructions}`);
  }

  if (request.tools.length > 0) {
    const toolText = request.tools.map((t) => `- **${t.name}**: ${t.description}`).join("\n");
    parts.push(
      `## Available tools\nYou have access to these tools. Use shell commands to interact with external services when possible.\n${toolText}`,
    );
  }

  if (request.history.length > 0) {
    const historyText = request.history.map((msg) => `[${msg.role}]: ${msg.content}`).join("\n\n");
    parts.push(`## Previous context\n${historyText}`);
  }

  parts.push(`## Task\n${request.prompt}`);

  return parts.join("\n\n");
}

type QueueItem = AgentRuntimeEvent | { type: "__close__" };

function createQueue() {
  const items: QueueItem[] = [];
  let done = false;
  const waiters: Array<() => void> = [];

  return {
    push(item: AgentRuntimeEvent) {
      items.push(item);
      const next = waiters.shift();
      if (next) next();
    },
    close() {
      done = true;
      items.push({ type: "__close__" });
      const next = waiters.shift();
      if (next) next();
    },
    async *iterate(): AsyncIterable<AgentRuntimeEvent> {
      while (true) {
        while (items.length > 0) {
          const item = items.shift()!;
          if (item.type === "__close__") return;
          yield item;
        }
        if (done) return;
        await new Promise<void>((resolve) => {
          waiters.push(resolve);
        });
      }
    },
  };
}
