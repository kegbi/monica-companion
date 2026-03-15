import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { webhookSecret } from "../middleware/webhook-secret";

function createTestApp(secret: string) {
	const app = new Hono();
	app.use("/webhook/*", webhookSecret(secret));
	app.post("/webhook/telegram", (c) => c.json({ ok: true }));
	return app;
}

describe("webhookSecret middleware", () => {
	const secret = "test-secret-token-abc123";
	const app = createTestApp(secret);

	it("returns 401 when header is missing", async () => {
		const res = await app.request("/webhook/telegram", { method: "POST" });
		expect(res.status).toBe(401);
		const body = await res.json();
		expect(body).toEqual({ error: "Unauthorized" });
	});

	it("returns 401 when header value is wrong", async () => {
		const res = await app.request("/webhook/telegram", {
			method: "POST",
			headers: { "x-telegram-bot-api-secret-token": "wrong-secret" },
		});
		expect(res.status).toBe(401);
		const body = await res.json();
		expect(body).toEqual({ error: "Unauthorized" });
	});

	it("returns 401 when header value is empty string", async () => {
		const res = await app.request("/webhook/telegram", {
			method: "POST",
			headers: { "x-telegram-bot-api-secret-token": "" },
		});
		expect(res.status).toBe(401);
		const body = await res.json();
		expect(body).toEqual({ error: "Unauthorized" });
	});

	it("passes through when header matches", async () => {
		const res = await app.request("/webhook/telegram", {
			method: "POST",
			headers: { "x-telegram-bot-api-secret-token": secret },
		});
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body).toEqual({ ok: true });
	});

	it("rejects header with different length (timing-safe)", async () => {
		const res = await app.request("/webhook/telegram", {
			method: "POST",
			headers: { "x-telegram-bot-api-secret-token": "short" },
		});
		expect(res.status).toBe(401);
	});
});
