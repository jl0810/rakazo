import { z } from "zod";
import apiClient from "../../../utils/apiClient.js";
import { createTool } from "../toolFactory.js";
import { ResponseFormatter } from "../../../utils/responseFormatter.js";

export const scheduleDelete = createTool({
    name: "schedule-delete",
    description: "Deletes a scheduled job from Dokploy.",
    schema: z.object({
        scheduleId: z.string().describe("The ID of the schedule to delete"),
    }),
    handler: async ({ scheduleId }) => {
        // We don't check for errors here, relying on apiClient creating an error if needed.
        // However, for delete we might want to check the response.
        await apiClient.post("/trpc/schedule.delete?batch=1", {
            "0": { json: { scheduleId } }
        });

        // TRPC delete usually returns the deleted object or success status.
        // If it throws, apiClient should catch it.

        return ResponseFormatter.success("Schedule deleted", { scheduleId });
    },
});
