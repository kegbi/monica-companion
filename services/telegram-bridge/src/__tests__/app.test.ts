import { describe, expect, it } from "vitest";
import { createApp } from "../app";
import type { Config } from "../config";

const testConfig: Config = {
	port: 3001,
	telegramWebhookSecret: "test-secret-xyz",
	rateLimitWindowMs: 60_000,
	rateLimitMaxRequests: 100,
};

describe("createApp integration", () => {
	it("GET /health returns 200 without auth", async () => {
		const app = createApp(testConfig);
		const res = await app.request("/health");
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body).toEqual({ status: "ok", service: "telegram-bridge" });
	});

	it("POST /webhook/telegram returns 401 without secret header", async () => {
		const app = createApp(testConfig);
		const res = await app.request("/webhook/telegram", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ update_id: 1 }),
		});
		expect(res.status).toBe(401);
	});

	it("POST /webhook/telegram returns 200 with correct secret", async () => {
		const app = createApp(testConfig);
		const res = await app.request("/webhook/telegram", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"x-telegram-bot-api-secret-token": testConfig.telegramWebhookSecret,
			},
			body: JSON.stringify({ update_id: 1 }),
		});
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body).toEqual({ ok: true });
	});

	it("POST /webhook/telegram rejects oversized body", async () => {
		const app = createApp(testConfig);
		const largeBody = JSON.stringify({ data: "x".repeat(300_000) });
		const res = await app.request("/webhook/telegram", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"content-length": String(Buffer.byteLength(largeBody)),
				"x-telegram-bot-api-secret-token": testConfig.telegramWebhookSecret,
			},
			body: largeBody,
		});
		expect(res.status).toBe(413);
	});

	it("returns 404 for unknown routes", async () => {
		const app = createApp(testConfig);
		const res = await app.request("/unknown");
		expect(res.status).toBe(404);
	});

	it("rate limits excessive requests", async () => {
		const app = createApp({
			...testConfig,
			rateLimitMaxRequests: 2,
		});

		const makeReq = () =>
			app.request("/webhook/telegram", {
				method: "POST",
				headers: {
					"content-type": "application/json",
					"x-telegram-bot-api-secret-token": testConfig.telegramWebhookSecret,
					"x-forwarded-for": "198.51.100.1",
				},
				body: JSON.stringify({ update_id: 1 }),
			});

		const res1 = await makeReq();
		expect(res1.status).toBe(200);

		const res2 = await makeReq();
		expect(res2.status).toBe(200);

		const res3 = await makeReq();
		expect(res3.status).toBe(429);
	});
});
