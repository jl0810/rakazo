import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type Server as HttpServer } from "node:http";
import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type {
  AdapterContext,
  AgentRunRequest,
  AgentRuntime,
  AgentRuntimeEvent,
} from "@rakazo/adapter-kit";

const DEFAULT_CLI_PATH =
  "/Applications/Devin.app/Contents/Resources/app/extensions/windsurf/devin/bin/devin";
const DEFAULT_MODEL = "glm-5-2";

const ADAPTERS_DIR = (() => {
  const here = dirname(fileURLToPath(import.meta.url));
  return here;
})();

const WRAPPER_SCRIPT = join(ADAPTERS_DIR, "rakazo-mcp-wrapper.mjs");

const DEVIN_MCP_CONFIG = join(homedir(), ".config", "devin", "mcp_config.json");
const RAKAZO_MCP_SERVER_NAME = "rakazo-connectors";

const running = new Map<string, AbortController>();

type JsonRpcRequest = {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params: Record<string, unknown>;
};

type JsonRpcNotification = {
  jsonrpc: "2.0";
  method: string;
  params: Record<string, unknown>;
};

type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
};

export class DevinAcpRuntime implements AgentRuntime {
  private cliPath: string;
  private model: string;

  constructor() {
    this.cliPath = process.env.DEVIN_CLI_PATH ?? DEFAULT_CLI_PATH;
    this.model = process.env.DEVIN_MODEL ?? DEFAULT_MODEL;
  }

  describe() {
    return {
      id: "devin-cli",
      contractVersion: "1",
      adapterVersion: "0.2.0",
      capabilities: { streaming: true, compaction: false, tools: true, scripted: false },
    };
  }

  async abort(runId: string): Promise<void> {
    running.get(runId)?.abort();
  }

