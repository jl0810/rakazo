import { z } from "zod";
import apiClient from "../../../utils/apiClient.js";
import { createTool } from "../toolFactory.js";
import { ResponseFormatter } from "../../../utils/responseFormatter.js";

export const scheduleList = createTool({
    name: "schedule-list",
    description: "Retrieves a list of schedules based on type and/or ID.",
    schema: z.object({
        scheduleType: z.enum(["application", "compose", "server", "dokploy-server"]).optional().describe("The type of schedule to retrieve."),
        id: z.string().optional().describe("The specific ID of the entity (server, app, etc.) to list schedules for."),
    }),
    handler: async ({ scheduleType, id }) => {
        // TRPC Query format: /trpc/schedule.list?batch=1&input={"0":{"json":{"scheduleType":"...","id":"..."}}}
        const input = {
            scheduleType: scheduleType || 'server', // Default to server? Or maybe we should require it.
            id: id || '0' // We might need a real ID. If undefined, the API might fail.
        };

        const encodedInput = encodeURIComponent(JSON.stringify({ "0": { json: input } }));
        const response = await apiClient.get(`/trpc/schedule.list?batch=1&input=${encodedInput}`);

        // TRPC response format: [{"result":{"data":{"json": [...] }}}]
        const result = response.data[0]?.result?.data?.json;

        return ResponseFormatter.success("Schedules listed", result || []);
    },
});
