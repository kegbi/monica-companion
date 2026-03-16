import { describe, expect, it } from "vitest";
import { createApp } from "../app";
import type { Config } from "../config";

const testConfig: Config = {
	port: 3001,
	telegramWebhookSecret: "test-secret-xyz",
	rateLimitWindowMs: 60_000,
	rateLimitMaxRequests: 100,
	auth: {
		serviceName: "telegram-bridge",
		jwtSecrets: ["test-secret-256-bit-minimum-key!"],
	},
};

describe("observability integration", () => {
	it("GET /health responds successfully with otelMiddleware applied", async () => {
		const app = createApp(testConfig);
		const res = await app.request("/health");
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.status).toBe("ok");
	});

	it("createApp does not throw with observability middleware", () => {
		expect(() => createApp(testConfig)).not.toThrow();
	});
});
