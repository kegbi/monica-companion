import { beforeEach, describe, expect, it, vi } from "vitest";

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
	openaiApiKey: "sk-test-key-for-process",
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
	commandPayload: { body: "our lunch" },
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

	it("processes voice_message events", async () => {
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
		expect(body.type).toBe("text");
		expect(body.text).toBe("I'll create a note for Jane.");
	});

	it("processes callback_action events without calling LLM", async () => {
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
		expect(body.text).toContain("confirm");
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
