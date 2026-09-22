import { type ChildProcess, spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server as HttpServer } from "node:http";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
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

const RAKAZO_MCP_SERVER_NAME = "rakazo-connectors";
const DEVIN_CHILD_ENV_ALLOWLIST = [
  "LANG",
  "LC_ALL",
  "SSL_CERT_DIR",
  "SSL_CERT_FILE",
  "TERM",
  "TZ",
] as const;

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

  async *run(request: AgentRunRequest, context: AdapterContext): AsyncIterable<AgentRuntimeEvent> {
    const controller = new AbortController();
    running.set(request.runId, controller);
    const signal = context.signal ?? controller.signal;
    const model =
      request.model.provider === "devin-cli" && request.model.id !== "scripted"
        ? request.model.id
        : this.model;

    const queue = createQueue();

    const work = (async () => {
      let proc: ChildProcess | null = null;
      let toolExecutor: { port: number; close: () => void } | null = null;
      const runtimeDir = devinRuntimeDirectory(request.runId);
      const workspaceDir = join(runtimeDir, "workspace");
      const sessionFilePath = join(runtimeDir, "mcp-session.json");
      const mcpConfigPath = join(runtimeDir, "config", "devin", "mcp_config.json");

      try {
        for (const directory of [
          workspaceDir,
          join(runtimeDir, "home"),
          join(runtimeDir, "tmp"),
          join(runtimeDir, "cache"),
          join(runtimeDir, "state"),
        ]) {
          mkdirSync(directory, { recursive: true });
        }

        // 1. Start temporary HTTP server for tool execution (before spawning CLI)
        toolExecutor = await startToolExecutor(request);

        // 2. Write a per-run MCP config containing only Rakazo's brokered tools.
        // Never merge the host's global Devin configuration: it may contain
        // infrastructure-admin MCP servers that user bots must not inherit.
        if (request.tools.length > 0) {
          writeFileSync(
            sessionFilePath,
            JSON.stringify({
              tools: request.tools.map((t) => ({
                name: t.name,
                description: t.description,
                inputSchema: t.inputSchema,
              })),
              executorUrl: `http://127.0.0.1:${toolExecutor.port}/execute`,
            }),
          );
          writeRakazoMcpConfig(mcpConfigPath, sessionFilePath);
        }

        // 3. Spawn Devin with an allowlisted environment and isolated HOME/XDG
        // directories. Application, database, connector, and deployment secrets
        // are deliberately excluded from the provider child process.
        proc = spawn(this.cliPath, ["acp", "--model", model], {
          cwd: workspaceDir,
          env: buildDevinChildEnv(process.env, runtimeDir, model),
          stdio: ["pipe", "pipe", "pipe"],
        });

        // Drain stderr without persisting model prompts, credentials, or tool data.
        proc.stderr?.resume();

        const rpc = new AcpClient(
          proc,
          request.tools.map((tool) => tool.name),
        );

        // Register update handler immediately — messages arrive as soon as the process spawns
        rpc.onUpdate((update) => {
          const su = update.params.update as Record<string, unknown>;
          const kind = su.sessionUpdate as string;
          if (kind === "agent_message_chunk") {
            const content = su.content as { type: string; text: string };
            if (content?.text) queue.push({ type: "text", text: content.text });
          } else if (kind === "agent_message") {
            const content = su.content as Array<{ type: string; text: string }>;
            const text = content?.map((c) => c.text).join("") ?? "";
            if (text) queue.push({ type: "text", text });
          } else if (kind === "agent_thought" || kind === "agent_thought_chunk") {
            const content = su.content as
              | { type: string; text: string }
              | Array<{ type: string; text: string }>;
            const text = Array.isArray(content)
              ? content.map((c) => c.text).join("")
              : (content?.text ?? "");
            if (text) queue.push({ type: "progress", text });
          } else if (kind === "tool_call_update") {
            const status = su.status as string;
            const title = su.title as string;
            const toolCallId = su.toolCallId as string;
            if (status === "in_progress" && title) {
              queue.push({ type: "progress", text: `${title}…` });
            }
            if (status === "completed") {
              const content = su.content as Array<{
                type: string;
                content: { type: string; text: string };
              }>;
              const resultText = content?.map((c) => c.content?.text).join("") ?? "";
              queue.push({
                type: "tool",
                name: title || "devin_tool",
                args: { toolCallId, result: resultText },
                executionId: `${request.runId}:${toolCallId}`,
              });
            }
          } else if (kind === "usage_update") {
            const meta = su._meta as
              | { "cognition.ai/inputTokens"?: number; "cognition.ai/outputTokens"?: number }
              | undefined;
            queue.push({
              type: "usage",
              inputTokens: meta?.["cognition.ai/inputTokens"] ?? 0,
              outputTokens: meta?.["cognition.ai/outputTokens"] ?? 0,
              provider: "devin-cli",
              model,
            });
          }
        });

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

        // 5. The provider runtime gets an empty per-run workspace. Bot files are
        // available only through Rakazo's authorized file and sandbox tools.
        const sessionResult = (await rpc.request("session/new", {
          cwd: workspaceDir,
          mcpServers: [],
        })) as { sessionId?: string } | null;

        if (!sessionResult?.sessionId) {
          queue.push({ type: "text", text: "Failed to create Devin ACP session" });
          queue.push({ type: "done" });
          return;
        }

        rpc.sessionId = sessionResult.sessionId;

        // Keep Devin in its least-permissive unattended mode. Permission requests
        // are accepted only for the per-run Rakazo MCP bridge below.
        await rpc.request("session/set_config_option", {
          sessionId: rpc.sessionId,
          configId: "mode",
          value: "auto",
        });

        // 6. Build and send prompt (tools are now available via MCP — no need to list them in the prompt)
        const prompt = buildAcpPrompt(request);
        queue.push({ type: "progress", text: `Devin ACP (${model}) working…` });

        // 7. Send prompt and wait for completion
        await rpc.request("session/prompt", {
          sessionId: rpc.sessionId,
          prompt: [{ type: "text", text: prompt }],
        });

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
        rmSync(runtimeDir, { recursive: true, force: true });
        queue.close();
      }
    })();

    try {
      for await (const event of queue.iterate()) {
        if (!event || event.type === undefined) {
          console.error(`[devin-acp] yielding undefined event from queue, runId=${request.runId}`);
          continue;
        }
        yield event;
      }
      await work;
    } finally {
      running.delete(request.runId);
    }
  }
}

