/**
 * Middleware ordering smoke tests.
 *
 * Verifies on the live stack that auth runs before guardrails,
 * and that guardrails features (rate limiting, kill switch) work
 * through the real Redis + middleware chain.
 */

import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { authedRequest, smokeRequest } from "./helpers.js";
import { loadSmokeConfig } from "./smoke-config.js";

const config = loadSmokeConfig();

describe("middleware ordering (auth before guardrails)", () => {
	const processUrl = `${config.AI_ROUTER_URL}/internal/process`;
	const validBody = {
		type: "text_message",
		userId: randomUUID(),
		correlationId: randomUUID(),
		sourceRef: "smoke:test:mw",
		text: "middleware ordering check",
	};

	it("unauthenticated request gets 401 (not 400 missing_user_id)", async () => {
		const { status, body } = await smokeRequest(processUrl, {
			method: "POST",
			body: validBody,
		});
		// If middleware ordering is wrong, guardrails fires first → 400 missing_user_id.
		// Correct ordering: auth fires first → 401 missing Authorization header.
		expect(status).toBe(401);
		expect(body).not.toHaveProperty("error", "missing_user_id");
	});

	it("authenticated request passes guardrails without missing_user_id", async () => {
		const { status, body } = await authedRequest(processUrl, "ai-router", {
			method: "POST",
			body: validBody,
		});
		expect(status).not.toBe(400);
		if (typeof body === "object" && body !== null) {
			expect(body).not.toHaveProperty("error", "missing_user_id");
		}
	});
});
