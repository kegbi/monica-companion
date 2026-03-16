import { otelMiddleware } from "@monica-companion/observability";
import { Hono } from "hono";
import type { Config } from "./config.js";
import { contactResolutionRoutes } from "./contact-resolution/routes.js";
import type { Database } from "./db/connection.js";

export function createApp(config: Config, _db: Database) {
	const app = new Hono();

	app.use(otelMiddleware());

	app.get("/health", (c) => c.json({ status: "ok", service: "ai-router" }));

	// Mount contact resolution routes under /internal
	app.route("/internal", contactResolutionRoutes(config));

	return app;
}
