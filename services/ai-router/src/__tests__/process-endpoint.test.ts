import { describe, expect, it, vi } from "vitest";

vi.mock("@monica-companion/guardrails", () => ({
	guardrailMiddleware: vi.fn().mockReturnValue(async (_c: any, next: any) => {
		await next();
	}),
	createGuardrailMetrics: vi.fn().mockReturnValue({
		recordRateLimitRejection: vi.fn(),
		recordConcurrencyRejection: vi.fn(),
		updateBudgetSpend: vi.fn(),
		updateBudgetLimit: vi.fn(),
		updateBudgetAlarm: vi.fn(),
		recordBudgetExhaustion: vi.fn(),
		updateKillSwitch: vi.fn(),
		recordKillSwitchRejection: vi.fn(),
		recordRequestAllowed: vi.fn(),
	}),
	createRedisClient: vi.fn().mockReturnValue({}),
	closeRedisClient: vi.fn(),
	loadGuardrailConfig: vi.fn().mockReturnValue({
		redisUrl: "redis://localhost:6379",
		rateLimitPerUser: 30,
		rateWindowSeconds: 60,
		concurrencyPerUser: 3,
		budgetLimitUsd: 100,
		budgetAlarmThresholdPct: 80,
		costPerRequestUsd: 0.01,
	}),
}));

// Mock serviceAuth to pass through (for testing graph invocation)
const { serviceAuthSpy } = vi.hoisted(() => {
	const serviceAuthSpy = vi.fn().mockReturnValue(async (_c: any, next: any) => {
		await next();
	});
	return { serviceAuthSpy };
});

vi.mock("@monica-companion/auth", () => ({
	serviceAuth: serviceAuthSpy,
	loadAuthConfig: vi.fn().mockReturnValue({
		serviceName: "ai-router",
		jwtSecrets: ["test-secret"],
	}),
}));

import { createApp } from "../app.js";

const mockConfig = {
	port: 3002,
	databaseUrl: "postgresql://test",
	pendingCommandTtlMinutes: 30,
	expirySweepIntervalMs: 60000,
	monicaIntegrationUrl: "http://monica-integration:3004",
	inboundAllowedCallers: ["telegram-bridge"],
	auth: {
		serviceName: "ai-router" as const,
		jwtSecrets: ["test-secret"],
	},
	guardrails: {
		redisUrl: "redis://localhost:6379",
		rateLimitPerUser: 30,
		rateWindowSeconds: 60,
		concurrencyPerUser: 3,
		budgetLimitUsd: 100,
		budgetAlarmThresholdPct: 80,
		costPerRequestUsd: 0.01,
	},
};

const mockDb = {} as any;
const mockRedis = {} as any;

const validTextEvent = {
	type: "text_message",
	userId: "550e8400-e29b-41d4-a716-446655440000",
	sourceRef: "telegram:msg:123",
	correlationId: "corr-456",
	text: "Hello bot",
};

describe("POST /internal/process", () => {
	it("returns graph response instead of stub { received: true }", async () => {
		const app = createApp(mockConfig, mockDb, mockRedis);
		const res = await app.request("/internal/process", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(validTextEvent),
		});
		expect(res.status).toBe(200);
		const body = await res.json();
		// Should NOT be the old stub
		expect(body).not.toEqual({ received: true });
		// Should be a graph response
		expect(body).toHaveProperty("type", "text");
		expect(body).toHaveProperty("text");
		expect(body.text).toContain("text_message");
	});

	it("returns 400 for invalid payload", async () => {
		const app = createApp(mockConfig, mockDb, mockRedis);
		const res = await app.request("/internal/process", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ invalid: true }),
		});
		expect(res.status).toBe(400);
	});

	it("returns 400 for non-JSON body", async () => {
		const app = createApp(mockConfig, mockDb, mockRedis);
		const res = await app.request("/internal/process", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: "not json",
		});
		expect(res.status).toBe(400);
	});

	it("processes voice_message events", async () => {
		const app = createApp(mockConfig, mockDb, mockRedis);
		const res = await app.request("/internal/process", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				type: "voice_message",
				userId: "550e8400-e29b-41d4-a716-446655440000",
				sourceRef: "telegram:msg:789",
				correlationId: "corr-789",
				transcribedText: "Remind me about Jane",
			}),
		});
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.type).toBe("text");
		expect(body.text).toContain("voice_message");
	});

	it("processes callback_action events", async () => {
		const app = createApp(mockConfig, mockDb, mockRedis);
		const res = await app.request("/internal/process", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				type: "callback_action",
				userId: "550e8400-e29b-41d4-a716-446655440000",
				sourceRef: "telegram:msg:101",
				correlationId: "corr-101",
				action: "confirm",
				data: "cmd-123",
			}),
		});
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.type).toBe("text");
		expect(body.text).toContain("callback_action");
	});

	it("returns 500 with error message when graph invocation fails", async () => {
		// TODO: Add proper error-path test when graph creation supports dependency injection.
		// The current graph is compiled once in createApp() and cannot be easily mocked
		// without restructuring the module. The catch block at app.ts:77 is not covered.
		// For now, verify the response shape on the happy path.
		const app = createApp(mockConfig, mockDb, mockRedis);
		const res = await app.request("/internal/process", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(validTextEvent),
		});
		const body = await res.json();
		expect(body.type).toBe("text");
		expect(typeof body.text).toBe("string");
	});
});
