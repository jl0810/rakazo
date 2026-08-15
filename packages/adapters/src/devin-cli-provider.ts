import { spawn } from "node:child_process";
import { createProvider } from "@earendil-works/pi-ai";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import type {
  AssistantMessage,
  AssistantMessageEvent,
  Context,
  Model,
  SimpleStreamOptions,
} from "@earendil-works/pi-ai";

const DEFAULT_CLI_PATH =
  "/Applications/Devin.app/Contents/Resources/app/extensions/windsurf/devin/bin/devin";
const DEFAULT_MODEL = "glm-5-2";

const ZERO_COST = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  total: 0,
};

const ZERO_USAGE = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { ...ZERO_COST },
};

function randomId(prefix: string): string {
  return `${prefix}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
}

function buildCliPrompt(context: Context): string {
  const parts: string[] = [];

  if (context.systemPrompt) {
    parts.push(context.systemPrompt);
  }

  for (const msg of context.messages) {
    if (msg.role === "user") {
      const text = typeof msg.content === "string" ? msg.content : msg.content.map((b) => b.type === "text" ? b.text : "").join("");
      parts.push(`User: ${text}`);
    } else if (msg.role === "assistant") {
      const text = msg.content.map((b) => b.type === "text" ? b.text : "").join("");
      if (text) parts.push(`Assistant: ${text}`);
    } else if (msg.role === "toolResult") {
      const text = msg.content.map((b) => b.type === "text" ? b.text : "").join("");
      parts.push(`Tool result (${msg.toolName}): ${text}`);
    }
  }

  return parts.join("\n\n");
}

function runDevinCli(
  cliPath: string,
  modelId: string,
  prompt: string,
  signal: AbortSignal,
): Promise<{ stdout: string; stderr: string; exitCode: number; aborted: boolean }> {
  return new Promise((resolve) => {
    const args = [
      "-p",
      "--model",
      modelId,
      "--respect-workspace-trust",
      "false",
      "--",
      prompt,
    ];

    const child = spawn(cliPath, args, {
      env: { ...process.env },
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let aborted = false;

    child.stdout?.on("data", (data: Buffer) => {
      stdout += data.toString();
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

function stripCliStatusLines(text: string): string {
  return text
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
}

function makeStream(
  model: Model<string>,
  cliPath: string,
): (m: Model<string>, ctx: Context, options?: SimpleStreamOptions) => ReturnType<typeof createAssistantMessageEventStream> {
  return (_model, ctx, options) => {
    const stream = createAssistantMessageEventStream();
    const signal = options?.signal ?? new AbortController().signal;

    const baseMessage: AssistantMessage = {
      role: "assistant",
      content: [],
      api: "devin-cli",
      provider: "devin-cli",
      model: model.id,
      usage: { ...ZERO_USAGE },
      stopReason: "pending",
      timestamp: Date.now(),
    };

    stream.push({ type: "start", partial: baseMessage });

    (async () => {
      try {
        const prompt = buildCliPrompt(ctx);
        const result = await runDevinCli(cliPath, model.id, prompt, signal);

        if (result.aborted) {
          const errorMsg: AssistantMessage = {
            ...baseMessage,
            stopReason: "aborted",
            errorMessage: "aborted",
          };
          stream.push({ type: "error", reason: "aborted", error: errorMsg });
          stream.end(errorMsg);
          return;
        }

        if (result.exitCode !== 0) {
          const errorText = result.stderr || result.stdout || "unknown error";
          const errorMsg: AssistantMessage = {
            ...baseMessage,
            stopReason: "error",
            errorMessage: errorText,
          };
          stream.push({ type: "error", reason: "error", error: errorMsg });
          stream.end(errorMsg);
          return;
        }

        const text = stripCliStatusLines(result.stdout);

        if (text) {
          const partial: AssistantMessage = {
            ...baseMessage,
            content: [{ type: "text", text: "" }],
          };
          stream.push({ type: "text_start", contentIndex: 0, partial });

          stream.push({
            type: "text_delta",
            contentIndex: 0,
            delta: text,
            partial: { ...partial, content: [{ type: "text", text }] },
          });

          stream.push({
            type: "text_end",
            contentIndex: 0,
            content: text,
            partial: { ...partial, content: [{ type: "text", text }] },
          });
        }

        const finalMessage: AssistantMessage = {
          ...baseMessage,
          content: text ? [{ type: "text", text }] : [],
          stopReason: "stop",
          usage: { ...ZERO_USAGE },
        };

        stream.push({ type: "done", reason: "stop", message: finalMessage });
        stream.end(finalMessage);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const errorMsg: AssistantMessage = {
          ...baseMessage,
          stopReason: "error",
          errorMessage: message,
        };
        stream.push({ type: "error", reason: "error", error: errorMsg });
        stream.end(errorMsg);
      }
    })();

    return stream;
  };
}

export function createDevinCliProvider(opts: { cliPath?: string; modelId?: string } = {}) {
  const cliPath = opts.cliPath ?? process.env.DEVIN_CLI_PATH ?? DEFAULT_CLI_PATH;
  const modelId = opts.modelId ?? process.env.DEVIN_MODEL ?? DEFAULT_MODEL;

  const model: Model<string> = {
    id: modelId,
    name: `Devin CLI (${modelId})`,
    api: "devin-cli" as string,
    provider: "devin-cli",
    baseUrl: "http://localhost:0",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 200_000,
    maxTokens: 8192,
  };

  const streamFn = makeStream(model, cliPath);

  const provider = createProvider({
    id: "devin-cli",
    name: "Devin CLI",
    auth: {
      apiKey: {
        name: "Devin CLI (authenticated via `devin auth login`)",
        resolve: async () => ({ auth: {} }),
      },
    },
    models: [model],
    api: {
      stream: streamFn as any,
      streamSimple: streamFn as any,
    },
  });

  return { provider, model };
}
