import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GuardrailMetrics } from "../metrics.js";

// We need to mock the sub-modules before importing middleware
vi.mock("../kill-switch.js", () => ({
	isKillSwitchActive: vi.fn().mockResolvedValue(false),
}));

vi.mock("../rate-limiter.js", () => ({
	checkRateLimit: vi
		.fn()
		.mockResolvedValue({ allowed: true, remaining: 29, resetAtMs: Date.now() + 60000 }),
}));

vi.mock("../budget-tracker.js", () => ({
	recordAndCheckBudget: vi.fn().mockResolvedValue({
		allowed: true,
		currentSpendUsd: 1,
		budgetLimitUsd: 100,
		alarmTriggered: false,
	}),
}));

vi.mock("../concurrency-gate.js", () => ({
	acquireConcurrency: vi.fn().mockResolvedValue({ acquired: true, currentConcurrency: 1 }),
	releaseConcurrency: vi.fn().mockResolvedValue(undefined),
}));

import { recordAndCheckBudget } from "../budget-tracker.js";
import { acquireConcurrency, releaseConcurrency } from "../concurrency-gate.js";
import { isKillSwitchActive } from "../kill-switch.js";
import { guardrailMiddleware } from "../middleware.js";
import { checkRateLimit } from "../rate-limiter.js";

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

const mockRedis = {} as any;

function createTestApp(metricsOverride?: GuardrailMetrics) {
	const metrics = metricsOverride ?? createMockMetrics();
	const app = new Hono();

	// Simulate serviceAuth setting context variables
	app.use("*", async (c, next) => {
		// Set userId and correlationId as serviceAuth would
		const userId = c.req.header("x-test-user-id");
		const correlationId = c.req.header("x-test-correlation-id") ?? "corr-1";
		if (userId) {
			c.set("userId", userId);
		}
		c.set("correlationId", correlationId);
		await next();
	});

	app.use(
		"/guarded/*",
		guardrailMiddleware({
			redis: mockRedis,
			modelType: "gpt",
			rateLimit: 30,
			rateWindowSeconds: 60,
			maxConcurrency: 3,
			budgetLimitUsd: 100,
			budgetAlarmThresholdPct: 80,
			costEstimator: () => 0.01,
			metrics,
			service: "ai-router",
		}),
	);

	app.post("/guarded/chat", (c) => c.json({ reply: "Hello!" }));
	app.get("/health", (c) => c.json({ status: "ok" }));

	return { app, metrics };
}

