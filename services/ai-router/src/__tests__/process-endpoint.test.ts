import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@opentelemetry/api", () => ({
	trace: {
		getTracer: () => ({
			startActiveSpan: (_name: string, fn: (span: unknown) => unknown) =>
				fn({ setAttribute: () => {}, end: () => {} }),
		}),
	},
}));

const mockLlmInvoke = vi.fn();

// Mock @langchain/openai to avoid real LLM calls
vi.mock("@langchain/openai", () => ({
	ChatOpenAI: vi.fn().mockImplementation(function (this: any) {
		this.withStructuredOutput = vi.fn().mockReturnValue({ invoke: mockLlmInvoke });
	}),
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

// Mock serviceAuth to pass through (for testing graph invocation)
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

vi.mock("../db/turn-repository.js", () => ({
	getRecentTurns: vi.fn().mockResolvedValue([]),
	insertTurnSummary: vi.fn().mockResolvedValue({}),
}));

vi.mock("../pending-command/repository.js", () => ({
	getActivePendingCommandForUser: vi.fn().mockResolvedValue(null),
	updateDraftPayload: vi.fn().mockResolvedValue(null),
	createPendingCommand: vi.fn().mockResolvedValue({
		id: "cmd-mock",
		userId: "test",
		commandType: "create_note",
		payload: { type: "create_note", body: "test" },
		status: "draft",
		version: 1,
		sourceMessageRef: "tg:msg:1",
		correlationId: "corr-1",
		expiresAt: new Date(),
		confirmedAt: null,
		executedAt: null,
		terminalAt: null,
		executionResult: null,
		createdAt: new Date(),
		updatedAt: new Date(),
	}),
	transitionStatus: vi.fn().mockResolvedValue({
		id: "cmd-mock",
		status: "pending_confirmation",
		version: 2,
		commandType: "create_note",
	}),
	getPendingCommand: vi.fn().mockResolvedValue(null),
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

import { createApp } from "../app.js";

const mockConfig = {
	port: 3002,
	databaseUrl: "postgresql://test",
	pendingCommandTtlMinutes: 30,
	expirySweepIntervalMs: 60000,
	monicaIntegrationUrl: "http://monica-integration:3004",
	deliveryUrl: "http://delivery:3006",
	schedulerUrl: "http://scheduler:3005",
	userManagementUrl: "http://user-management:3007",
	openaiApiKey: "sk-test-key-for-process",
	maxConversationTurns: 10,
	autoConfirmConfidenceThreshold: 0.95,
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

const greetingResult = {
	intent: "greeting",
	detectedLanguage: "en",
	userFacingText: "Hello! How can I help you today?",
	commandType: null,
	contactRef: null,
	commandPayload: null,
	confidence: 0.99,
};

const mutatingResult = {
	intent: "mutating_command",
	detectedLanguage: "en",
	userFacingText: "I'll create a note for Jane.",
	commandType: "create_note",
	contactRef: "Jane",
	commandPayload: { contactId: 42, body: "our lunch" },
	confidence: 0.95,
};

describe("POST /internal/process", () => {
	beforeEach(() => {
		mockLlmInvoke.mockReset();
	});

	it("returns classified graph response for text_message", async () => {
		mockLlmInvoke.mockResolvedValueOnce(greetingResult);
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

	it("processes voice_message events with mutating result as confirmation_prompt", async () => {
		mockLlmInvoke.mockResolvedValueOnce(mutatingResult);
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
		// Mutating commands now produce confirmation_prompt (not text)
		expect(body.type).toBe("confirmation_prompt");
		expect(body.text).toBe("I'll create a note for Jane.");
		expect(body.pendingCommandId).toBeDefined();
	});

	it("processes callback_action without active pending command as stale rejection", async () => {
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
		// Without an active pending command, callback produces a stale rejection
		expect(body.type).toBe("error");
		expect(body.text).toBeTruthy();
		// LLM should not have been called
		expect(mockLlmInvoke).not.toHaveBeenCalled();
	});

	it("returns graceful fallback when LLM fails", async () => {
		mockLlmInvoke.mockRejectedValueOnce(new Error("LLM timeout"));
		const app = createApp(mockConfig, mockDb, mockRedis);
		const res = await app.request("/internal/process", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(validTextEvent),
		});
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.type).toBe("text");
		// Should get a graceful fallback, not a 500
		expect(body.text).toBeTruthy();
	});
});
