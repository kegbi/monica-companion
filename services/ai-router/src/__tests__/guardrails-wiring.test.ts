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
		},
	};
});

const { guardrailMiddlewareSpy } = vi.hoisted(() => {
	const guardrailMiddlewareSpy = vi.fn().mockReturnValue(async (_c: any, next: any) => {
		await next();
	});
	return { guardrailMiddlewareSpy };
});

// Mock @langchain/openai to avoid real LLM calls
vi.mock("@langchain/openai", () => ({
	ChatOpenAI: vi.fn().mockImplementation(function (this: any) {
		this.withStructuredOutput = vi.fn().mockReturnValue({ invoke: vi.fn() });
	}),
}));

vi.mock("@monica-companion/guardrails", () => ({
	guardrailMiddleware: guardrailMiddlewareSpy,
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

vi.mock("@monica-companion/auth", () => ({
	serviceAuth: vi.fn().mockReturnValue(async (_c: any, next: any) => {
		await next();
	}),
	createServiceClient: vi.fn().mockReturnValue({ fetch: vi.fn() }),
	loadAuthConfig: vi
		.fn()
		.mockReturnValue({ serviceName: "ai-router", jwtSecrets: ["test-secret"] }),
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
	openaiApiKey: "sk-test-key-for-guardrails",
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

describe("guardrails wiring in app", () => {
	it("/health endpoint is not affected by guardrails", async () => {
		const app = createApp(mockConfig, mockDb, mockRedis);
		const res = await app.request("/health");
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.status).toBe("ok");
	});

	it("guardrailMiddleware factory is called with correct options", () => {
		createApp(mockConfig, mockDb, mockRedis);
		expect(guardrailMiddlewareSpy).toHaveBeenCalledWith(
			expect.objectContaining({
				redis: mockRedis,
				modelType: "gpt",
				service: "ai-router",
			}),
		);
	});
});
