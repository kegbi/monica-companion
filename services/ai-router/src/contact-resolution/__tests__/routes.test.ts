import { signServiceToken } from "@monica-companion/auth";
import { describe, expect, it, vi } from "vitest";

// Mock observability before importing app
vi.mock("@monica-companion/observability", () => ({
	otelMiddleware: () => async (c: unknown, next: () => Promise<void>) => {
		await next();
	},
	createLogger: () => ({
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	}),
}));

// Mock openai SDK for agent loop
vi.mock("openai", () => ({
	default: class MockOpenAI {
		constructor() {}
		chat = { completions: { create: vi.fn() } };
	},
}));

// Mock history repository
vi.mock("../../agent/history-repository.js", () => ({
	getHistory: vi.fn().mockResolvedValue(null),
	saveHistory: vi.fn().mockResolvedValue(undefined),
	clearHistory: vi.fn().mockResolvedValue(0),
	clearStaleHistories: vi.fn().mockResolvedValue(0),
	SLIDING_WINDOW_SIZE: 40,
}));

// Mock guardrails so middleware passes through without Redis
vi.mock("@monica-companion/guardrails", () => ({
	guardrailMiddleware: () => async (_c: unknown, next: () => Promise<void>) => {
		await next();
	},
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
}));

vi.mock("../../lib/delivery-client.js", () => ({
	createDeliveryClient: vi.fn().mockReturnValue({
		deliver: vi.fn().mockResolvedValue({ deliveryId: "del-1", status: "delivered" }),
	}),
}));

vi.mock("../../lib/scheduler-client.js", () => ({
	createSchedulerClient: vi.fn().mockReturnValue({
		execute: vi.fn().mockResolvedValue({ executionId: "exec-1", status: "queued" }),
	}),
}));

vi.mock("../../lib/user-management-client.js", () => ({
	createUserManagementClient: vi.fn().mockReturnValue({
		getDeliveryRouting: vi
			.fn()
			.mockResolvedValue({ connectorType: "telegram", connectorRoutingId: "chat-1" }),
		getPreferences: vi
			.fn()
			.mockResolvedValue({ language: "en", confirmationMode: "explicit", timezone: "UTC" }),
	}),
}));

import { createApp } from "../../app.js";
import type { Config } from "../../config.js";
import type { Database } from "../../db/connection.js";
import { ContactResolutionClientError } from "../client.js";

// Mock the resolver module
vi.mock("../resolver.js", () => ({
	resolveContact: vi.fn(),
	RESOLVED_THRESHOLD: 0.9,
	AMBIGUITY_GAP_THRESHOLD: 0.1,
	MINIMUM_MATCH_THRESHOLD: 0.6,
	MAX_DISAMBIGUATION_CANDIDATES: 5,
}));

import { resolveContact } from "../resolver.js";

const mockResolve = vi.mocked(resolveContact);

const testConfig: Config = {
	port: 3002,
	databaseUrl: "postgresql://test:test@localhost:5432/test",
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
		serviceName: "ai-router",
		jwtSecrets: ["test-secret-that-is-long-enough-for-hs256"],
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

const testDb = {} as Database;
const testRedis = {} as any;

async function makeAuthToken(
	overrides: { issuer?: string; subject?: string; correlationId?: string } = {},
): Promise<string> {
	return signServiceToken({
		issuer: overrides.issuer ?? "telegram-bridge",
		audience: "ai-router",
		secret: "test-secret-that-is-long-enough-for-hs256",
		subject: overrides.subject ?? "user-123",
		correlationId: overrides.correlationId ?? "corr-test",
	});
}

describe("POST /internal/resolve-contact", () => {
	it("returns 200 with ContactResolutionResult for valid request", async () => {
		const app = createApp(testConfig, testDb, testRedis);
		mockResolve.mockResolvedValue({
			outcome: "resolved",
			resolved: {
				contactId: 42,
				displayName: "John Doe",
				aliases: ["John", "Doe"],
				relationshipLabels: [],
				importantDates: [],
				lastInteractionAt: null,
			},
			candidates: [],
			query: "John Doe",
		});

		const token = await makeAuthToken();
		const res = await app.request("/internal/resolve-contact", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				contactRef: "John Doe",
				correlationId: "corr-test",
			}),
		});

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.outcome).toBe("resolved");
		expect(body.resolved.contactId).toBe(42);
		expect(body.query).toBe("John Doe");
	});

	it("returns 400 for invalid request body", async () => {
		const app = createApp(testConfig, testDb, testRedis);
		const token = await makeAuthToken();

		const res = await app.request("/internal/resolve-contact", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ invalid: true }),
		});

		expect(res.status).toBe(400);
	});

	it("returns 400 for empty contactRef", async () => {
		const app = createApp(testConfig, testDb, testRedis);
		const token = await makeAuthToken();

		const res = await app.request("/internal/resolve-contact", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				contactRef: "",
				correlationId: "corr-test",
			}),
		});

		expect(res.status).toBe(400);
	});

	it("returns 502 when monica-integration is unavailable", async () => {
		const app = createApp(testConfig, testDb, testRedis);
		mockResolve.mockRejectedValue(
			new ContactResolutionClientError("monica-integration returned status 502"),
		);

		const token = await makeAuthToken();
		const res = await app.request("/internal/resolve-contact", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				contactRef: "John",
				correlationId: "corr-test",
			}),
		});

		expect(res.status).toBe(502);
		const body = await res.json();
		expect(body.error).toBe("Contact resolution service unavailable");
	});

	it("returns 401 for missing auth token", async () => {
		const app = createApp(testConfig, testDb, testRedis);

		const res = await app.request("/internal/resolve-contact", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				contactRef: "John",
				correlationId: "corr-test",
			}),
		});

		expect(res.status).toBe(401);
	});
});