  async *run(
    request: AgentRunRequest,
    context: AdapterContext,
  ): AsyncIterable<AgentRuntimeEvent> {
    const controller = new AbortController();
    running.set(request.runId, controller);
    const signal = context.signal ?? controller.signal;

    const queue = createQueue();

    const work = (async () => {
      let proc: ChildProcess | null = null;
      let toolExecutor: { port: number; close: () => void } | null = null;
      let sessionFilePath: string | null = null;

      try {
        // 1. Start temporary HTTP server for tool execution (before spawning CLI)
        toolExecutor = await startToolExecutor(request);

        // 2. Write per-session MCP config file and update Devin's MCP config (before spawning CLI)
        sessionFilePath = `/tmp/rakazo-mcp-session-${request.runId}.json`;
        if (request.tools.length > 0) {
          writeFileSync(sessionFilePath, JSON.stringify({
            tools: request.tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
            executorUrl: `http://127.0.0.1:${toolExecutor.port}/execute`,
          }));
          ensureMcpConfig(sessionFilePath);
        }

        // 3. Spawn Devin CLI (it reads mcp_config.json at startup)
        proc = spawn(this.cliPath, ["acp", "--model", this.model], {
          env: { ...process.env, DEVIN_MODE: "autonomous" },
          stdio: ["pipe", "pipe", "pipe"],
        });

        // Capture Devin stderr for debugging MCP connection issues
        const logFile = `/tmp/devin-stderr-${request.runId}.log`;
        proc.stderr?.on("data", (data: Buffer) => {
          try {
            writeFileSync(logFile, data, { flag: "a" });
          } catch {}
        });

        const rpc = new AcpClient(proc, request.runId);

        // Handle abort
        const onAbort = () => {
          rpc.notify("session/cancel", { sessionId: rpc.sessionId ?? "" });
          setTimeout(() => proc?.kill("SIGKILL"), 5000);
        };
        signal.addEventListener("abort", onAbort, { once: true });

        // 4. Initialize
        const initResult = await rpc.request("initialize", {
          protocolVersion: 1,
          clientInfo: { name: "rakazo", title: "Rakazo", version: "0.1.0" },
          clientCapabilities: {},
        });
        if (!initResult) {
          queue.push({ type: "text", text: "Failed to initialize Devin ACP session" });
          queue.push({ type: "done" });
          return;
        }

        // 5. Create session (MCP servers are loaded from Devin config file; mode is autonomous for plug-and-play)
        const sessionResult = await rpc.request("session/new", {
          cwd: process.cwd(),
          mcpServers: [],
          mode: "autonomous",
        }) as { sessionId?: string } | null;

        if (!sessionResult?.sessionId) {
          queue.push({ type: "text", text: "Failed to create Devin ACP session" });
          queue.push({ type: "done" });
          return;
        }

        rpc.sessionId = sessionResult.sessionId;

        // 6. Build and send prompt (tools are now available via MCP — no need to list them in the prompt)
        const prompt = buildAcpPrompt(request);
        queue.push({ type: "progress", text: `Devin ACP (${this.model}) working…` });

        // Collect updates as they come
        rpc.onUpdate((update) => {
          const su = update.update as Record<string, unknown>;
          const kind = su.sessionUpdate as string;

          if (kind === "agent_message_chunk") {
            const content = su.content as { type: string; text: string };
            if (content?.text) queue.push({ type: "text", text: content.text });
          } else if (kind === "agent_message") {
            const content = su.content as Array<{ type: string; text: string }>;
            const text = content?.map((c) => c.text).join("") ?? "";
            if (text) queue.push({ type: "text", text });
          } else if (kind === "agent_thought" || kind === "agent_thought_chunk") {
            const content = su.content as { type: string; text: string } | Array<{ type: string; text: string }>;
            const text = Array.isArray(content) ? content.map((c) => c.text).join("") : content?.text ?? "";
            if (text) queue.push({ type: "progress", text });
          } else if (kind === "tool_call_update") {
            const status = su.status as string;
            const title = su.title as string;
            const toolCallId = su.toolCallId as string;
            if (status === "in_progress" && title) {
              queue.push({ type: "progress", text: `${title}…` });
            }
            if (status === "completed") {
              const content = su.content as Array<{ type: string; content: { type: string; text: string } }>;
              const resultText = content?.map((c) => c.content?.text).join("") ?? "";
              queue.push({
                type: "tool",
                name: title || "devin_tool",
                args: { toolCallId, result: resultText },
                executionId: `${request.runId}:${toolCallId}`,
              });
            }
          } else if (kind === "usage_update") {
            const used = su.used as number;
            const meta = su._meta as { "cognition.ai/inputTokens"?: number; "cognition.ai/outputTokens"?: number } | undefined;
            queue.push({
              type: "usage",
              inputTokens: meta?.["cognition.ai/inputTokens"] ?? 0,
              outputTokens: meta?.["cognition.ai/outputTokens"] ?? 0,
              provider: "devin-cli",
              model: this.model,
            });
          }
        });

        // 7. Send prompt and wait for completion
        const promptResult = await rpc.request("session/prompt", {
          sessionId: rpc.sessionId,
          prompt: [{ type: "text", text: prompt }],
        }) as { stopReason?: string } | null;

        signal.removeEventListener("abort", onAbort);

        // 8. Close session
        try {
          await rpc.request("session/close", { sessionId: rpc.sessionId });
        } catch {
          // ignore close errors
        }

        queue.push({ type: "done" });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        queue.push({ type: "text", text: `Devin ACP error: ${message}` });
        queue.push({ type: "done" });
      } finally {
        proc?.kill("SIGTERM");
        toolExecutor?.close();
        if (sessionFilePath) { try { unlinkSync(sessionFilePath); } catch {} }
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
}

class AcpClient {
  private proc: ChildProcess;
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private updateHandler: ((notification: JsonRpcNotification) => void) | null = null;
  private idleResolve: (() => void) | null = null;
  private buffer = "";
  private runId: string;

  sessionId: string | null = null;

  constructor(proc: ChildProcess, runId: string) {
    this.proc = proc;
    this.runId = runId;
    this.proc.stdout?.on("data", (data: Buffer) => {
      this.buffer += data.toString();
      this.processBuffer();
    });
    this.proc.stderr?.on("data", () => {
      // Ignore stderr - ACP logs go there
    });
  }

  private processBuffer() {
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const msg = JSON.parse(trimmed);
        try {
          writeFileSync(`/tmp/devin-acp-messages-${this.runId}.jsonl`, JSON.stringify({ receivedAt: Date.now(), ...msg }) + "\n", { flag: "a" });
        } catch {}
        this.handleMessage(msg);
      } catch {
        // Not JSON, skip
      }
    }
  }

  private handleMessage(msg: Record<string, unknown>) {
    const hasMethod = typeof msg.method === "string";
    const hasId = msg.id !== undefined && msg.id !== null;

    if (hasMethod && hasId) {
      // Server is sending us a request
      if (msg.method === "session/request_permission") {
        const params = msg.params as { sessionId?: string; toolCall?: { toolCallId?: string }; options?: Array<{ optionId: string }> };
        const allowAlways = params.options?.find((o) => o.optionId === "allow_server_always");
        const allowSession = params.options?.find((o) => o.optionId === "allow_server_session");
        const selected = allowAlways ?? allowSession ?? params.options?.[0];
        this.respond(msg.id, {
          sessionId: params.sessionId,
          toolCallId: params.toolCall?.toolCallId,
          outcome: {
            outcome: "selected",
            optionId: selected?.optionId ?? "allow_once",
          },
        });
      } else if (msg.method === "session/update") {
        this.updateHandler?.(msg as JsonRpcNotification);
      } else {
        this.respond(msg.id, {});
      }
      return;
    }

    if (hasId) {
      // Response to a request we sent
      const id = msg.id as number;
      const pending = this.pending.get(id);
      if (pending) {
        this.pending.delete(id);
        if (msg.error) {
          pending.reject(new Error((msg.error as { message: string }).message));
        } else {
          pending.resolve(msg.result);
        }
      }
    } else if (hasMethod && msg.method === "session/update") {
      this.updateHandler?.(msg as JsonRpcNotification);
    }
  }

  respond(id: unknown, result: Record<string, unknown>): void {
    const resp: JsonRpcResponse = { jsonrpc: "2.0", id: id as number, result };
    this.proc.stdin?.write(JSON.stringify(resp) + "\n");
  }

  request(method: string, params: Record<string, unknown>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const req: JsonRpcRequest = { jsonrpc: "2.0", id, method, params };
      this.pending.set(id, { resolve, reject });
      this.proc.stdin?.write(JSON.stringify(req) + "\n");

      // Timeout after 120 seconds
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`ACP request timeout: ${method}`));
        }
      }, 120_000);
    });
  }

  notify(method: string, params: Record<string, unknown>): void {
    const notif: JsonRpcNotification = { jsonrpc: "2.0", method, params };
    this.proc.stdin?.write(JSON.stringify(notif) + "\n");
  }

  onUpdate(handler: (notification: JsonRpcNotification) => void): void {
    this.updateHandler = handler;
  }

  markIdle(_stopReason: string): void {
    this.idleResolve?.();
  }

  waitForIdle(): Promise<void> {
    return new Promise((resolve) => {
      this.idleResolve = resolve;
    });
  }
}

