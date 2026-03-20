import { signServiceToken } from "@monica-companion/auth";
import { describe, expect, it, vi } from "vitest";

// Mock the purge function
vi.mock("../retention/user-purge.js", () => ({
	purgeUserDeliveryAudits: vi.fn().mockResolvedValue(6),
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

describe("DELETE /internal/users/:userId/data (delivery)", () => {
	it("returns 200 with purge counts from user-management caller", async () => {
		const token = await signServiceToken({
			issuer: "user-management",
			audience: "delivery",
			secret: JWT_SECRET,
		});

		const app = createTestApp();
		const res = await app.request("/internal/users/550e8400-e29b-41d4-a716-446655440000/data", {
			method: "DELETE",
			headers: { Authorization: `Bearer ${token}` },
		});

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.purged).toEqual({ deliveryAudits: 6 });
	});

	it("returns 403 for disallowed caller", async () => {
		const token = await signServiceToken({
			issuer: "scheduler",
			audience: "delivery",
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
