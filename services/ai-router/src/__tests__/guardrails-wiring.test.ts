import { describe, expect, it, vi } from "vitest";

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
}));

import { createApp } from "../app.js";

const mockConfig = {
	port: 3002,
	databaseUrl: "postgresql://test",
	pendingCommandTtlMinutes: 30,
	expirySweepIntervalMs: 60000,
	monicaIntegrationUrl: "http://monica-integration:3004",
	openaiApiKey: "sk-test-key-for-guardrails",
	maxConversationTurns: 10,
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
