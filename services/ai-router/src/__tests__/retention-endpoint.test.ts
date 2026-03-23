import { signServiceToken } from "@monica-companion/auth";
import { describe, expect, it, vi } from "vitest";

// Mock guardrails to pass through
vi.mock("@monica-companion/guardrails", () => ({
	guardrailMiddleware: vi.fn().mockReturnValue(async (_c: unknown, next: () => Promise<void>) => {
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
}));

// Mock the cleanup functions
vi.mock("../retention/cleanup.js", () => ({
	purgeExpiredConversationTurns: vi.fn().mockResolvedValue(5),
	purgeExpiredPendingCommands: vi.fn().mockResolvedValue(3),
	purgeExpiredConversationHistory: vi.fn().mockResolvedValue(2),
}));

import { retentionRoutes } from "../retention/routes.js";

const JWT_SECRET = "test-secret-256-bit-minimum-key!";

function createTestApp() {
	const { Hono } = require("hono");
	const app = new Hono();

	const config = {
		auth: { jwtSecrets: [JWT_SECRET] },
	};

	app.route("/internal", retentionRoutes(config as never, {} as never));
	return app;
}

describe("POST /internal/retention-cleanup (ai-router)", () => {
	it("returns 200 with purge counts for valid payload from scheduler", async () => {
		const token = await signServiceToken({
			issuer: "scheduler",
			audience: "ai-router",
			secret: JWT_SECRET,
		});

		const app = createTestApp();
		const res = await app.request("/internal/retention-cleanup", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				conversationTurnsCutoff: "2024-01-01T00:00:00.000Z",
				pendingCommandsCutoff: "2024-01-15T00:00:00.000Z",
			}),
		});

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.purged).toEqual({
			conversationTurns: 5,
			pendingCommands: 3,
			conversationHistory: 2,
		});
	});

	it("returns 400 for invalid payload", async () => {
		const token = await signServiceToken({
			issuer: "scheduler",
			audience: "ai-router",
			secret: JWT_SECRET,
		});

		const app = createTestApp();
		const res = await app.request("/internal/retention-cleanup", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ invalid: true }),
		});

		expect(res.status).toBe(400);
	});

	it("returns 401 without auth", async () => {
		const app = createTestApp();
		const res = await app.request("/internal/retention-cleanup", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				conversationTurnsCutoff: "2024-01-01T00:00:00.000Z",
				pendingCommandsCutoff: "2024-01-15T00:00:00.000Z",
			}),
		});

		expect(res.status).toBe(401);
	});

	it("returns 403 for disallowed caller", async () => {
		const token = await signServiceToken({
			issuer: "telegram-bridge",
			audience: "ai-router",
			secret: JWT_SECRET,
		});

		const app = createTestApp();
		const res = await app.request("/internal/retention-cleanup", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				conversationTurnsCutoff: "2024-01-01T00:00:00.000Z",
				pendingCommandsCutoff: "2024-01-15T00:00:00.000Z",
			}),
		});

		expect(res.status).toBe(403);
	});
});
