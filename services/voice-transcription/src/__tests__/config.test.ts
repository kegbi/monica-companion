import { describe, expect, it } from "vitest";
import { loadConfig } from "../config";

const baseEnv: Record<string, string> = {
	SERVICE_NAME: "voice-transcription",
	JWT_SECRET: "test-secret-256-bit-minimum-key!",
	LLM_API_KEY: "sk-test-key-for-testing-only",
	REDIS_URL: "redis://localhost:6379",
};

describe("loadConfig", () => {
	it("loads config with all required fields", () => {
		const config = loadConfig(baseEnv);
		expect(config.auth.jwtSecrets).toEqual(["test-secret-256-bit-minimum-key!"]);
		expect(config.llmApiKey).toBe("sk-test-key-for-testing-only");
		expect(config.redisUrl).toBe("redis://localhost:6379");
	});

	it("applies default whisper settings", () => {
		const config = loadConfig(baseEnv);
		expect(config.whisperModel).toBe("gpt-4o-transcribe");
		expect(config.whisperTimeoutMs).toBe(60000);
		expect(config.whisperMaxFileSizeBytes).toBe(25 * 1024 * 1024);
		expect(config.fetchUrlTimeoutMs).toBe(15000);
	});

	it("allows overriding whisper settings", () => {
		const config = loadConfig({
			...baseEnv,
			WHISPER_MODEL: "whisper-1",
			WHISPER_TIMEOUT_MS: "30000",
			WHISPER_MAX_FILE_SIZE_BYTES: "10485760",
			FETCH_URL_TIMEOUT_MS: "5000",
		});
		expect(config.whisperModel).toBe("whisper-1");
		expect(config.whisperTimeoutMs).toBe(30000);
		expect(config.whisperMaxFileSizeBytes).toBe(10485760);
		expect(config.fetchUrlTimeoutMs).toBe(5000);
	});

	it("derives cost from model pricing map for default model", () => {
		const config = loadConfig(baseEnv);
		expect(config.whisperCostPerMinuteUsd).toBe(0.006);
	});

	it("derives cost from model pricing map for whisper-1", () => {
		const config = loadConfig({ ...baseEnv, WHISPER_MODEL: "whisper-1" });
		expect(config.whisperModel).toBe("whisper-1");
		expect(config.whisperCostPerMinuteUsd).toBe(0.006);
	});

	it("derives cost from model pricing map for gpt-4o-mini-transcribe", () => {
		const config = loadConfig({ ...baseEnv, WHISPER_MODEL: "gpt-4o-mini-transcribe" });
		expect(config.whisperModel).toBe("gpt-4o-mini-transcribe");
		expect(config.whisperCostPerMinuteUsd).toBe(0.003);
	});

	it("throws for unknown model not in pricing map", () => {
		expect(() => loadConfig({ ...baseEnv, WHISPER_MODEL: "unknown-model" })).toThrow(
			/no pricing defined/,
		);
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

	it("throws when LLM_API_KEY is missing", () => {
		const { LLM_API_KEY: _, ...envWithoutKey } = baseEnv;
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
