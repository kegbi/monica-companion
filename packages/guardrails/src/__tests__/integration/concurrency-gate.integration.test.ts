import Redis from "ioredis";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { acquireConcurrency, releaseConcurrency } from "../../concurrency-gate.js";
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
		const keys = await redis.keys("guardrail:concurrency:test:*");
		if (keys.length > 0) await redis.del(...keys);
	}
});

afterAll(async () => {
	if (available) {
		await redis.quit();
	}
});

describe.skipIf(!available)("concurrency-gate integration (real Redis)", () => {
	it("acquires and releases concurrency slots", async () => {
		const metrics = createMockMetrics();
		const r1 = await acquireConcurrency(redis, "integ-user-1", "test", "req-1", 2, metrics, "test");
		expect(r1.acquired).toBe(true);

		const r2 = await acquireConcurrency(redis, "integ-user-1", "test", "req-2", 2, metrics, "test");
		expect(r2.acquired).toBe(true);

		const r3 = await acquireConcurrency(redis, "integ-user-1", "test", "req-3", 2, metrics, "test");
		expect(r3.acquired).toBe(false);

		await releaseConcurrency(redis, "integ-user-1", "test", "req-1");

		const r4 = await acquireConcurrency(redis, "integ-user-1", "test", "req-4", 2, metrics, "test");
		expect(r4.acquired).toBe(true);
	});
});
