import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { otelMiddleware } from "../middleware";

describe("otelMiddleware", () => {
	it("creates a Hono middleware that does not error on a test app", async () => {
		const app = new Hono();
		app.use(otelMiddleware());
		app.get("/health", (c) => c.json({ status: "ok" }));

		const res = await app.request("/health");
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.status).toBe("ok");
	});

	it("does not break POST requests", async () => {
		const app = new Hono();
		app.use(otelMiddleware());
		app.post("/api/test", (c) => c.json({ received: true }));

		const res = await app.request("/api/test", { method: "POST" });
		expect(res.status).toBe(200);
	});

	it("preserves error responses", async () => {
		const app = new Hono();
		app.use(otelMiddleware());
		app.get("/fail", (c) => c.json({ error: "not found" }, 404));

		const res = await app.request("/fail");
		expect(res.status).toBe(404);
	});
});
