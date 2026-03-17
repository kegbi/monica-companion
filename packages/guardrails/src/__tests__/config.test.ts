import { describe, expect, it } from "vitest";
import { loadGuardrailConfig } from "../config.js";

describe("loadGuardrailConfig", () => {
	it("throws when REDIS_URL is missing", () => {
		expect(() => loadGuardrailConfig({})).toThrow();
	});

	it("applies all defaults when only REDIS_URL is provided", () => {
		const config = loadGuardrailConfig({ REDIS_URL: "redis://localhost:6379" });
		expect(config.redisUrl).toBe("redis://localhost:6379");
		expect(config.rateLimitPerUser).toBe(30);
		expect(config.rateWindowSeconds).toBe(60);
		expect(config.concurrencyPerUser).toBe(3);
		expect(config.budgetLimitUsd).toBe(100);
		expect(config.budgetAlarmThresholdPct).toBe(80);
		expect(config.costPerRequestUsd).toBe(0.01);
	});

	it("correctly parses custom values", () => {
		const config = loadGuardrailConfig({
			REDIS_URL: "redis://custom:6380",
			GUARDRAIL_RATE_LIMIT_PER_USER: "50",
			GUARDRAIL_RATE_WINDOW_SECONDS: "120",
			GUARDRAIL_CONCURRENCY_PER_USER: "5",
			GUARDRAIL_BUDGET_LIMIT_USD: "200",
			GUARDRAIL_BUDGET_ALARM_THRESHOLD_PCT: "90",
			GUARDRAIL_COST_PER_REQUEST_USD: "0.05",
		});
		expect(config.redisUrl).toBe("redis://custom:6380");
		expect(config.rateLimitPerUser).toBe(50);
		expect(config.rateWindowSeconds).toBe(120);
		expect(config.concurrencyPerUser).toBe(5);
		expect(config.budgetLimitUsd).toBe(200);
		expect(config.budgetAlarmThresholdPct).toBe(90);
		expect(config.costPerRequestUsd).toBe(0.05);
	});
});
