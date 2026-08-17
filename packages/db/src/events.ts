import type { ProductEvent } from "@rakazo/contracts";
import type { Notification, Pool, PoolClient } from "pg";
import type { Prisma, PrismaClient } from "./client.js";
import { PrismaClientKnownRequestError } from "./client.js";

// P2002 is Prisma's unique-constraint violation. The (threadId, seq) pair can
// collide when two concurrent appends to the same thread both read the same
// max(seq) under READ COMMITTED. We retry the read+write instead of failing,
// since the next attempt will observe the now-committed higher seq.
const SEQ_RACE_MAX_ATTEMPTS = 8;
const SEQ_RACE_BASE_DELAY_MS = 5;

function isSeqUniqueViolation(error: unknown): boolean {
  return (
    error instanceof PrismaClientKnownRequestError &&
    error.code === "P2002" &&
    Array.isArray(error.meta?.target) &&
    (error.meta?.target as string[]).includes("seq")
  );
}

export async function appendEvent(
  prisma: PrismaClient,
  input: {
    workspaceId: string;
    threadId: string;
    botId: string;
    type: ProductEvent["type"];
    payload: Record<string, unknown>;
    runId?: string;
  },
): Promise<ProductEvent> {
  let event;
  for (let attempt = 1; ; attempt++) {
    try {
      event = await prisma.$transaction(async (tx) => {
        const last = await tx.event.findFirst({
          where: { threadId: input.threadId },
          orderBy: { seq: "desc" },
          select: { seq: true },
        });
        const seq = (last?.seq ?? -1) + 1;
        return tx.event.create({
          data: {
            workspaceId: input.workspaceId,
            threadId: input.threadId,
            botId: input.botId,
            seq,
            type: input.type,
            payload: input.payload as Prisma.InputJsonValue,
            runId: input.runId,
          },
        });
      });
      break;
    } catch (error) {
      if (isSeqUniqueViolation(error) && attempt < SEQ_RACE_MAX_ATTEMPTS) {
        const delay = SEQ_RACE_BASE_DELAY_MS * 2 ** (attempt - 1);
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }
      throw error;
    }
  }
  await prisma.$executeRaw`SELECT pg_notify('rakazo_events', ${JSON.stringify({
    workspaceId: event.workspaceId,
    threadId: event.threadId,
    botId: event.botId,
    seq: event.seq,
  })})`;
  return {
    id: event.id,
    workspaceId: event.workspaceId,
    threadId: event.threadId,
    botId: event.botId,
    seq: event.seq,
    type: event.type as ProductEvent["type"],
    runId: event.runId ?? undefined,
    createdAt: event.createdAt.toISOString(),
    payload: event.payload as Record<string, unknown>,
  };
}

export async function eventsAfter(prisma: PrismaClient, threadId: string, cursor: number) {
  return prisma.event.findMany({
    where: { threadId, seq: { gt: cursor } },
    orderBy: { seq: "asc" },
  });
}

export async function* followThreadEvents(
  prisma: PrismaClient,
  threadId: string,
  cursor: number,
  pool?: Pool,
  signal?: AbortSignal,
): AsyncGenerator<Awaited<ReturnType<typeof eventsAfter>>[number]> {
  let seq = cursor;
  const client = pool ? await pool.connect() : undefined;
  try {
    if (client) await client.query("LISTEN rakazo_events");
    while (!signal?.aborted) {
      const events = await eventsAfter(prisma, threadId, seq);
      for (const event of events) {
        seq = event.seq;
        yield event;
      }
      if (signal?.aborted) break;
      if (client) await waitForThreadNotify(client, threadId, 15_000, signal);
      else await sleep(400, signal);
    }
  } finally {
    if (client) {
      await client.query("UNLISTEN rakazo_events").catch(() => undefined);
      client.release();
    }
  }
}

function waitForThreadNotify(
  client: PoolClient,
  threadId: string,
  ms: number,
  signal?: AbortSignal,
) {
  return new Promise<void>((resolve) => {
    const onNotify = (msg: Notification) => {
      if (msg.channel !== "rakazo_events") return;
      try {
        const data = JSON.parse(msg.payload ?? "{}") as { threadId?: string };
        if (data.threadId === threadId) {
          cleanup();
          resolve();
        }
      } catch {
        // ignore malformed payloads
      }
    };
    const onAbort = () => {
      cleanup();
      resolve();
    };
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const cleanup = () => {
      clearTimeout(timer);
      client.off("notification", onNotify);
      signal?.removeEventListener("abort", onAbort);
    };
    client.on("notification", onNotify);
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();
  });
}

function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();
  });
}
