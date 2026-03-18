/**
 * Service auth smoke tests.
 *
 * Verifies that internal endpoints enforce JWT auth correctly:
 * - No token → 401
 * - Invalid token → 401
 * - Wrong audience → 401
 * - Wrong caller → 403
 * - Valid token → not 401/403
 */

import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { authedRequest, signToken, smokeRequest } from "./helpers.js";
import { loadSmokeConfig } from "./smoke-config.js";

const config = loadSmokeConfig();

describe("service auth enforcement", () => {
	const processUrl = `${config.AI_ROUTER_URL}/internal/process`;
	const validBody = {
		type: "text_message",
		userId: randomUUID(),
		correlationId: randomUUID(),
		sourceRef: "smoke:test:1",
		text: "smoke test",
	};

	it("rejects requests without Authorization header (401)", async () => {
		const { status, body } = await smokeRequest(processUrl, {
			method: "POST",
			body: validBody,
		});
		expect(status).toBe(401);
		expect(body).toHaveProperty("error");
	});

	it("rejects requests with invalid JWT (401)", async () => {
		const { status } = await smokeRequest(processUrl, {
			method: "POST",
			headers: { authorization: "Bearer invalid.jwt.token" },
			body: validBody,
		});
		expect(status).toBe(401);
	});

	it("rejects requests with wrong audience (401)", async () => {
		const token = await signToken({ audience: "delivery" });
		const { status } = await smokeRequest(processUrl, {
			method: "POST",
			headers: { authorization: `Bearer ${token}` },
			body: validBody,
		});
		expect(status).toBe(401);
	});

	it("rejects requests from unauthorized caller (403)", async () => {
		const token = await signToken({
			audience: "ai-router",
			issuer: "scheduler",
		});
		const { status } = await smokeRequest(processUrl, {
			method: "POST",
			headers: { authorization: `Bearer ${token}` },
			body: validBody,
		});
		expect(status).toBe(403);
	});

	it("accepts valid auth and reaches handler (not 401/403)", async () => {
		const { status } = await authedRequest(processUrl, "ai-router", {
			method: "POST",
			body: validBody,
		});
		// Should reach the handler. May be 200, 500 (fake OpenAI key), or 429 (rate limit)
		// but NOT 401 or 403.
		expect(status).not.toBe(401);
		expect(status).not.toBe(403);
	});
});
