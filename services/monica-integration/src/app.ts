import { correlationId } from "@monica-companion/auth";
import { otelMiddleware } from "@monica-companion/observability";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import type { Config } from "./config.js";
import { readRoutes } from "./routes/read.js";
import { referenceRoutes } from "./routes/reference.js";
import { writeRoutes } from "./routes/write.js";

export function createApp(config: Config) {
	const app = new Hono();

	app.use(otelMiddleware());

	// Health endpoint remains unauthenticated
	app.get("/health", correlationId(), (c) =>
		c.json({ status: "ok", service: "monica-integration" }),
	);

	// Internal API with body size limit (LOW finding #4)
	const internal = new Hono();
	internal.use(bodyLimit({ maxSize: 256 * 1024 }));

	// Global error handler for HTTPException (e.g., requireUserId)
	internal.onError((err, c) => {
		if (err instanceof HTTPException) {
			return c.json({ error: err.message }, err.status as 400);
		}
		throw err;
	});

	// Mount routes grouped by access pattern
	internal.route("/", readRoutes(config));
	internal.route("/", writeRoutes(config));
	internal.route("/", referenceRoutes(config));

	app.route("/internal", internal);

	return app;
}
