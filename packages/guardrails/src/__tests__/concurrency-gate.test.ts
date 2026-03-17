import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { acquireConcurrency, releaseConcurrency } from "../concurrency-gate.js";
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

function createMockRedis(currentCount: number) {
	const execResult = [
		[null, 0], // ZREMRANGEBYSCORE (cleanup stale)
		[null, currentCount], // ZCARD (count after cleanup)
	];
	const mockMulti = {
		zremrangebyscore: vi.fn().mockReturnThis(),
		zcard: vi.fn().mockReturnThis(),
		exec: vi.fn().mockResolvedValue(execResult),
	};
	const acquireExecResult = [
		[null, 1], // ZADD
		[null, 1], // EXPIRE
	];
	const mockAcquireMulti = {
		zadd: vi.fn().mockReturnThis(),
		expire: vi.fn().mockReturnThis(),
		exec: vi.fn().mockResolvedValue(acquireExecResult),
	};
	let multiCallCount = 0;
	return {
		multi: vi.fn().mockImplementation(() => {
			multiCallCount++;
			if (multiCallCount === 1) return mockMulti;
			return mockAcquireMulti;
		}),
		zrem: vi.fn().mockResolvedValue(1),
		_mockMulti: mockMulti,
	};
}

describe("acquireConcurrency", () => {
	let metrics: GuardrailMetrics;

	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-03-17T12:00:00Z"));
		metrics = createMockMetrics();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("first acquire within limit returns acquired: true", async () => {
		const redis = createMockRedis(0); // 0 current requests
		const result = await acquireConcurrency(
			redis as any,
			"user-1",
			"gpt",
			"req-1",
			3,
			metrics,
			"ai-router",
		);
		expect(result.acquired).toBe(true);
		expect(result.currentConcurrency).toBe(1);
	});

	it("acquire at limit returns acquired: false", async () => {
		const redis = createMockRedis(3); // already at max 3
		const result = await acquireConcurrency(
			redis as any,
			"user-1",
			"gpt",
			"req-4",
			3,
			metrics,
			"ai-router",
		);
		expect(result.acquired).toBe(false);
		expect(result.currentConcurrency).toBe(3);
		expect(metrics.recordConcurrencyRejection).toHaveBeenCalledWith("gpt", "ai-router");
	});

	it("does not record rejection metric when acquired", async () => {
		const redis = createMockRedis(0);
		await acquireConcurrency(redis as any, "user-1", "gpt", "req-1", 3, metrics, "ai-router");
		expect(metrics.recordConcurrencyRejection).not.toHaveBeenCalled();
	});
});

describe("releaseConcurrency", () => {
	it("calls zrem to remove the request entry", async () => {
		const redis = {
			zrem: vi.fn().mockResolvedValue(1),
		};
		await releaseConcurrency(redis as any, "user-1", "gpt", "req-1");
		expect(redis.zrem).toHaveBeenCalledWith("guardrail:concurrency:gpt:user-1", "req-1");
	});
});
