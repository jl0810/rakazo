import { existsSync } from "node:fs";
import path from "node:path";
import { config } from "dotenv";

function loadRootEnv() {
  let dir = process.cwd();
  for (let i = 0; i < 8; i += 1) {
    const candidate = path.join(dir, ".env");
    if (existsSync(candidate)) {
      config({ path: candidate, override: false });
      if (process.env.DATA_DIR && !path.isAbsolute(process.env.DATA_DIR)) {
        process.env.DATA_DIR = path.resolve(dir, process.env.DATA_DIR);
      }
      return;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  config();
}
loadRootEnv();

import {
  createConnectorStack,
  createRunExecutor,
  createRunSandbox,
  EncryptedSecretStore,
  ExpoPushProvider,
  GraphileWakeupDriver,
  InMemoryWakeupDriver,
  isComposioEnabled,
  LocalAgentHomeStore,
  DevinAgentRuntime,
  DevinAcpRuntime,
  DevinCliRuntime,
  PiAgentRuntime,
  ScriptedAgentRuntime,
  sleepComputerIfIdle,
} from "@rakazo/adapters";
import { resolveEncryptionKey } from "@rakazo/core";
import { createDb } from "@rakazo/db";
import { MarkdownMemoryStore } from "@rakazo/memory";

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  const { prisma } = createDb(databaseUrl);
  const runtime =
    process.env.AGENT_RUNTIME === "scripted"
      ? new ScriptedAgentRuntime()
      : process.env.AGENT_RUNTIME === "devin"
        ? new DevinAgentRuntime({ apiKey: process.env.DEVIN_API_KEY!, orgId: process.env.DEVIN_ORG_ID! })
        : process.env.AGENT_RUNTIME === "devin-cli"
          ? new DevinAcpRuntime()
          : new PiAgentRuntime();
  const dataDir = process.env.DATA_DIR ?? "./data";
  const sandbox = createRunSandbox(process.env.SANDBOX_PROVIDER ?? "docker", {
    supervisorUrl: process.env.SANDBOX_SUPERVISOR_URL ?? "http://127.0.0.1:7091",
    e2bApiKey: process.env.E2B_API_KEY,
    dataDir,
    prisma,
  });
  const stack = createConnectorStack(isComposioEnabled(process.env.COMPOSIO_API_KEY));
  const connector = stack.destination;
  await connector.start();
  const secrets = new EncryptedSecretStore(resolveEncryptionKey(process.env));
  const wakeup =
    process.env.WAKEUP_DRIVER === "memory"
      ? new InMemoryWakeupDriver()
      : new GraphileWakeupDriver(databaseUrl);
  const executor = createRunExecutor({
    prisma,
    runtime,
    sandbox,
    memory: new MarkdownMemoryStore(prisma),
    home: new LocalAgentHomeStore(dataDir),
    connector: stack.connector,
    secrets: [process.env.OPENROUTER_API_KEY ?? "", process.env.COMPOSIO_API_KEY ?? ""].filter(
      Boolean,
    ),
    secretStore: secrets,
    deploymentModelKey: process.env.OPENROUTER_API_KEY,
    dataDir,
    notifications: new ExpoPushProvider(dataDir),
    wakeup,
  });

  await wakeup.start({
    "run.continue": async (payload) => {
      await executor.continueRun(String(payload.runId), process.pid.toString());
    },
    "routine.wakeup": async (payload) => {
      await executor.wakeRoutine(String(payload.routineId), process.pid.toString());
    },
    "computer.sleep": async (payload) => {
      await sleepComputerIfIdle({ prisma, sandbox, wakeup }, String(payload.botId));
    },
  });

  console.log("rakazo worker ready");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
