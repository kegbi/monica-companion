import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	type BudgetCheckResult,
	getCurrentSpend,
	recordAndCheckBudget,
} from "../budget-tracker.js";
import type { GuardrailMetrics } from "../metrics.js";

function createMockMetrics(): GuardrailMetrics {
	return {
		recordRateLimitRejection: vi.fn(),
		recordConcurrencyRejection: vi.fn(),
		updateBudgetSpend: vi.fn(),
		updateBudgetLimit: vi.fn(),
		updateBudgetAlarm: vi.fn(),
		recordBudgetExhaustion: vi.fn(),
		updateKillSwitch: vi.fn(),
		recordKillSwitchRejection: vi.fn(),
		recordRequestAllowed: vi.fn(),
	};
}

function createMockRedis(currentCents: number | null, postIncrCents?: number) {
	return {
		get: vi.fn().mockResolvedValue(currentCents !== null ? String(currentCents) : null),
		incrby: vi.fn().mockResolvedValue(postIncrCents ?? currentCents ?? 0),
		expire: vi.fn().mockResolvedValue(1),
	};
}

describe("recordAndCheckBudget", () => {
	let metrics: GuardrailMetrics;

	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-03-17T12:00:00Z"));
		metrics = createMockMetrics();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("first request with cost below budget returns allowed: true, alarmTriggered: false", async () => {
		const redis = createMockRedis(null, 1); // No prior spend, 1 cent after increment
		const result = await recordAndCheckBudget(redis as any, 0.01, 100, 80, metrics);
		expect(result.allowed).toBe(true);
		expect(result.alarmTriggered).toBe(false);
		expect(result.currentSpendUsd).toBeCloseTo(0.01);
	});

	it("request pushing spend past alarm threshold returns alarmTriggered: true, allowed: true", async () => {
		// Current spend: $79.99 (7999 cents), cost: $0.02 (2 cents), limit: $100, alarm at 80%
		// After: $80.01 (8001 cents) = above 80% of $100
		const redis = createMockRedis(7999, 8001);
		const result = await recordAndCheckBudget(redis as any, 0.02, 100, 80, metrics);
		expect(result.allowed).toBe(true);
		expect(result.alarmTriggered).toBe(true);
		expect(metrics.updateBudgetAlarm).toHaveBeenCalledWith(true);
	});

	it("request pushing spend past 100% returns allowed: false", async () => {
		// Current spend: $99.99 (9999 cents), cost: $0.02 (2 cents), limit: $100
		// After: $100.01 (10001 cents) = above limit
		const redis = createMockRedis(9999, 10001);
		const result = await recordAndCheckBudget(redis as any, 0.02, 100, 80, metrics);
		expect(result.allowed).toBe(false);
		expect(metrics.recordBudgetExhaustion).toHaveBeenCalled();
	});

	it("when budget is already exhausted, returns allowed: false without INCRBY", async () => {
		// Current spend: $100.00 (10000 cents), limit: $100
		const redis = createMockRedis(10000);
		const result = await recordAndCheckBudget(redis as any, 0.01, 100, 80, metrics);
		expect(result.allowed).toBe(false);
		expect(redis.incrby).not.toHaveBeenCalled();
		expect(metrics.recordBudgetExhaustion).toHaveBeenCalled();
	});

	it("monthly key uses current year-month", async () => {
		const redis = createMockRedis(null, 1);
		await recordAndCheckBudget(redis as any, 0.01, 100, 80, metrics);
		expect(redis.get).toHaveBeenCalledWith("guardrail:budget:2026-03");
	});

	it("updates budget spend and limit gauges", async () => {
		const redis = createMockRedis(null, 1);
		await recordAndCheckBudget(redis as any, 0.01, 100, 80, metrics);
		expect(metrics.updateBudgetSpend).toHaveBeenCalled();
		expect(metrics.updateBudgetLimit).toHaveBeenCalledWith(100);
	});
});

describe("getCurrentSpend", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-03-17T12:00:00Z"));
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("returns 0 when no budget key exists", async () => {
		const redis = { get: vi.fn().mockResolvedValue(null) };
		const spend = await getCurrentSpend(redis as any);
		expect(spend).toBe(0);
	});

	it("returns the current spend in USD", async () => {
		const redis = { get: vi.fn().mockResolvedValue("5000") };
		const spend = await getCurrentSpend(redis as any);
		expect(spend).toBeCloseTo(50);
	});
});
