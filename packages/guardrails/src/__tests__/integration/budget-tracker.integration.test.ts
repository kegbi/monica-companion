import Redis from "ioredis";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { getCurrentSpend, recordAndCheckBudget } from "../../budget-tracker.js";
import type { GuardrailMetrics } from "../../metrics.js";

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

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
let redis: Redis;
let available = false;

beforeAll(async () => {
	try {
		redis = new Redis(REDIS_URL, { lazyConnect: true, connectTimeout: 2000 });
		await redis.connect();
		await redis.ping();
		available = true;
	} catch {
		available = false;
	}
});

afterEach(async () => {
	if (available) {
		const keys = await redis.keys("guardrail:budget:*");
		if (keys.length > 0) await redis.del(...keys);
	}
});

afterAll(async () => {
	if (available) {
		await redis.quit();
	}
});

describe.skipIf(!available)("budget-tracker integration (real Redis)", () => {
	it("tracks cumulative spend across requests", async () => {
		const metrics = createMockMetrics();

		const r1 = await recordAndCheckBudget(redis, 0.5, 2.0, 80, metrics);
		expect(r1.allowed).toBe(true);
		expect(r1.currentSpendUsd).toBeCloseTo(0.5);

		const r2 = await recordAndCheckBudget(redis, 0.5, 2.0, 80, metrics);
		expect(r2.allowed).toBe(true);
		expect(r2.currentSpendUsd).toBeCloseTo(1.0);

		const spend = await getCurrentSpend(redis);
		expect(spend).toBeCloseTo(1.0);
	});

	it("rejects when budget is exhausted", async () => {
		const metrics = createMockMetrics();

		await recordAndCheckBudget(redis, 1.0, 1.0, 80, metrics);
		const r2 = await recordAndCheckBudget(redis, 0.01, 1.0, 80, metrics);
		expect(r2.allowed).toBe(false);
	});
});
