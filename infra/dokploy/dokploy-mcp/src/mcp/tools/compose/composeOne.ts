import { z } from "zod";
import apiClient from "../../../utils/apiClient.js";
import { ResponseFormatter } from "../../../utils/responseFormatter.js";
import { createTool } from "../toolFactory.js";

export const composeOne = createTool({
  name: "compose-one",
  description: "Gets detailed information about a Docker Compose service by its ID in Dokploy.",
  schema: z.object({
    composeId: z.string().min(1).describe("The ID of the compose service to retrieve."),
  }),
  annotations: {
    title: "Get Compose Service Details",
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: true,
  },
  handler: async (input) => {
    // Following the pattern from postgres.one
    const response = await apiClient.get(`/compose.one?composeId=${input.composeId}`);

    if (!response?.data) {
      return ResponseFormatter.error(
        "Failed to fetch Compose service",
        `Compose service with ID "${input.composeId}" not found`
      );
    }

    return ResponseFormatter.success(
      `Successfully fetched Compose service "${input.composeId}"`,
      response.data
    );
  },
});
