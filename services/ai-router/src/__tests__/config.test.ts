import { describe, expect, it } from "vitest";
import { loadConfig } from "../config.js";

const baseEnv = {
	SERVICE_NAME: "ai-router" as const,
	JWT_SECRET: "test-jwt-secret",
	DATABASE_URL: "postgresql://monica:monica_dev@localhost:5432/monica_companion",
	MONICA_INTEGRATION_URL: "http://monica-integration:3004",
	DELIVERY_URL: "http://delivery:3006",
	SCHEDULER_URL: "http://scheduler:3005",
	USER_MANAGEMENT_URL: "http://user-management:3007",
	REDIS_URL: "redis://localhost:6379",
	OPENAI_API_KEY: "sk-test-key-for-config",
	LLM_API_KEY: "sk-test-llm-key",
};

describe("loadConfig", () => {
	it("parses valid env", () => {
		const config = loadConfig(baseEnv);
		expect(config.port).toBe(3002);
		expect(config.databaseUrl).toBe(baseEnv.DATABASE_URL);
		expect(config.auth.serviceName).toBe("ai-router");
		expect(config.auth.jwtSecrets).toEqual(["test-jwt-secret"]);
	});

	it("applies default port", () => {
		const config = loadConfig(baseEnv);
		expect(config.port).toBe(3002);
	});

	it("applies default pending command TTL", () => {
		const config = loadConfig(baseEnv);
		expect(config.pendingCommandTtlMinutes).toBe(30);
	});

	it("applies default expiry sweep interval", () => {
		const config = loadConfig(baseEnv);
		expect(config.expirySweepIntervalMs).toBe(60000);
	});

	it("throws when DATABASE_URL is missing", () => {
		const { DATABASE_URL, ...env } = baseEnv;
		expect(() => loadConfig(env)).toThrow();
	});

	it("coerces PORT correctly", () => {
		const config = loadConfig({ ...baseEnv, PORT: "8080" });
		expect(config.port).toBe(8080);
	});

	it("coerces PENDING_COMMAND_TTL_MINUTES correctly", () => {
		const config = loadConfig({ ...baseEnv, PENDING_COMMAND_TTL_MINUTES: "15" });
		expect(config.pendingCommandTtlMinutes).toBe(15);
	});

	it("coerces EXPIRY_SWEEP_INTERVAL_MS correctly", () => {
		const config = loadConfig({ ...baseEnv, EXPIRY_SWEEP_INTERVAL_MS: "30000" });
		expect(config.expirySweepIntervalMs).toBe(30000);
	});

	it("includes previous JWT secret when provided", () => {
		const config = loadConfig({ ...baseEnv, JWT_SECRET_PREVIOUS: "old-secret" });
		expect(config.auth.jwtSecrets).toEqual(["test-jwt-secret", "old-secret"]);
	});

	it("parses MONICA_INTEGRATION_URL", () => {
		const config = loadConfig(baseEnv);
		expect(config.monicaIntegrationUrl).toBe("http://monica-integration:3004");
	});

	it("throws when MONICA_INTEGRATION_URL is missing", () => {
		const { MONICA_INTEGRATION_URL, ...env } = baseEnv;
		expect(() => loadConfig(env)).toThrow();
	});

	it("loads guardrail config with defaults", () => {
		const config = loadConfig(baseEnv);
		expect(config.guardrails.redisUrl).toBe("redis://localhost:6379");
		expect(config.guardrails.rateLimitPerUser).toBe(30);
		expect(config.guardrails.rateWindowSeconds).toBe(60);
		expect(config.guardrails.concurrencyPerUser).toBe(3);
		expect(config.guardrails.budgetLimitUsd).toBe(100);
		expect(config.guardrails.budgetAlarmThresholdPct).toBe(80);
		expect(config.guardrails.costPerRequestUsd).toBe(0.01);
	});

	it("throws when REDIS_URL is missing", () => {
		const { REDIS_URL, ...env } = baseEnv;
		expect(() => loadConfig(env)).toThrow();
	});

	it("parses custom guardrail values", () => {
		const config = loadConfig({
			...baseEnv,
			GUARDRAIL_RATE_LIMIT_PER_USER: "50",
			GUARDRAIL_BUDGET_LIMIT_USD: "200",
		});
		expect(config.guardrails.rateLimitPerUser).toBe(50);
		expect(config.guardrails.budgetLimitUsd).toBe(200);
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

	it("throws when OPENAI_API_KEY is missing", () => {
		const { OPENAI_API_KEY, ...env } = baseEnv;
		expect(() => loadConfig(env)).toThrow();
	});

	it("parses OPENAI_API_KEY when provided", () => {
		const config = loadConfig(baseEnv);
		expect(config.openaiApiKey).toBe("sk-test-key-for-config");
	});

	it("applies default MAX_CONVERSATION_TURNS of 10", () => {
		const config = loadConfig(baseEnv);
		expect(config.maxConversationTurns).toBe(10);
	});

	it("coerces MAX_CONVERSATION_TURNS correctly", () => {
		const config = loadConfig({ ...baseEnv, MAX_CONVERSATION_TURNS: "20" });
		expect(config.maxConversationTurns).toBe(20);
	});

	it("rejects MAX_CONVERSATION_TURNS of 0", () => {
		expect(() => loadConfig({ ...baseEnv, MAX_CONVERSATION_TURNS: "0" })).toThrow();
	});

	it("parses DELIVERY_URL", () => {
		const config = loadConfig(baseEnv);
		expect(config.deliveryUrl).toBe("http://delivery:3006");
	});

	it("throws when DELIVERY_URL is missing", () => {
		const { DELIVERY_URL, ...env } = baseEnv;
		expect(() => loadConfig(env)).toThrow();
	});

	it("parses SCHEDULER_URL", () => {
		const config = loadConfig(baseEnv);
		expect(config.schedulerUrl).toBe("http://scheduler:3005");
	});

	it("throws when SCHEDULER_URL is missing", () => {
		const { SCHEDULER_URL, ...env } = baseEnv;
		expect(() => loadConfig(env)).toThrow();
	});

	it("parses USER_MANAGEMENT_URL", () => {
		const config = loadConfig(baseEnv);
		expect(config.userManagementUrl).toBe("http://user-management:3007");
	});

	it("throws when USER_MANAGEMENT_URL is missing", () => {
		const { USER_MANAGEMENT_URL, ...env } = baseEnv;
		expect(() => loadConfig(env)).toThrow();
	});

	it("applies default AUTO_CONFIRM_CONFIDENCE_THRESHOLD of 0.95", () => {
		const config = loadConfig(baseEnv);
		expect(config.autoConfirmConfidenceThreshold).toBe(0.95);
	});

	it("coerces AUTO_CONFIRM_CONFIDENCE_THRESHOLD correctly", () => {
		const config = loadConfig({ ...baseEnv, AUTO_CONFIRM_CONFIDENCE_THRESHOLD: "0.8" });
		expect(config.autoConfirmConfidenceThreshold).toBe(0.8);
	});

	// --- LLM config vars ---

	it("applies default LLM_BASE_URL of https://openrouter.ai/api/v1", () => {
		const config = loadConfig(baseEnv);
		expect(config.llmBaseUrl).toBe("https://openrouter.ai/api/v1");
	});

	it("parses custom LLM_BASE_URL", () => {
		const config = loadConfig({ ...baseEnv, LLM_BASE_URL: "http://localhost:11434/v1" });
		expect(config.llmBaseUrl).toBe("http://localhost:11434/v1");
	});

	it("throws when LLM_API_KEY is missing", () => {
		const { LLM_API_KEY, ...env } = baseEnv;
		expect(() => loadConfig(env)).toThrow();
	});

	it("parses LLM_API_KEY when provided", () => {
		const config = loadConfig(baseEnv);
		expect(config.llmApiKey).toBe("sk-test-llm-key");
	});

	it("applies default LLM_MODEL_ID of qwen/qwen3-235b-a22b", () => {
		const config = loadConfig(baseEnv);
		expect(config.llmModelId).toBe("qwen/qwen3-235b-a22b");
	});

	it("parses custom LLM_MODEL_ID", () => {
		const config = loadConfig({ ...baseEnv, LLM_MODEL_ID: "openai/gpt-4o" });
		expect(config.llmModelId).toBe("openai/gpt-4o");
	});

	it("applies default HISTORY_INACTIVITY_SWEEP_INTERVAL_MS of 3600000", () => {
		const config = loadConfig(baseEnv);
		expect(config.historyInactivitySweepIntervalMs).toBe(3600000);
	});

	it("coerces HISTORY_INACTIVITY_SWEEP_INTERVAL_MS correctly", () => {
		const config = loadConfig({ ...baseEnv, HISTORY_INACTIVITY_SWEEP_INTERVAL_MS: "1800000" });
		expect(config.historyInactivitySweepIntervalMs).toBe(1800000);
	});
});
