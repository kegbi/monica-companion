import { beforeEach, describe, expect, it, vi } from "vitest";

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

const mockChatCompletion = vi.fn();
vi.mock("openai", () => ({
	default: class MockOpenAI {
		constructor() {}
		chat = { completions: { create: mockChatCompletion } };
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

// Mock serviceAuth to pass through (for testing agent invocation)
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

// Mock history repository (used by agent loop)
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

const validTextEvent = {
	type: "text_message",
	userId: "550e8400-e29b-41d4-a716-446655440000",
	sourceRef: "telegram:msg:123",
	correlationId: "corr-456",
	text: "Hello bot",
};

describe("POST /internal/process", () => {
	beforeEach(() => {
		mockChatCompletion.mockReset();
	});

	it("returns text response for text_message via agent loop", async () => {
		mockChatCompletion.mockResolvedValueOnce({
			choices: [
				{
					message: { role: "assistant", content: "Hello! How can I help you today?" },
					finish_reason: "stop",
				},
			],
		});
		const app = createApp(mockConfig, mockDb, mockRedis);
		const res = await app.request("/internal/process", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(validTextEvent),
		});
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body).toHaveProperty("type", "text");
		expect(body).toHaveProperty("text", "Hello! How can I help you today?");
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
		mockChatCompletion.mockResolvedValueOnce({
			choices: [
				{
					message: { role: "assistant", content: "I heard your voice message." },
					finish_reason: "stop",
				},
			],
		});
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
		expect(body.text).toBeTruthy();
	});

	it("processes callback_action without pending tool call as text response", async () => {
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
				data: "cmd-123:1",
			}),
		});
		expect(res.status).toBe(200);
		const body = await res.json();
		// Without a pending tool call, callback produces a text response
		expect(body.type).toBe("text");
		expect(body.text).toBeTruthy();
		// LLM should not have been called
		expect(mockChatCompletion).not.toHaveBeenCalled();
	});

	it("returns graceful fallback when LLM fails", async () => {
		mockChatCompletion.mockRejectedValueOnce(new Error("LLM timeout"));
		const app = createApp(mockConfig, mockDb, mockRedis);
		const res = await app.request("/internal/process", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(validTextEvent),
		});
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.type).toBe("error");
		expect(body.text).toBeTruthy();
	});
});
