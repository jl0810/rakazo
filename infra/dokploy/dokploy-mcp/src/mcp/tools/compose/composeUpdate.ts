import { z } from "zod";
import apiClient from "../../../utils/apiClient.js";
import { ResponseFormatter } from "../../../utils/responseFormatter.js";
import { createTool } from "../toolFactory.js";

export const composeUpdate = createTool({
  name: "compose-update",
  description: "Updates a Docker Compose service configuration in Dokploy.",
  schema: z.object({
    composeId: z.string().min(1).describe("The ID of the compose service to update."),
    name: z.string().optional().describe("New name for the compose service."),
    description: z.string().nullable().optional().describe("New description."),
    composeFile: z.string().optional().describe("The raw docker-compose.yml content."),
    env: z.string().optional().describe("Environment variables in KEY=VALUE format."),
    sourceType: z.enum(["github", "gitlab", "bitbucket", "gitea", "git", "raw"]).default("raw").optional().describe("Source of the configuration."),
  }),
  annotations: {
    title: "Update Compose Service",
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
  handler: async (input) => {
    const response = await apiClient.post("/compose.update", input);

    return ResponseFormatter.success(
      `Compose service "${input.composeId}" updated successfully`,
      response.data
    );
  },
});
