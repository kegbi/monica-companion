import { describe, expect, it } from "vitest";
import { loadConfig } from "../config";

const baseEnv = {
	TELEGRAM_MODE: "webhook" as const,
	TELEGRAM_WEBHOOK_SECRET: "my-secret",
	TELEGRAM_BOT_TOKEN: "123456:ABC-DEF",
	AI_ROUTER_URL: "http://ai-router:3002",
	VOICE_TRANSCRIPTION_URL: "http://voice-transcription:3003",
	USER_MANAGEMENT_URL: "http://user-management:3007",
	REDIS_URL: "redis://localhost:6379",
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
		expect(config.telegramBotToken).toBe("123456:ABC-DEF");
		expect(config.aiRouterUrl).toBe("http://ai-router:3002");
		expect(config.voiceTranscriptionUrl).toBe("http://voice-transcription:3003");
		expect(config.userManagementUrl).toBe("http://user-management:3007");
		expect(config.redisUrl).toBe("redis://localhost:6379");
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
		expect(config.aiRouterTimeoutMs).toBe(120000);
		expect(config.voiceTranscriptionTimeoutMs).toBe(30000);
		expect(config.userManagementTimeoutMs).toBe(5000);
	});

	it("throws when TELEGRAM_WEBHOOK_SECRET is missing in webhook mode", () => {
		const { TELEGRAM_WEBHOOK_SECRET, ...rest } = baseEnv;
		expect(() => loadConfig(rest)).toThrow();
	});

	it("does not throw when TELEGRAM_WEBHOOK_SECRET is missing in polling mode", () => {
		const { TELEGRAM_WEBHOOK_SECRET, ...rest } = baseEnv;
		const config = loadConfig({ ...rest, TELEGRAM_MODE: "polling" });
		expect(config.telegramMode).toBe("polling");
	});

	it("defaults TELEGRAM_MODE to webhook", () => {
		const { TELEGRAM_MODE, ...rest } = baseEnv;
		const config = loadConfig(rest);
		expect(config.telegramMode).toBe("webhook");
	});

	it("throws when TELEGRAM_BOT_TOKEN is missing", () => {
		const { TELEGRAM_BOT_TOKEN, ...rest } = baseEnv;
		expect(() => loadConfig(rest)).toThrow();
	});

	it("throws when AI_ROUTER_URL is missing", () => {
		const { AI_ROUTER_URL, ...rest } = baseEnv;
		expect(() => loadConfig(rest)).toThrow();
	});

	it("throws when VOICE_TRANSCRIPTION_URL is missing", () => {
		const { VOICE_TRANSCRIPTION_URL, ...rest } = baseEnv;
		expect(() => loadConfig(rest)).toThrow();
	});

	it("throws when USER_MANAGEMENT_URL is missing", () => {
		const { USER_MANAGEMENT_URL, ...rest } = baseEnv;
		expect(() => loadConfig(rest)).toThrow();
	});

	it("throws when REDIS_URL is missing", () => {
		const { REDIS_URL, ...rest } = baseEnv;
		expect(() => loadConfig(rest)).toThrow();
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
		const { SERVICE_NAME, ...rest } = baseEnv;
		expect(() => loadConfig(rest)).toThrow();
	});

	it("throws when JWT_SECRET is missing", () => {
		const { JWT_SECRET, ...rest } = baseEnv;
		expect(() => loadConfig(rest)).toThrow();
	});

	it("includes previous JWT secret when provided", () => {
		const config = loadConfig({
			...baseEnv,
			JWT_SECRET_PREVIOUS: "old-secret",
		});
		expect(config.auth.jwtSecrets).toEqual(["test-jwt-secret", "old-secret"]);
	});

	it("overrides timeout defaults when provided", () => {
		const config = loadConfig({
			...baseEnv,
			AI_ROUTER_TIMEOUT_MS: "5000",
			VOICE_TRANSCRIPTION_TIMEOUT_MS: "15000",
			USER_MANAGEMENT_TIMEOUT_MS: "3000",
		});
		expect(config.aiRouterTimeoutMs).toBe(5000);
		expect(config.voiceTranscriptionTimeoutMs).toBe(15000);
		expect(config.userManagementTimeoutMs).toBe(3000);
	});
});
