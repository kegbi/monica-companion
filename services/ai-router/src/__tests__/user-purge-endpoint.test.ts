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

// Mock the purge functions
vi.mock("../retention/user-purge.js", () => ({
	purgeUserConversationTurns: vi.fn().mockResolvedValue(10),
	purgeUserPendingCommands: vi.fn().mockResolvedValue(3),
}));

import { userPurgeRoutes } from "../retention/user-purge-routes.js";

const JWT_SECRET = "test-secret-256-bit-minimum-key!";

function createTestApp() {
	const { Hono } = require("hono");
	const app = new Hono();
	const config = { auth: { jwtSecrets: [JWT_SECRET] } };
	app.route("/internal", userPurgeRoutes(config as never, {} as never));
	return app;
}

describe("DELETE /internal/users/:userId/data (ai-router)", () => {
	it("returns 200 with purge counts from user-management caller", async () => {
		const token = await signServiceToken({
			issuer: "user-management",
			audience: "ai-router",
			secret: JWT_SECRET,
		});

		const app = createTestApp();
		const res = await app.request("/internal/users/550e8400-e29b-41d4-a716-446655440000/data", {
			method: "DELETE",
			headers: { Authorization: `Bearer ${token}` },
		});

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.purged).toEqual({
			conversationTurns: 10,
			pendingCommands: 3,
		});
	});

	it("returns 403 for disallowed caller", async () => {
		const token = await signServiceToken({
			issuer: "scheduler",
			audience: "ai-router",
			secret: JWT_SECRET,
		});

		const app = createTestApp();
		const res = await app.request("/internal/users/550e8400-e29b-41d4-a716-446655440000/data", {
			method: "DELETE",
			headers: { Authorization: `Bearer ${token}` },
		});

		expect(res.status).toBe(403);
	});

	it("returns 400 for invalid userId", async () => {
		const token = await signServiceToken({
			issuer: "user-management",
			audience: "ai-router",
			secret: JWT_SECRET,
		});

		const app = createTestApp();
		const res = await app.request("/internal/users/not-a-uuid/data", {
			method: "DELETE",
			headers: { Authorization: `Bearer ${token}` },
		});

		expect(res.status).toBe(400);
	});
});
