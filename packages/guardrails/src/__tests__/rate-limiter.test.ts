import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import type { GuardrailMetrics } from "../metrics.js";
import { checkRateLimit, type RateLimitResult } from "../rate-limiter.js";

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

function createMockRedis(zcard: number) {
	const execResult = [
		[null, 0], // ZREMRANGEBYSCORE
		[null, 1], // ZADD
		[null, zcard], // ZCARD
		[null, 1], // EXPIRE
	];
	const mockMulti = {
		zremrangebyscore: vi.fn().mockReturnThis(),
		zadd: vi.fn().mockReturnThis(),
		zcard: vi.fn().mockReturnThis(),
		expire: vi.fn().mockReturnThis(),
		exec: vi.fn().mockResolvedValue(execResult),
	};
	return {
		multi: vi.fn().mockReturnValue(mockMulti),
		_mockMulti: mockMulti,
	};
}

describe("checkRateLimit", () => {
	let metrics: GuardrailMetrics;

	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-03-17T12:00:00Z"));
		metrics = createMockMetrics();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("first request within limit returns allowed: true with correct remaining", async () => {
		const redis = createMockRedis(1); // 1 entry after ZADD = first request
		const result = await checkRateLimit(
			redis as any,
			"user-1",
			"gpt",
			30,
			60,
			metrics,
			"ai-router",
		);
		expect(result.allowed).toBe(true);
		expect(result.remaining).toBe(29);
	});

	it("request exceeding limit returns allowed: false with remaining: 0", async () => {
		const redis = createMockRedis(31); // 31 entries = exceeded limit of 30
		const result = await checkRateLimit(
			redis as any,
			"user-1",
			"gpt",
			30,
			60,
			metrics,
			"ai-router",
		);
		expect(result.allowed).toBe(false);
		expect(result.remaining).toBe(0);
		expect(metrics.recordRateLimitRejection).toHaveBeenCalledWith("gpt", "ai-router");
	});

	it("returns a resetAtMs value in the future", async () => {
		const redis = createMockRedis(1);
		const result = await checkRateLimit(
			redis as any,
			"user-1",
			"gpt",
			30,
			60,
			metrics,
			"ai-router",
		);
		const now = Date.now();
		expect(result.resetAtMs).toBeGreaterThan(now);
		expect(result.resetAtMs).toBeLessThanOrEqual(now + 60000);
	});

	it("does not record rejection metric when allowed", async () => {
		const redis = createMockRedis(1);
		await checkRateLimit(redis as any, "user-1", "gpt", 30, 60, metrics, "ai-router");
		expect(metrics.recordRateLimitRejection).not.toHaveBeenCalled();
	});
});
