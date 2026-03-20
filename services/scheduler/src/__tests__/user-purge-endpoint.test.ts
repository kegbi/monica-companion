import { signServiceToken } from "@monica-companion/auth";
import { describe, expect, it, vi } from "vitest";

// Mock the purge functions
vi.mock("../retention/user-purge.js", () => ({
	purgeUserCommandExecutionsAndKeys: vi.fn().mockResolvedValue({
		commandExecutions: 5,
		idempotencyKeys: 3,
	}),
	purgeUserReminderWindows: vi.fn().mockResolvedValue(2),
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

describe("DELETE /internal/users/:userId/data (scheduler)", () => {
	it("returns 200 with purge counts from user-management caller", async () => {
		const token = await signServiceToken({
			issuer: "user-management",
			audience: "scheduler",
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
			commandExecutions: 5,
			idempotencyKeys: 3,
			reminderWindows: 2,
		});
	});

	it("returns 403 for disallowed caller", async () => {
		const token = await signServiceToken({
			issuer: "ai-router",
			audience: "scheduler",
			secret: JWT_SECRET,
		});

		const app = createTestApp();
		const res = await app.request("/internal/users/550e8400-e29b-41d4-a716-446655440000/data", {
			method: "DELETE",
			headers: { Authorization: `Bearer ${token}` },
		});

		expect(res.status).toBe(403);
	});
});
