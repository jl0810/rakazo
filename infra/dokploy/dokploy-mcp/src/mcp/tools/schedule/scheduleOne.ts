
import { z } from "zod";
import apiClient from "../../../utils/apiClient.js";
import { createTool } from "../toolFactory.js";

// Define the shape for the tool schema
const scheduleOneSchema = z.object({
    scheduleId: z.string().describe("The ID of the schedule to retrieve"),
});

export const scheduleOne = createTool({
    name: "schedule-one",
    description: "Get a specific scheduled job by ID in Dokploy.",
    schema: scheduleOneSchema,
    handler: async (args) => {
        const { scheduleId } = args;
        // TRPC Query format: /trpc/schedule.one?batch=1&input={"0":{"json":{"scheduleId":"..."}}}
        const input = {
            "0": {
                json: {
                    scheduleId,
                },
            },
        };
        const encodedInput = encodeURIComponent(JSON.stringify(input));
        const response = await apiClient.get(
            `/trpc/schedule.one?batch=1&input=${encodedInput}`
        );
        return response.data;
    },
    annotations: {
        title: "Get Schedule Details",
    },
});
