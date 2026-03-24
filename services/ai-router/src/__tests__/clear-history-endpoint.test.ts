import { describe, expect, it, vi } from "vitest";

vi.mock("@opentelemetry/api", () => {
	const mockSpan = { setAttribute: () => {}, setStatus: () => {}, end: () => {} };
	return {
		SpanStatusCode: { OK: 0, ERROR: 2 },
		trace: {
			getTracer: () => ({
				startActiveSpan: (_name: string, fn: (span: unknown) => unknown) => fn(mockSpan),
				startSpan: () => mockSpan,
			}),
			getActiveSpan: () => mockSpan,
		},
	};
});

// Mock openai SDK
vi.mock("openai", () => ({
	default: class MockOpenAI {
		constructor() {}
		chat = { completions: { create: vi.fn() } };
	},
}));

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

const { serviceAuthSpy } = vi.hoisted(() => {
	const serviceAuthSpy = vi.fn().mockReturnValue(async (_c: any, next: any) => {
		await next();
	});
	return { serviceAuthSpy };
});

vi.mock("@monica-companion/auth", () => ({
	serviceAuth: serviceAuthSpy,
	createServiceClient: vi.fn().mockReturnValue({
		fetch: vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 })),
	}),
	loadAuthConfig: vi.fn().mockReturnValue({
		serviceName: "ai-router",
		jwtSecrets: ["test-secret"],
	}),
}));

vi.mock("@monica-companion/redaction", () => ({
	redactString: vi.fn().mockImplementation((s: string) => s),
}));

vi.mock("../lib/delivery-client.js", () => ({
	createDeliveryClient: vi.fn().mockReturnValue({
		deliver: vi.fn().mockResolvedValue({ deliveryId: "del-1", status: "delivered" }),
	}),
}));

vi.mock("../lib/scheduler-client.js", () => ({
	createSchedulerClient: vi.fn().mockReturnValue({
		execute: vi.fn().mockResolvedValue({ executionId: "exec-1", status: "queued" }),
	}),
}));

vi.mock("../lib/user-management-client.js", () => ({
	createUserManagementClient: vi.fn().mockReturnValue({
		getDeliveryRouting: vi
			.fn()
			.mockResolvedValue({ connectorType: "telegram", connectorRoutingId: "chat-1" }),
		getPreferences: vi
			.fn()
			.mockResolvedValue({ language: "en", confirmationMode: "explicit", timezone: "UTC" }),
	}),
}));

vi.mock("../agent/history-repository.js", () => ({
	getHistory: vi.fn().mockResolvedValue(null),
	saveHistory: vi.fn().mockResolvedValue(undefined),
	clearHistory: vi.fn().mockResolvedValue(1),
	clearStaleHistories: vi.fn().mockResolvedValue(0),
	SLIDING_WINDOW_SIZE: 40,
}));

import { createApp } from "../app.js";

const mockConfig = {
	port: 3002,
	databaseUrl: "postgresql://test",
	pendingCommandTtlMinutes: 30,
	monicaIntegrationUrl: "http://monica-integration:3004",
	deliveryUrl: "http://delivery:3006",
	schedulerUrl: "http://scheduler:3005",
	userManagementUrl: "http://user-management:3007",
	openaiApiKey: "sk-test-key",
	maxConversationTurns: 10,
	autoConfirmConfidenceThreshold: 0.95,
	llmBaseUrl: "https://openrouter.ai/api/v1",
	llmApiKey: "sk-test-llm-key",
	llmModelId: "qwen/qwen3-235b-a22b",
	historyInactivitySweepIntervalMs: 3600000,
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

describe("POST /internal/clear-history", () => {
	it("returns 200 with cleared: true for valid userId", async () => {
		const app = createApp(mockConfig, mockDb, mockRedis);
		const res = await app.request("/internal/clear-history", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ userId: "550e8400-e29b-41d4-a716-446655440000" }),
		});
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.cleared).toBe(true);
		expect(body.deletedRows).toBe(1);
	});

	it("returns 400 for invalid userId format", async () => {
		const app = createApp(mockConfig, mockDb, mockRedis);
		const res = await app.request("/internal/clear-history", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ userId: "not-a-uuid" }),
		});
		expect(res.status).toBe(400);
	});

	it("returns 400 for missing userId", async () => {
		const app = createApp(mockConfig, mockDb, mockRedis);
		const res = await app.request("/internal/clear-history", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({}),
		});
		expect(res.status).toBe(400);
	});

	it("returns 400 for non-JSON body", async () => {
		const app = createApp(mockConfig, mockDb, mockRedis);
		const res = await app.request("/internal/clear-history", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: "not json",
		});
		expect(res.status).toBe(400);
	});

	it("registers serviceAuth with allowedCallers: telegram-bridge", () => {
		createApp(mockConfig, mockDb, mockRedis);
		// The serviceAuth mock should have been called with telegram-bridge for clear-history
		const clearHistoryCall = serviceAuthSpy.mock.calls.find(
			(call: any[]) =>
				call[0]?.allowedCallers?.includes("telegram-bridge") && call[0]?.audience === "ai-router",
		);
		expect(clearHistoryCall).toBeDefined();
	});
});
