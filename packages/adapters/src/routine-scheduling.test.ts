import type { BackgroundJob, JobPublisher } from "@rakazo/adapter-kit";
import { describe, expect, it, vi } from "vitest";
import { createRunExecutor } from "./executor.js";

describe("routine scheduling", () => {
  it("never fires a future occurrence early", async () => {
    const scheduledAt = new Date(Date.now() + 60_000);
    const findBot = vi.fn();
    const enqueue = vi.fn(async (_job: BackgroundJob) => undefined);
    const jobs: JobPublisher = {
      describe: () => ({
        id: "test",
        contractVersion: "1",
        adapterVersion: "1",
        capabilities: { delay: true, replace: true, cancel: true },
      }),
      enqueue,
      cancel: async () => undefined,
      close: async () => undefined,
    };
    const executor = createRunExecutor({
      prisma: {
        routine: {
          findUnique: vi.fn(async () => ({
            id: "routine-1",
            active: true,
            nextRunAt: scheduledAt,
          })),
        },
        bot: { findUnique: findBot },
      },
      jobs,
    } as never);

    await executor.wakeRoutine("routine-1", scheduledAt.toISOString());

    expect(enqueue).toHaveBeenCalledWith({
      name: "routine.wakeup",
      payload: { routineId: "routine-1", scheduledFor: scheduledAt.toISOString() },
      availableAt: scheduledAt,
      replaceKey: "routine:routine-1",
    });
    expect(findBot).not.toHaveBeenCalled();
  });
});
