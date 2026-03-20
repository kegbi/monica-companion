import { describe, expect, it, vi } from "vitest";

vi.mock("@opentelemetry/api", () => ({
	trace: {
		getTracer: () => ({
			startActiveSpan: (_name: string, fn: (span: unknown) => unknown) =>
				fn({ setAttribute: () => {}, end: () => {} }),
		}),
	},
}));

/**
 * Middleware ordering test.
 *
 * Verifies that serviceAuth runs BEFORE guardrailMiddleware on /internal/*
 * routes, so that userId is populated in context before guardrails checks it.
 *
 * Unlike other tests that mock both middlewares to pass-through, these tests
 * use behaviour-preserving mocks: serviceAuth sets context vars, and
 * guardrailMiddleware checks that userId is present (matching real behaviour).
 * This catches ordering bugs where guardrails runs before auth.
 */

const executionOrder: string[] = [];

// Mock @langchain/openai to avoid real LLM calls
vi.mock("@langchain/openai", () => ({
	ChatOpenAI: vi.fn().mockImplementation(function (this: any) {
		this.withStructuredOutput = vi.fn().mockReturnValue({
			invoke: vi.fn().mockResolvedValue({
				intent: "greeting",
				detectedLanguage: "en",
				userFacingText: "Hello!",
				commandType: null,
				contactRef: null,
				commandPayload: null,
				confidence: 0.99,
			}),
		});
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
	createPendingCommand: vi
		.fn()
		.mockResolvedValue({ id: "cmd-mock", version: 1, status: "draft", commandType: "create_note" }),
	transitionStatus: vi.fn().mockResolvedValue({
		id: "cmd-mock",
		version: 2,
		status: "pending_confirmation",
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

// serviceAuth mock: sets context vars (matching real behaviour)
vi.mock("@monica-companion/auth", () => ({
	serviceAuth: vi.fn().mockReturnValue(async (c: any, next: any) => {
		executionOrder.push("serviceAuth");
		c.set("serviceCaller", "telegram-bridge");
		c.set("userId", "test-user-id");
		c.set("correlationId", "test-corr-id");
		await next();
	}),
	createServiceClient: vi.fn().mockReturnValue({ fetch: vi.fn() }),
	loadAuthConfig: vi.fn().mockReturnValue({
		serviceName: "ai-router",
		jwtSecrets: ["test-secret"],
	}),
}));

// guardrailMiddleware mock: checks userId presence (matching real behaviour)
vi.mock("@monica-companion/guardrails", () => ({
	guardrailMiddleware: vi.fn().mockReturnValue(async (c: any, next: any) => {
		executionOrder.push("guardrailMiddleware");
		const userId = c.get("userId");
		if (!userId) {
			return c.json(
				{
					error: "missing_user_id",
					message: "Request must include an authenticated user identity.",
				},
				400,
			);
		}
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
	openaiApiKey: "sk-test-key-for-ordering",
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

describe("middleware ordering: auth before guardrails", () => {
	it("serviceAuth runs before guardrailMiddleware on /internal/process", async () => {
		executionOrder.length = 0;
		const app = createApp(mockConfig, mockDb, mockRedis);
		const res = await app.request("/internal/process", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(validTextEvent),
		});

		// The request must not be rejected by missing_user_id
		expect(res.status).not.toBe(400);
		const body = await res.json();
		expect(body.error).not.toBe("missing_user_id");

		// Verify execution order: auth must come first
		expect(executionOrder[0]).toBe("serviceAuth");
		expect(executionOrder[1]).toBe("guardrailMiddleware");
	});

	it("rejects with missing_user_id when auth is bypassed", async () => {
		// Simulate what happens when guardrails runs without auth context
		// by sending a request directly without auth mock setting userId.
		// This test documents the expected guardrails behaviour.
		const { Hono } = await import("hono");
		const { guardrailMiddleware } = await import("@monica-companion/guardrails");
		const testApp = new Hono();
		testApp.use("/guarded/*", guardrailMiddleware({} as any));
		testApp.get("/guarded/test", (c) => c.json({ ok: true }));

		const res = await testApp.request("/guarded/test");
		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.error).toBe("missing_user_id");
	});
});
