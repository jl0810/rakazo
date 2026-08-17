import { loadRootEnv } from "@rakazo/core/node/load-root-env";

loadRootEnv();

import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { loadEnv } from "./env.js";

const env = loadEnv();
const { app, stop } = await createApp(env);
const server = serve({ fetch: app.fetch, hostname: "0.0.0.0", port: env.port }, () => {
  console.log(`rakazo api on http://0.0.0.0:${env.port}`);
});

let stopping = false;
const shutdown = async () => {
  if (stopping) return;
  stopping = true;
  server.close();
  await stop();
};
process.once("SIGTERM", () => void shutdown());
process.once("SIGINT", () => void shutdown());
