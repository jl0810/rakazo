import { z } from "zod";
import { execSync } from "child_process";
import { ResponseFormatter } from "../../../utils/responseFormatter.js";
import { createTool } from "../toolFactory.js";

/**
 * Reads LIVE runtime logs from the Docker container via SSH.
 *
 * The Dokploy `application.readLogs` tRPC endpoint reads a static file
 * written during the deploy process — it stops capturing after startup.
 * To get real request/error logs we SSH to the server and run `docker logs`
 * directly against the running container.
 *
 * SSH host is read from DOKPLOY_SSH_HOST env var (default: root@88.198.211.26).
 */
export const applicationReadLogs = createTool({
  name: "application-readLogs",
  description:
    "Reads LIVE runtime logs directly from the running Docker container. Returns real application output including HTTP requests, console logs, errors, and auth events — not just startup lines.",
  schema: z.object({
    applicationId: z
      .string()
      .min(1)
      .describe(
        "The app name or service name used in Docker (e.g. 'routemyretirement', 'app_retire_web'). Used to filter the running container."
      ),
    tail: z
      .number()
      .optional()
      .default(200)
      .describe("Number of log lines to tail from the running container. Default 200."),
    since: z
      .string()
      .optional()
      .describe(
        "Show logs since a relative duration or timestamp (e.g. '5m', '1h', '2026-05-02T21:00:00'). Omit for no time filter."
      ),
  }),
  annotations: {
    title: "Read Live Runtime Logs",
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: true,
  },
  handler: async (input) => {
    const { applicationId, tail, since } = input;
    const sshHost = process.env.DOKPLOY_SSH_HOST ?? "root@88.198.211.26";

    const sinceFlag = since && since !== "all" ? `--since="${since}"` : "";

    // Find the container by partial name match then stream its logs
    const remoteCmd = [
      `CONTAINER=$(docker ps --filter "name=${applicationId}" -q | head -1)`,
      `if [ -z "$CONTAINER" ]; then echo "ERROR: No running container matching '${applicationId}'"; exit 1; fi`,
      `docker logs --tail ${tail} ${sinceFlag} "$CONTAINER" 2>&1`,
    ].join(" && ");

    const sshCommand = `ssh -o StrictHostKeyChecking=no -o ConnectTimeout=10 ${sshHost} '${remoteCmd}'`;

    let output: string;
    try {
      output = execSync(sshCommand, {
        encoding: "utf-8",
        timeout: 30_000,
        maxBuffer: 10 * 1024 * 1024,
      });
    } catch (err: unknown) {
      const execErr = err as { stdout?: string; stderr?: string; message?: string };
      const combined = ((execErr.stdout ?? "") + (execErr.stderr ?? "")).trim();
      if (combined) {
        return ResponseFormatter.success(
          `Logs for "${applicationId}" (exit with warnings)`,
          { logs: combined, warning: execErr.message }
        );
      }
      return ResponseFormatter.error(
        `Failed to fetch runtime logs for "${applicationId}"`,
        execErr.message ?? String(err)
      );
    }

    const lines = output.trim();
    return ResponseFormatter.success(
      `Live runtime logs for "${applicationId}" (last ${tail} lines)`,
      {
        logs: lines,
        linesReturned: lines ? lines.split("\n").length : 0,
      }
    );
  },
});
