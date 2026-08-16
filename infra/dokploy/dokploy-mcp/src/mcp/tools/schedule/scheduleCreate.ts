import { z } from "zod";
import apiClient from "../../../utils/apiClient.js";
import { createTool } from "../toolFactory.js";
import { ResponseFormatter } from "../../../utils/responseFormatter.js";

export const scheduleCreate = createTool({
    name: "schedule-create",
    description: "Creates a new scheduled job in Dokploy.",
    schema: z.object({
        name: z.string().describe("Name of the schedule"),
        description: z.string().optional().describe("Optional description"),
        cronExpression: z.string().describe("Cron expression (e.g., '0 6 * * *')"),
        command: z.string().describe("Command to execute"),
        scheduleType: z.enum(["application", "compose", "server", "dokploy-server"]).default("server").describe("Type of schedule"),
        applicationId: z.string().optional().describe("Associated App ID"),
        serverId: z.string().optional().describe("Associated Server ID"),
        composeId: z.string().optional().describe("Associated Compose ID"),
        userId: z.string().optional().describe("Associated User ID"),
    }),
    handler: async (args) => {
        // TRPC Mutation: POST /trpc/schedule.create
        const response = await apiClient.post("/trpc/schedule.create?batch=1", {
            "0": { json: args }
        });

        const result = response.data[0]?.result?.data?.json;
        return ResponseFormatter.success("Schedule created", result);
    },
});
