import Redis from "ioredis";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { isKillSwitchActive, setKillSwitch } from "../../kill-switch.js";
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
		await redis.del("guardrail:kill-switch");
	}
});

afterAll(async () => {
	if (available) {
		await redis.quit();
	}
});

describe.skipIf(!available)("kill-switch integration (real Redis)", () => {
	it("returns false when not set", async () => {
		const metrics = createMockMetrics();
		expect(await isKillSwitchActive(redis, metrics)).toBe(false);
	});

	it("returns true after setting to active", async () => {
		const metrics = createMockMetrics();
		await setKillSwitch(redis, true);
		expect(await isKillSwitchActive(redis, metrics)).toBe(true);
	});

	it("returns false after clearing", async () => {
		const metrics = createMockMetrics();
		await setKillSwitch(redis, true);
		await setKillSwitch(redis, false);
		expect(await isKillSwitchActive(redis, metrics)).toBe(false);
	});
});
