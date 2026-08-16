import { loadRootEnv } from "./load-root-env.js";

loadRootEnv();

import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { loadEnv } from "./env.js";

const env = loadEnv();
const { app } = await createApp(env);
serve({ fetch: app.fetch, hostname: "0.0.0.0", port: env.port }, () => {
  console.log(`rakazo api on http://0.0.0.0:${env.port}`);
});