class AcpClient {
  private proc: ChildProcess;
  private nextId = 1;
  private pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();
  private updateHandler: ((notification: JsonRpcNotification) => void) | null = null;
  private idleResolve: (() => void) | null = null;
  private buffer = "";
  private allowedToolNames: Set<string>;

  sessionId: string | null = null;

  constructor(proc: ChildProcess, allowedToolNames: string[]) {
    this.proc = proc;
    this.allowedToolNames = new Set(allowedToolNames);
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
        const params = msg.params as {
          sessionId?: string;
          toolCall?: Record<string, unknown> & { toolCallId?: string };
          options?: Array<{ optionId: string }>;
        };
        this.respond(msg.id, {
          sessionId: params.sessionId,
          toolCallId: params.toolCall?.toolCallId,
          outcome: selectPermissionOutcome(
            params.toolCall,
            params.options ?? [],
            this.allowedToolNames,
          ),
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
    this.proc.stdin?.write(`${JSON.stringify(resp)}\n`);
  }

  request(method: string, params: Record<string, unknown>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const req: JsonRpcRequest = { jsonrpc: "2.0", id, method, params };
      this.pending.set(id, { resolve, reject });
      this.proc.stdin?.write(`${JSON.stringify(req)}\n`);

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
    this.proc.stdin?.write(`${JSON.stringify(notif)}\n`);
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

export function buildAcpPrompt(request: AgentRunRequest): string {
  const parts: string[] = [];

  if (request.instructions) {
    const fixed = request.instructions.replace(
      /Connected plugins: (.+)\. Use those plugin tools when the user asks about those apps\./,
      `Connected plugins: $1. These are available via the "${RAKAZO_MCP_SERVER_NAME}" MCP server.`,
    );
    parts.push(fixed);
  }

  const toolNames = request.tools.map((tool) => tool.name);
  const visibleToolNames = toolNames.slice(0, 80);
  const omittedToolCount = toolNames.length - visibleToolNames.length;
  const toolCatalog = `${visibleToolNames.join(", ")}${
    omittedToolCount > 0 ? `, and ${omittedToolCount} more` : ""
  }`;
  parts.push(
    [
      `Rakazo capability transport for this Devin session is the "${RAKAZO_MCP_SERVER_NAME}" MCP server.`,
      `Available Rakazo tools (${toolNames.length}): ${toolCatalog || "none"}.`,
      "These are Rakazo tools, not Devin skills. Never treat Devin's installed skill list as Rakazo's capability list.",
      "Do not inspect Devin skill directories, global MCP configuration, or /app to determine Rakazo capabilities. Call list_capabilities through Rakazo instead.",
      `Before saying a requested capability is unavailable, call mcp_list_tools for server "${RAKAZO_MCP_SERVER_NAME}". Invoke a Rakazo tool with mcp_call_tool using that server and the exact tool name.`,
    ].join("\n"),
  );

  if (request.history.length > 0) {
    const historyText = request.history
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((msg) => (msg.role === "assistant" ? `Assistant: ${msg.content}` : msg.content))
      .join("\n\n");
    if (historyText) parts.push(historyText);
  }

  parts.push(request.prompt);

  return parts.join("\n\n");
}

export function devinRuntimeDirectory(runId: string, root = "/tmp"): string {
  const safeRunId = runId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 120) || "run";
  return join(root, `rakazo-devin-${safeRunId}`);
}

export function buildDevinChildEnv(
  source: NodeJS.ProcessEnv,
  runtimeDir: string,
  model: string,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const name of DEVIN_CHILD_ENV_ALLOWLIST) {
    if (source[name]) env[name] = source[name];
  }
  return {
    ...env,
    PATH: "/usr/local/bin:/usr/bin:/bin",
    HOME: join(runtimeDir, "home"),
    TMPDIR: join(runtimeDir, "tmp"),
    XDG_CACHE_HOME: join(runtimeDir, "cache"),
    XDG_CONFIG_HOME: join(runtimeDir, "config"),
    XDG_STATE_HOME: join(runtimeDir, "state"),
    // Devin authentication is isolated from application credentials and is the
    // only persistent provider state inherited by the child process.
    XDG_DATA_HOME: source.DEVIN_XDG_DATA_HOME ?? join(homedir(), ".local", "share"),
    DEVIN_MODEL: model,
    DEVIN_PERMISSION_MODE: "auto",
  };
}

export function writeRakazoMcpConfig(configPath: string, sessionFilePath: string): void {
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(
    configPath,
    JSON.stringify(
      {
        mcpServers: {
          [RAKAZO_MCP_SERVER_NAME]: {
            command: process.execPath,
            args: [WRAPPER_SCRIPT],
            env: { RAKAZO_MCP_SESSION_FILE: sessionFilePath },
          },
        },
      },
      null,
      2,
    ),
  );
}

export function selectPermissionOutcome(
  toolCall: Record<string, unknown> | undefined,
  options: Array<{ optionId: string }>,
  allowedToolNames: ReadonlySet<string>,
): { outcome: "selected"; optionId: string } | { outcome: "cancelled" } {
  const title = typeof toolCall?.title === "string" ? toolCall.title : "";
  const rawInput =
    toolCall?.rawInput && typeof toolCall.rawInput === "object"
      ? JSON.stringify(toolCall.rawInput)
      : "";
  const isRakazoCall =
    title.includes(RAKAZO_MCP_SERVER_NAME) ||
    rawInput.includes(RAKAZO_MCP_SERVER_NAME) ||
    [...allowedToolNames].some((name) => title === name || title.endsWith(` ${name}`));

  if (isRakazoCall) {
    const allow =
      options.find((option) => option.optionId === "allow_server_session") ??
      options.find((option) => option.optionId === "allow_once");
    return allow ? { outcome: "selected", optionId: allow.optionId } : { outcome: "cancelled" };
  }

  const reject = options.find(
    (option) => option.optionId.includes("reject") || option.optionId.includes("deny"),
  );
  return reject ? { outcome: "selected", optionId: reject.optionId } : { outcome: "cancelled" };
}

function startToolExecutor(request: AgentRunRequest): Promise<{ port: number; close: () => void }> {
  const server: HttpServer = createServer((req, res) => {
    if (req.method !== "POST" || req.url !== "/execute") {
      res.writeHead(404);
      res.end();
      return;
    }
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
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

type QueueItem = AgentRuntimeEvent;

function createQueue() {
  const items: QueueItem[] = [];
  let wake: (() => void) | undefined;
  let closed = false;

  return {
    push(item: QueueItem) {
      items.push(item);
      wake?.();
    },
    close() {
      closed = true;
      wake?.();
    },
    async *iterate(): AsyncGenerator<AgentRuntimeEvent> {
      while (!closed || items.length) {
        if (items.length) {
          const item = items.shift()!;
          yield item;
          continue;
        }
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
      }
    },
  };
}
