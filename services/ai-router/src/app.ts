import { otelMiddleware } from "@monica-companion/observability";
import { Hono } from "hono";

export function createApp() {
	const app = new Hono();

	app.use(otelMiddleware());

	app.get("/health", (c) => c.json({ status: "ok", service: "ai-router" }));

	return app;
}
