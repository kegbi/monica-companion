import { otelMiddleware } from "@monica-companion/observability";
import { Hono } from "hono";
import type { Config } from "./config.js";
import type { Database } from "./db/connection.js";

export function createApp(_config: Config, _db: Database) {
	const app = new Hono();

	app.use(otelMiddleware());

	app.get("/health", (c) => c.json({ status: "ok", service: "ai-router" }));

	return app;
}
