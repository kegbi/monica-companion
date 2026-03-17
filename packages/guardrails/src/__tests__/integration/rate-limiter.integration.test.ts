import Redis from "ioredis";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { GuardrailMetrics } from "../../metrics.js";
import { checkRateLimit } from "../../rate-limiter.js";

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
		// Clean up test keys
		const keys = await redis.keys("guardrail:rate:test:*");
		if (keys.length > 0) await redis.del(...keys);
	}
});

afterAll(async () => {
	if (available) {
		await redis.quit();
	}
});

describe.skipIf(!available)("rate-limiter integration (real Redis)", () => {
	it("allows requests within the rate limit", async () => {
		const metrics = createMockMetrics();
		const result = await checkRateLimit(redis, "integ-user-1", "test", 5, 10, metrics, "test");
		expect(result.allowed).toBe(true);
		expect(result.remaining).toBe(4);
	});

	it("rejects requests exceeding the rate limit", async () => {
		const metrics = createMockMetrics();
		const limit = 3;
		for (let i = 0; i < limit; i++) {
			await checkRateLimit(redis, "integ-user-2", "test", limit, 10, metrics, "test");
		}
		const result = await checkRateLimit(redis, "integ-user-2", "test", limit, 10, metrics, "test");
		expect(result.allowed).toBe(false);
		expect(result.remaining).toBe(0);
	});
});
