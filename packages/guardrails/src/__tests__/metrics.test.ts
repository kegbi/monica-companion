import { describe, expect, it, vi } from "vitest";
import { createGuardrailMetrics } from "../metrics.js";

// Mock @opentelemetry/api
vi.mock("@opentelemetry/api", () => {
	const mockCounter = { add: vi.fn() };
	const mockGauge = { record: vi.fn() };
	const mockMeter = {
		createCounter: vi.fn(() => mockCounter),
		createGauge: vi.fn(() => mockGauge),
	};
	return {
		metrics: {
			getMeter: vi.fn(() => mockMeter),
		},
	};
});

describe("createGuardrailMetrics", () => {
	it("returns an object with all expected methods", () => {
		const m = createGuardrailMetrics();
		expect(typeof m.recordRateLimitRejection).toBe("function");
		expect(typeof m.recordConcurrencyRejection).toBe("function");
		expect(typeof m.updateBudgetSpend).toBe("function");
		expect(typeof m.updateBudgetLimit).toBe("function");
		expect(typeof m.updateBudgetAlarm).toBe("function");
		expect(typeof m.recordBudgetExhaustion).toBe("function");
		expect(typeof m.updateKillSwitch).toBe("function");
		expect(typeof m.recordKillSwitchRejection).toBe("function");
		expect(typeof m.recordRequestAllowed).toBe("function");
	});

	it("recordRateLimitRejection increments the counter", async () => {
		const { metrics } = await import("@opentelemetry/api");
		const meter = metrics.getMeter("guardrails");
		const counter = meter.createCounter("test");
		const m = createGuardrailMetrics();

		m.recordRateLimitRejection("gpt", "ai-router");
		expect(counter.add).toHaveBeenCalled();
	});

	it("updateBudgetAlarm sets the gauge value", async () => {
		const { metrics } = await import("@opentelemetry/api");
		const meter = metrics.getMeter("guardrails");
		const gauge = meter.createGauge("test");
		const m = createGuardrailMetrics();

		m.updateBudgetAlarm(true);
		expect(gauge.record).toHaveBeenCalled();
	});
});
