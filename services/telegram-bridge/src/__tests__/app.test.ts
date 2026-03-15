import { signServiceToken } from "@monica-companion/auth";
import { describe, expect, it } from "vitest";
import { createApp } from "../app";
import type { Config } from "../config";

const JWT_SECRET = "test-secret-256-bit-minimum-key!";

const testConfig: Config = {
	port: 3001,
	telegramWebhookSecret: "test-secret-xyz",
	rateLimitWindowMs: 60_000,
	rateLimitMaxRequests: 100,
	auth: {
		serviceName: "telegram-bridge",
		jwtSecrets: [JWT_SECRET],
	},
};

describe("createApp integration", () => {
	it("GET /health returns 200 without auth", async () => {
		const app = createApp(testConfig);
		const res = await app.request("/health");
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body).toEqual({ status: "ok", service: "telegram-bridge" });
	});

	it("GET /health sets X-Correlation-ID header", async () => {
		const app = createApp(testConfig);
		const res = await app.request("/health");
		expect(res.headers.get("X-Correlation-ID")).toBeDefined();
	});

	it("GET /health uses provided X-Correlation-ID", async () => {
		const app = createApp(testConfig);
		const res = await app.request("/health", {
			headers: { "X-Correlation-ID": "trace-abc" },
		});
		expect(res.headers.get("X-Correlation-ID")).toBe("trace-abc");
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

describe("internal endpoint auth", () => {
	it("POST /internal/send returns 401 without token", async () => {
		const app = createApp(testConfig);
		const res = await app.request("/internal/send", { method: "POST" });
		expect(res.status).toBe(401);
		const body = await res.json();
		expect(body.error).toBe("Missing or invalid Authorization header");
	});

	it("POST /internal/send returns 401 with invalid token", async () => {
		const app = createApp(testConfig);
		const res = await app.request("/internal/send", {
			method: "POST",
			headers: { Authorization: "Bearer invalid.token.here" },
		});
		expect(res.status).toBe(401);
	});

	it("POST /internal/send returns 403 for disallowed caller", async () => {
		const token = await signServiceToken({
			issuer: "ai-router",
			audience: "telegram-bridge",
			secret: JWT_SECRET,
		});
		const app = createApp(testConfig);
		const res = await app.request("/internal/send", {
			method: "POST",
			headers: { Authorization: `Bearer ${token}` },
		});
		expect(res.status).toBe(403);
		const body = await res.json();
		expect(body.error).toBe("Caller not allowed");
	});

	it("POST /internal/send returns 200 with valid token from delivery", async () => {
		const token = await signServiceToken({
			issuer: "delivery",
			audience: "telegram-bridge",
			secret: JWT_SECRET,
		});
		const app = createApp(testConfig);
		const res = await app.request("/internal/send", {
			method: "POST",
			headers: { Authorization: `Bearer ${token}` },
		});
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body).toEqual({ ok: true });
	});

	it("POST /internal/send sets X-Correlation-ID from token", async () => {
		const token = await signServiceToken({
			issuer: "delivery",
			audience: "telegram-bridge",
			secret: JWT_SECRET,
			correlationId: "corr-xyz",
		});
		const app = createApp(testConfig);
		const res = await app.request("/internal/send", {
			method: "POST",
			headers: { Authorization: `Bearer ${token}` },
		});
		expect(res.headers.get("X-Correlation-ID")).toBe("corr-xyz");
	});

	it("POST /internal/send returns 401 with wrong audience", async () => {
		const token = await signServiceToken({
			issuer: "delivery",
			audience: "ai-router",
			secret: JWT_SECRET,
		});
		const app = createApp(testConfig);
		const res = await app.request("/internal/send", {
			method: "POST",
			headers: { Authorization: `Bearer ${token}` },
		});
		expect(res.status).toBe(401);
	});
});