function buildAcpPrompt(request: AgentRunRequest): string {
  const parts: string[] = [];

  if (request.instructions) {
    parts.push(request.instructions);
  }

  if (request.tools.length > 0) {
    const toolText = request.tools
      .map((t) => `- ${t.name}: ${t.description}`)
      .join("\n");
    parts.push(`You have access to the following Rakazo connector tools via MCP. Use the exact name when calling them:\n${toolText}`);
  }

  if (request.history.length > 0) {
    const historyText = request.history
      .map((msg) => `[${msg.role}]: ${msg.content}`)
      .join("\n\n");
    parts.push(`Previous context:\n${historyText}`);
  }

  parts.push(request.prompt);

  return parts.join("\n\n");
}

function ensureMcpConfig(sessionFilePath: string): void {
  try {
    const configDir = dirname(DEVIN_MCP_CONFIG);
    if (!existsSync(configDir)) mkdirSync(configDir, { recursive: true });

    let config: { mcpServers?: Record<string, unknown> } = {};
    if (existsSync(DEVIN_MCP_CONFIG)) {
      try {
        config = JSON.parse(readFileSync(DEVIN_MCP_CONFIG, "utf-8"));
      } catch {
        config = {};
      }
    }

    if (!config.mcpServers) config.mcpServers = {};

    // Always update (session file path changes per run)
    // NOTE: Devin's mcp_config.json env format is a plain object,
    // not the ACP protocol's array of {name, value} objects.
    config.mcpServers[RAKAZO_MCP_SERVER_NAME] = {
      command: process.execPath,
      args: [WRAPPER_SCRIPT],
      env: {
        RAKAZO_MCP_SESSION_FILE: sessionFilePath,
      },
    };
    writeFileSync(DEVIN_MCP_CONFIG, JSON.stringify(config, null, 2));
  } catch (err) {
    process.stderr.write(`[devin-acp] Failed to update MCP config: ${err}\n`);
  }
}

function startToolExecutor(request: AgentRunRequest): Promise<{ port: number; close: () => void }> {
  const server: HttpServer = createServer((req, res) => {
    if (req.method !== "POST" || req.url !== "/execute") {
      res.writeHead(404);
      res.end();
      return;
    }
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", async () => {
      try {
        const { name, args } = JSON.parse(body) as { name: string; args: Record<string, unknown> };
        if (!request.executeTool) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "No tool executor available" }));
          return;
        }
        const executionId = `acp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const result = await request.executeTool(name, args, executionId);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result));
      } catch (err) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
      }
    });
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = addr && typeof addr === "object" ? addr.port : 0;
      resolve({ port, close: () => server.close() });
    });
  });
}

type QueueItem = AgentRuntimeEvent | { type: "__close__" };

function createQueue() {
  const items: QueueItem[] = [];
  let done = false;
  let waiters: Array<() => void> = [];

  return {
    push(item: QueueItem) {
      items.push(item);
      for (const w of waiters) w();
      waiters = [];
    },
    close() {
      done = true;
      items.push({ type: "__close__" });
      for (const w of waiters) w();
      waiters = [];
    },
    *iterate(): Generator<AgentRuntimeEvent> {
      while (true) {
        while (items.length > 0) {
          const item = items.shift()!;
          if (item.type === "__close__") return;
          yield item;
        }
        if (done) return;
        yield new Promise<void>((resolve) => {
          waiters.push(resolve);
        }) as unknown as AgentRuntimeEvent;
      }
    },
  };
}
