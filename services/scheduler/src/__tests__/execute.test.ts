import { signServiceToken } from "@monica-companion/auth";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../app";
import type { Config } from "../config";

const JWT_SECRET = "test-secret-256-bit-minimum-key!";

const testConfig: Config = {
	port: 3005,
	databaseUrl: "postgresql://test:test@localhost:5432/test",
	redisUrl: "redis://localhost:6379",
	auth: { serviceName: "scheduler", jwtSecrets: [JWT_SECRET] },
	monicaIntegrationUrl: "http://localhost:3004",
	deliveryUrl: "http://localhost:3006",
	userManagementUrl: "http://localhost:3007",
	maxRetries: 3,
	retryBackoffMs: 1000,
	catchUpWindowHours: 6,
	reminderPollIntervalMs: 60_000,
	httpTimeoutMs: 10_000,
};

const validPayload = {
	pendingCommandId: "550e8400-e29b-41d4-a716-446655440000",
	userId: "660e8400-e29b-41d4-a716-446655440001",
	commandType: "create_contact",
	payload: {
		type: "create_contact",
		firstName: "Jane",
		genderId: 1,
	},
	idempotencyKey: "550e8400-e29b-41d4-a716-446655440000:v1",
	correlationId: "corr-123",
	confirmedAt: new Date().toISOString(),
};

async function signToken(issuer: string, audience = "scheduler") {
	return signServiceToken({
		issuer: issuer as Parameters<typeof signServiceToken>[0]["issuer"],
		audience: audience as Parameters<typeof signServiceToken>[0]["audience"],
		secret: JWT_SECRET,
	});
}

function createMockDeps() {
	return {
		idempotencyStore: {
			check: vi.fn().mockResolvedValue(null),
			claim: vi.fn().mockResolvedValue({ claimed: true }),
			complete: vi.fn(),
			release: vi.fn(),
		},
		db: {
			insert: vi.fn().mockReturnValue({
				values: vi.fn().mockReturnValue({
					returning: vi.fn().mockResolvedValue([{ id: "exec-id-1" }]),
				}),
			}),
		},
		commandQueue: {
			add: vi.fn().mockResolvedValue({ id: "job-1" }),
		},
	};
}

describe("POST /internal/execute", () => {
	it("returns 401 without auth", async () => {
		const deps = createMockDeps();
		const app = createApp(testConfig, deps as never);
		const res = await app.request("/internal/execute", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(validPayload),
		});
		expect(res.status).toBe(401);
	});

	it("returns 403 for non-ai-router caller", async () => {
		const deps = createMockDeps();
		const app = createApp(testConfig, deps as never);
		const token = await signToken("telegram-bridge");
		const res = await app.request("/internal/execute", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${token}`,
			},
			body: JSON.stringify(validPayload),
		});
		expect(res.status).toBe(403);
	});

	it("returns 400 for invalid payload", async () => {
		const deps = createMockDeps();
		const app = createApp(testConfig, deps as never);
		const token = await signToken("ai-router");
		const res = await app.request("/internal/execute", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${token}`,
			},
			body: JSON.stringify({ invalid: "body" }),
		});
		expect(res.status).toBe(400);
	});

	it("returns 202 for valid payload", async () => {
		const deps = createMockDeps();
		const app = createApp(testConfig, deps as never);
		const token = await signToken("ai-router");
		const res = await app.request("/internal/execute", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${token}`,
			},
			body: JSON.stringify(validPayload),
		});
		expect(res.status).toBe(202);
		const body = await res.json();
		expect(body.executionId).toBeDefined();
	});

	it("returns 200 with existing result for completed idempotency key", async () => {
		const deps = createMockDeps();
		deps.idempotencyStore.check.mockResolvedValue({
			status: "completed",
			result: { contactId: 42 },
		});
		const app = createApp(testConfig, deps as never);
		const token = await signToken("ai-router");
		const res = await app.request("/internal/execute", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${token}`,
			},
			body: JSON.stringify(validPayload),
		});
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.result).toEqual({ contactId: 42 });
	});

	it("returns 409 for in_progress idempotency key", async () => {
		const deps = createMockDeps();
		deps.idempotencyStore.check.mockResolvedValue({ status: "in_progress" });
		const app = createApp(testConfig, deps as never);
		const token = await signToken("ai-router");
		const res = await app.request("/internal/execute", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${token}`,
			},
			body: JSON.stringify(validPayload),
		});
		expect(res.status).toBe(409);
	});
});
