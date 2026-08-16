import { z } from "zod";
import apiClient from "../../../utils/apiClient.js";
import { ResponseFormatter } from "../../../utils/responseFormatter.js";
import { createTool } from "../toolFactory.js";

export const composeCreate = createTool({
  name: "compose-create",
  description: "Creates a new Docker Compose service in Dokploy.",
  schema: z.object({
    name: z.string().min(1).describe("The name of the compose service."),
    description: z
      .string()
      .nullable()
      .optional()
      .describe("An optional description for the compose service."),
    environmentId: z
      .string()
      .describe("The ID of the environment where the compose service will be created."),
    serverId: z
      .string()
      .nullable()
      .optional()
      .describe("The ID of the server where the compose service will be deployed."),
  }),
  annotations: {
    title: "Create Compose Service",
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
  handler: async (input) => {
    const response = await apiClient.post("/compose.create", input);

    return ResponseFormatter.success(
      `Compose service "${input.name}" created successfully`,
      response.data
    );
  },
});
