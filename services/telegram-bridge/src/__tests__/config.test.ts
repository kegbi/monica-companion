import { describe, expect, it } from "vitest";
import { loadConfig } from "../config";

const baseEnv = {
	TELEGRAM_WEBHOOK_SECRET: "my-secret",
	SERVICE_NAME: "telegram-bridge" as const,
	JWT_SECRET: "test-jwt-secret",
};

describe("loadConfig", () => {
	it("parses valid env", () => {
		const config = loadConfig({
			...baseEnv,
			PORT: "3001",
			RATE_LIMIT_WINDOW_MS: "30000",
			RATE_LIMIT_MAX_REQUESTS: "100",
		});

		expect(config.port).toBe(3001);
		expect(config.telegramWebhookSecret).toBe("my-secret");
		expect(config.rateLimitWindowMs).toBe(30_000);
		expect(config.rateLimitMaxRequests).toBe(100);
		expect(config.auth.serviceName).toBe("telegram-bridge");
		expect(config.auth.jwtSecrets).toEqual(["test-jwt-secret"]);
	});

	it("applies defaults for optional fields", () => {
		const config = loadConfig(baseEnv);

		expect(config.port).toBe(3001);
		expect(config.rateLimitWindowMs).toBe(60_000);
		expect(config.rateLimitMaxRequests).toBe(60);
	});

	it("throws when TELEGRAM_WEBHOOK_SECRET is missing", () => {
		expect(() => loadConfig({ SERVICE_NAME: "telegram-bridge", JWT_SECRET: "s" })).toThrow();
	});

	it("throws when TELEGRAM_WEBHOOK_SECRET is empty", () => {
		expect(() => loadConfig({ ...baseEnv, TELEGRAM_WEBHOOK_SECRET: "" })).toThrow();
	});

	it("throws when PORT is not a valid number", () => {
		expect(() => loadConfig({ ...baseEnv, PORT: "not-a-number" })).toThrow();
	});

	it("coerces string numbers correctly", () => {
		const config = loadConfig({
			...baseEnv,
			PORT: "8080",
			RATE_LIMIT_WINDOW_MS: "5000",
			RATE_LIMIT_MAX_REQUESTS: "10",
		});

		expect(config.port).toBe(8080);
		expect(config.rateLimitWindowMs).toBe(5000);
		expect(config.rateLimitMaxRequests).toBe(10);
	});

	it("throws when SERVICE_NAME is missing", () => {
		expect(() => loadConfig({ TELEGRAM_WEBHOOK_SECRET: "s", JWT_SECRET: "s" })).toThrow();
	});

	it("throws when JWT_SECRET is missing", () => {
		expect(() =>
			loadConfig({ TELEGRAM_WEBHOOK_SECRET: "s", SERVICE_NAME: "telegram-bridge" }),
		).toThrow();
	});

	it("includes previous JWT secret when provided", () => {
		const config = loadConfig({
			...baseEnv,
			JWT_SECRET_PREVIOUS: "old-secret",
		});
		expect(config.auth.jwtSecrets).toEqual(["test-jwt-secret", "old-secret"]);
	});
});