describe("guardrailMiddleware", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		// Reset all mocks to passing state
		vi.mocked(isKillSwitchActive).mockResolvedValue(false);
		vi.mocked(checkRateLimit).mockResolvedValue({
			allowed: true,
			remaining: 29,
			resetAtMs: Date.now() + 60000,
		});
		vi.mocked(recordAndCheckBudget).mockResolvedValue({
			allowed: true,
			currentSpendUsd: 1,
			budgetLimitUsd: 100,
			alarmTriggered: false,
		});
		vi.mocked(acquireConcurrency).mockResolvedValue({ acquired: true, currentConcurrency: 1 });
		vi.mocked(releaseConcurrency).mockResolvedValue(undefined);
	});

	it("request passes when all checks allow", async () => {
		const { app } = createTestApp();
		const res = await app.request("/guarded/chat", {
			method: "POST",
			headers: { "x-test-user-id": "user-1" },
		});
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.reply).toBe("Hello!");
	});

	it("request returns 400 when userId is not present in context", async () => {
		const { app } = createTestApp();
		const res = await app.request("/guarded/chat", {
			method: "POST",
			// No x-test-user-id header
		});
		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.error).toBe("missing_user_id");
	});

	it("request blocked when kill switch is active (503)", async () => {
		vi.mocked(isKillSwitchActive).mockResolvedValue(true);
		const { app, metrics } = createTestApp();
		const res = await app.request("/guarded/chat", {
			method: "POST",
			headers: { "x-test-user-id": "user-1" },
		});
		expect(res.status).toBe(503);
		const body = await res.json();
		expect(body.error).toBe("service_degraded");
		expect(metrics.recordKillSwitchRejection).toHaveBeenCalledWith("ai-router");
	});

	it("request blocked when rate limit exceeded (429)", async () => {
		vi.mocked(checkRateLimit).mockResolvedValue({
			allowed: false,
			remaining: 0,
			resetAtMs: Date.now() + 30000,
		});
		const { app } = createTestApp();
		const res = await app.request("/guarded/chat", {
			method: "POST",
			headers: { "x-test-user-id": "user-1" },
		});
		expect(res.status).toBe(429);
		const body = await res.json();
		expect(body.error).toBe("rate_limited");
		expect(body.retryAfterMs).toBeGreaterThan(0);
	});

	it("request blocked when budget exhausted (503)", async () => {
		vi.mocked(recordAndCheckBudget).mockResolvedValue({
			allowed: false,
			currentSpendUsd: 100,
			budgetLimitUsd: 100,
			alarmTriggered: true,
		});
		const { app } = createTestApp();
		const res = await app.request("/guarded/chat", {
			method: "POST",
			headers: { "x-test-user-id": "user-1" },
		});
		expect(res.status).toBe(503);
		const body = await res.json();
		expect(body.error).toBe("budget_exhausted");
	});

	it("request blocked when concurrency exceeded (429)", async () => {
		vi.mocked(acquireConcurrency).mockResolvedValue({ acquired: false, currentConcurrency: 3 });
		const { app } = createTestApp();
		const res = await app.request("/guarded/chat", {
			method: "POST",
			headers: { "x-test-user-id": "user-1" },
		});
		expect(res.status).toBe(429);
		const body = await res.json();
		expect(body.error).toBe("concurrency_exceeded");
	});

	it("concurrency is released after successful handler execution", async () => {
		const { app } = createTestApp();
		await app.request("/guarded/chat", {
			method: "POST",
			headers: { "x-test-user-id": "user-1" },
		});
		expect(releaseConcurrency).toHaveBeenCalled();
	});

	it("concurrency is released even when handler throws", async () => {
		const metrics = createMockMetrics();
		const app = new Hono();
		app.use("*", async (c, next) => {
			c.set("userId", "user-1");
			c.set("correlationId", "corr-1");
			await next();
		});
		app.use(
			"/guarded/*",
			guardrailMiddleware({
				redis: mockRedis,
				modelType: "gpt",
				rateLimit: 30,
				rateWindowSeconds: 60,
				maxConcurrency: 3,
				budgetLimitUsd: 100,
				budgetAlarmThresholdPct: 80,
				costEstimator: () => 0.01,
				metrics,
				service: "ai-router",
			}),
		);
		app.post("/guarded/chat", () => {
			throw new Error("Handler error");
		});

		// Hono will catch the error and return 500
		await app.request("/guarded/chat", {
			method: "POST",
			headers: { "x-test-user-id": "user-1" },
		});
		expect(releaseConcurrency).toHaveBeenCalled();
	});

	it("checks run in correct order: kill switch first", async () => {
		const callOrder: string[] = [];
		vi.mocked(isKillSwitchActive).mockImplementation(async () => {
			callOrder.push("killSwitch");
			return true; // Block here
		});
		vi.mocked(checkRateLimit).mockImplementation(async () => {
			callOrder.push("rateLimit");
			return { allowed: true, remaining: 29, resetAtMs: Date.now() + 60000 };
		});

		const { app } = createTestApp();
		await app.request("/guarded/chat", {
			method: "POST",
			headers: { "x-test-user-id": "user-1" },
		});

		expect(callOrder[0]).toBe("killSwitch");
		// Rate limit should NOT be called since kill switch blocked
		expect(callOrder).not.toContain("rateLimit");
	});

	it("request returns 503 with service_degraded when Redis is unreachable (fail-closed)", async () => {
		vi.mocked(isKillSwitchActive).mockRejectedValue(new Error("ECONNREFUSED"));
		const { app } = createTestApp();
		const res = await app.request("/guarded/chat", {
			method: "POST",
			headers: { "x-test-user-id": "user-1" },
		});
		expect(res.status).toBe(503);
		const body = await res.json();
		expect(body.error).toBe("service_degraded");
	});

	it("records allowed metric when request passes all checks", async () => {
		const { app, metrics } = createTestApp();
		await app.request("/guarded/chat", {
			method: "POST",
			headers: { "x-test-user-id": "user-1" },
		});
		expect(metrics.recordRequestAllowed).toHaveBeenCalledWith("gpt", "ai-router");
	});
});
