import { describe, expect, it } from "vitest";
import { loadConfig } from "../config";

describe("loadConfig", () => {
	it("parses valid env", () => {
		const config = loadConfig({
			PORT: "3001",
			TELEGRAM_WEBHOOK_SECRET: "my-secret",
			RATE_LIMIT_WINDOW_MS: "30000",
			RATE_LIMIT_MAX_REQUESTS: "100",
		});

		expect(config).toEqual({
			port: 3001,
			telegramWebhookSecret: "my-secret",
			rateLimitWindowMs: 30_000,
			rateLimitMaxRequests: 100,
		});
	});

	it("applies defaults for optional fields", () => {
		const config = loadConfig({
			TELEGRAM_WEBHOOK_SECRET: "my-secret",
		});

		expect(config.port).toBe(3001);
		expect(config.rateLimitWindowMs).toBe(60_000);
		expect(config.rateLimitMaxRequests).toBe(60);
	});

	it("throws when TELEGRAM_WEBHOOK_SECRET is missing", () => {
		expect(() => loadConfig({})).toThrow();
	});

	it("throws when TELEGRAM_WEBHOOK_SECRET is empty", () => {
		expect(() => loadConfig({ TELEGRAM_WEBHOOK_SECRET: "" })).toThrow();
	});

	it("throws when PORT is not a valid number", () => {
		expect(() => loadConfig({ TELEGRAM_WEBHOOK_SECRET: "s", PORT: "not-a-number" })).toThrow();
	});

	it("coerces string numbers correctly", () => {
		const config = loadConfig({
			TELEGRAM_WEBHOOK_SECRET: "s",
			PORT: "8080",
			RATE_LIMIT_WINDOW_MS: "5000",
			RATE_LIMIT_MAX_REQUESTS: "10",
		});

		expect(config.port).toBe(8080);
		expect(config.rateLimitWindowMs).toBe(5000);
		expect(config.rateLimitMaxRequests).toBe(10);
	});
});
