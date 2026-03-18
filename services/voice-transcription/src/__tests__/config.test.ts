import { describe, expect, it } from "vitest";
import { loadConfig } from "../config";

const baseEnv: Record<string, string> = {
	SERVICE_NAME: "voice-transcription",
	JWT_SECRET: "test-secret-256-bit-minimum-key!",
	OPENAI_API_KEY: "sk-test-key-for-testing-only",
	REDIS_URL: "redis://localhost:6379",
};

describe("loadConfig", () => {
	it("loads config with all required fields", () => {
		const config = loadConfig(baseEnv);
		expect(config.auth.jwtSecrets).toEqual(["test-secret-256-bit-minimum-key!"]);
		expect(config.openaiApiKey).toBe("sk-test-key-for-testing-only");
		expect(config.redisUrl).toBe("redis://localhost:6379");
	});

	it("applies default whisper settings", () => {
		const config = loadConfig(baseEnv);
		expect(config.whisperModel).toBe("whisper-1");
		expect(config.whisperTimeoutMs).toBe(60000);
		expect(config.whisperMaxFileSizeBytes).toBe(25 * 1024 * 1024);
		expect(config.fetchUrlTimeoutMs).toBe(15000);
	});

	it("allows overriding whisper settings", () => {
		const config = loadConfig({
			...baseEnv,
			WHISPER_MODEL: "whisper-2",
			WHISPER_TIMEOUT_MS: "30000",
			WHISPER_MAX_FILE_SIZE_BYTES: "10485760",
			FETCH_URL_TIMEOUT_MS: "5000",
		});
		expect(config.whisperModel).toBe("whisper-2");
		expect(config.whisperTimeoutMs).toBe(30000);
		expect(config.whisperMaxFileSizeBytes).toBe(10485760);
		expect(config.fetchUrlTimeoutMs).toBe(5000);
	});

	it("loads whisper cost per minute with default", () => {
		const config = loadConfig(baseEnv);
		expect(config.whisperCostPerMinuteUsd).toBe(0.006);
	});

	it("allows overriding whisper cost per minute", () => {
		const config = loadConfig({
			...baseEnv,
			WHISPER_COST_PER_MINUTE_USD: "0.012",
		});
		expect(config.whisperCostPerMinuteUsd).toBe(0.012);
	});

	it("loads guardrail config", () => {
		const config = loadConfig({
			...baseEnv,
			GUARDRAIL_RATE_LIMIT_PER_USER: "10",
			GUARDRAIL_RATE_WINDOW_SECONDS: "30",
			GUARDRAIL_CONCURRENCY_PER_USER: "2",
			GUARDRAIL_BUDGET_LIMIT_USD: "50",
			GUARDRAIL_BUDGET_ALARM_THRESHOLD_PCT: "90",
			GUARDRAIL_COST_PER_REQUEST_USD: "0.02",
		});
		expect(config.guardrails.rateLimitPerUser).toBe(10);
		expect(config.guardrails.rateWindowSeconds).toBe(30);
		expect(config.guardrails.concurrencyPerUser).toBe(2);
		expect(config.guardrails.budgetLimitUsd).toBe(50);
		expect(config.guardrails.budgetAlarmThresholdPct).toBe(90);
	});

	it("throws when OPENAI_API_KEY is missing", () => {
		const { OPENAI_API_KEY: _, ...envWithoutKey } = baseEnv;
		expect(() => loadConfig(envWithoutKey)).toThrow();
	});

	it("throws when REDIS_URL is missing", () => {
		const { REDIS_URL: _, ...envWithoutRedis } = baseEnv;
		expect(() => loadConfig(envWithoutRedis)).toThrow();
	});

	it("defaults inboundAllowedCallers to ['telegram-bridge']", () => {
		const config = loadConfig(baseEnv);
		expect(config.inboundAllowedCallers).toEqual(["telegram-bridge"]);
	});

	it("parses INBOUND_ALLOWED_CALLERS from comma-separated env var", () => {
		const config = loadConfig({
			...baseEnv,
			INBOUND_ALLOWED_CALLERS: "telegram-bridge,whatsapp-bridge",
		});
		expect(config.inboundAllowedCallers).toEqual(["telegram-bridge", "whatsapp-bridge"]);
	});
});
