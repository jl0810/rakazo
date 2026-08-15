import { computerSleepJob, type JobPublisher, type SandboxProvider } from "@rakazo/adapter-kit";
import { ACTIVE_RUN_STATUSES } from "@rakazo/core";
import type { PrismaClient, ThreadEvents } from "@rakazo/db";

export const DEFAULT_SANDBOX_IDLE_MS = 10 * 60 * 1000;

export function sandboxIdleMs(): number {
  const raw = Number(process.env.SANDBOX_IDLE_MS ?? DEFAULT_SANDBOX_IDLE_MS);
  return Number.isFinite(raw) && raw >= 30_000 ? raw : DEFAULT_SANDBOX_IDLE_MS;
}

export function scheduleComputerSleep(jobs: JobPublisher | undefined, botId: string): void {
  if (!jobs || !botId) return;
  void jobs.enqueue(computerSleepJob(botId, new Date(Date.now() + sandboxIdleMs())));
}

export async function touchRunningComputer(
  deps: { sandbox: SandboxProvider; jobs?: JobPublisher },
  computer: { botId: string; providerRef: string; kind: string },
): Promise<void> {
  scheduleComputerSleep(deps.jobs, computer.botId);
  const sandbox = deps.sandbox as SandboxProvider & {
    keepAlive?: (ref: {
      id: string;
      botId: string;
      kind: "docker" | "e2b" | "desktop" | "fake";
      providerRef: string;
    }) => Promise<void>;
  };
  await sandbox.keepAlive?.({
    id: computer.providerRef,
    botId: computer.botId,
    kind: computer.kind as "docker" | "e2b" | "desktop" | "fake",
    providerRef: computer.providerRef,
  });
}

export async function sleepComputerIfIdle(
  deps: {
    prisma: PrismaClient;
    sandbox: SandboxProvider;
    jobs?: JobPublisher;
    events: ThreadEvents;
  },
  botId: string,
): Promise<void> {
  const computer = await deps.prisma.computer.findUnique({ where: { botId } });
  if (!computer?.providerRef) return;
  if (computer.state !== "running") return;
  const active = await deps.prisma.run.findFirst({
    where: { botId, status: { in: [...ACTIVE_RUN_STATUSES] } },
    select: { id: true },
  });
  if (active) {
    scheduleComputerSleep(deps.jobs, botId);
    return;
  }
  const ctx = {
    operationId: "computer.sleep",
    traceId: "computer.sleep",
    workspaceId: computer.workspaceId,
    userId: computer.userId,
    botId,
    signal: new AbortController().signal,
  };
  await deps.sandbox.stop(
    {
      id: computer.providerRef,
      botId,
      kind: computer.kind as "docker" | "e2b" | "desktop" | "fake",
      providerRef: computer.providerRef,
    },
    ctx,
  );
  await deps.prisma.computer.update({
    where: { botId },
    data: { state: "suspended", controlHolder: "none" },
  });
  if (computer.botId) {
    const bot = await deps.prisma.bot.findUnique({
      where: { id: botId },
      include: { thread: true },
    });
    if (bot?.thread) {
      await deps.events.append({
        workspaceId: computer.workspaceId,
        threadId: bot.thread.id,
        botId,
        type: "computer.status",
        payload: { status: "suspended" },
      });
    }
  }
}
