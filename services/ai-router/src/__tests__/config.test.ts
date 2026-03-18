import { describe, expect, it } from "vitest";
import { loadConfig } from "../config.js";

const baseEnv = {
	SERVICE_NAME: "ai-router" as const,
	JWT_SECRET: "test-jwt-secret",
	DATABASE_URL: "postgresql://monica:monica_dev@localhost:5432/monica_companion",
	MONICA_INTEGRATION_URL: "http://monica-integration:3004",
	REDIS_URL: "redis://localhost:6379",
	OPENAI_API_KEY: "sk-test-key-for-config",
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
});
