import type { ConnectorTool } from "@rakazo/adapter-kit";

export const DELEGATION_TOOL_NAMES = new Set(["run_subagent", "spawn_bot", "delete_bot"]);

export const builtinAgentTools: ConnectorTool[] = [
  {
    name: "write_file",
    description:
      "Write a UTF-8 file into this bot's private home filesystem. The file shows up in Files.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        content: { type: "string" },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "shell",
    description:
      "Run a command inside this bot's computer (the sandbox). cwd defaults to the bot home.",
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string" },
        cwd: { type: "string" },
      },
      required: ["command"],
    },
  },
  {
    name: "request_takeover",
    description:
      "Ask the user to take over the computer screen for login or human judgment. Protected input stays off the thread.",
    inputSchema: {
      type: "object",
      properties: { reason: { type: "string" } },
      required: ["reason"],
    },
  },
  {
    name: "remember",
    description: "Store a durable fact in this bot's explicit memory.",
    inputSchema: {
      type: "object",
      properties: {
        content: { type: "string" },
        path: { type: "string" },
      },
      required: ["content"],
    },
  },
  {
    name: "create_routine",
    description:
      "Create a recurring scheduled job for this bot. When the cron schedule fires, the prompt is sent to this bot as a new task in its own thread. Use this when the user asks for recurring or scheduled work (e.g. 'every morning', 'nightly', 'every Monday'). Confirm the schedule with the user if it is ambiguous.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Short label shown in the routines list." },
        prompt: {
          type: "string",
          description: "The instruction this bot will execute each time the schedule fires.",
        },
        cron: {
          type: "string",
          description:
            "Standard 5-field cron expression, e.g. '0 9 * * *' for daily at 9:00 UTC or '0 7 * * 1' for Mondays at 7:00 UTC.",
        },
        timezone: { type: "string", description: "IANA timezone, defaults to UTC." },
      },
      required: ["name", "prompt", "cron"],
    },
  },
  {
    name: "list_routines",
    description: "List this bot's recurring scheduled jobs (routines).",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "delete_routine",
    description:
      "Delete one of this bot's routines by exact name. Only delete when the user asked.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Exact name of the routine to delete." },
      },
      required: ["name"],
    },
  },
  {
    name: "run_subagent",
    description:
      "Run a short-lived helper inside this turn only. It is not a bot: no list entry, no thread, no computer of its own, and it disappears when this turn ends. Never call this because the user asked to create a bot — that is spawn_bot, and spawn_bot alone.",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Short label shown in the thread, e.g. scout or reviewer.",
        },
        task: { type: "string", description: "The work the helper should complete." },
        instructions: {
          type: "string",
          description: "Optional extra system instructions for the helper.",
        },
      },
      required: ["name", "task"],
    },
  },
  {
    name: "spawn_bot",
    description:
      "Create a full, regular bot — the same kind the user creates from the + button. It gets its own thread, computer, and memory, and appears as a peer in the bot list. Do not also call run_subagent. Creating the bot is the whole action. Only set prompt if the user asked that new bot to start work immediately.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        title: { type: "string" },
        instructions: { type: "string" },
        prompt: {
          type: "string",
          description: "Optional first task to run in the new bot's thread.",
        },
      },
      required: ["name"],
    },
  },
  {
    name: "delete_bot",
    description:
      "Permanently delete a bot this bot created, including its thread, computer, memory, and files. Only do this when the user asked or that bot is finished and unused. confirm_name must exactly match its name. This cannot delete you, bots the user created, or bots another bot created.",
    inputSchema: {
      type: "object",
      properties: {
        confirm_name: { type: "string", description: "Exact current name of the bot to delete." },
        bot_id: {
          type: "string",
          description:
            "Optional bot id. If omitted, the unique bot this bot created with confirm_name is deleted.",
        },
      },
      required: ["confirm_name"],
    },
  },
];
