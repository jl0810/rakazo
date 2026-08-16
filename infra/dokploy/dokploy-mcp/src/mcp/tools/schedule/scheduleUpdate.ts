import { z } from "zod";
import apiClient from "../../../utils/apiClient.js";
import { createTool } from "../toolFactory.js";
import { ResponseFormatter } from "../../../utils/responseFormatter.js";

export const scheduleUpdate = createTool({
    name: "schedule-update",
    description: "Updates an existing scheduled job in Dokploy.",
    schema: z.object({
        scheduleId: z.string().describe("The ID of the schedule to update"),
        name: z.string().optional(),
        description: z.string().optional(),
        cronExpression: z.string().optional(),
        command: z.string().optional(),
        enabled: z.boolean().optional(),
    }),
    handler: async (args) => {
        const response = await apiClient.post("/trpc/schedule.update?batch=1", {
            "0": { json: args }
        });

        const result = response.data[0]?.result?.data?.json;
        return ResponseFormatter.success("Schedule updated", result);
    },
});
