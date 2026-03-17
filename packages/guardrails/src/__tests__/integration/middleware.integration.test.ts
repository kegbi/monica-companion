import { Hono } from "hono";
import RedisClient from "ioredis";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { setKillSwitch } from "../../kill-switch.js";
import { createGuardrailMetrics } from "../../metrics.js";
import { guardrailMiddleware } from "../../middleware.js";

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
let redis: RedisClient;
let available = false;

beforeAll(async () => {
	try {
		redis = new RedisClient(REDIS_URL, { lazyConnect: true, connectTimeout: 2000 });
		await redis.connect();
		await redis.ping();
		available = true;
	} catch {
		available = false;
	}
});

afterEach(async () => {
	if (available) {
		// Clean up all guardrail keys
		const keys = await redis.keys("guardrail:*");
		if (keys.length > 0) await redis.del(...keys);
	}
});

afterAll(async () => {
	if (available) {
		await redis.quit();
	}
});

describe.skipIf(!available)("guardrail middleware integration (real Redis)", () => {
	function createTestApp() {
		const metrics = createGuardrailMetrics();
		const app = new Hono();

		app.use("*", async (c, next) => {
			const userId = c.req.header("x-test-user-id");
			const correlationId = c.req.header("x-test-correlation-id") ?? "corr-integ";
			if (userId) c.set("userId", userId);
			c.set("correlationId", correlationId);
			await next();
		});

		app.use(
			"/guarded/*",
			guardrailMiddleware({
				redis,
				modelType: "integ-test",
				rateLimit: 5,
				rateWindowSeconds: 60,
				maxConcurrency: 2,
				budgetLimitUsd: 1.0,
				budgetAlarmThresholdPct: 80,
				costEstimator: () => 0.01,
				metrics,
				service: "integ-test",
			}),
		);

		app.post("/guarded/chat", (c) => c.json({ reply: "ok" }));
		return app;
	}

	it("allows a normal request through all guardrails with real Redis", async () => {
		const app = createTestApp();
		const res = await app.request("/guarded/chat", {
			method: "POST",
			headers: { "x-test-user-id": "integ-user-1" },
		});
		expect(res.status).toBe(200);
	});

	it("kill switch blocks requests via real Redis", async () => {
		await setKillSwitch(redis, true);
		const app = createTestApp();
		const res = await app.request("/guarded/chat", {
			method: "POST",
			headers: { "x-test-user-id": "integ-user-1" },
		});
		expect(res.status).toBe(503);
		const body = await res.json();
		expect(body.error).toBe("service_degraded");
	});

	it("rate limits after exceeding threshold via real Redis", async () => {
		const app = createTestApp();
		// Send 5 requests (limit)
		for (let i = 0; i < 5; i++) {
			const r = await app.request("/guarded/chat", {
				method: "POST",
				headers: { "x-test-user-id": "integ-rate-user" },
			});
			expect(r.status).toBe(200);
		}
		// 6th request should be rate limited
		const res = await app.request("/guarded/chat", {
			method: "POST",
			headers: { "x-test-user-id": "integ-rate-user" },
		});
		expect(res.status).toBe(429);
		const body = await res.json();
		expect(body.error).toBe("rate_limited");
	});
});
