import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { loadConfig } from "./config";
import { createDb } from "./db/connection";

const config = loadConfig();
const db = createDb(config.databaseUrl);
const app = createApp(config, db);

serve({ fetch: app.fetch, port: config.port }, (info) => {
	console.log(`user-management listening on :${info.port}`);
});
