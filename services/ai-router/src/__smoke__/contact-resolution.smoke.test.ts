/**
 * Contact resolution smoke tests.
 *
 * Verifies the real network path for contact resolution:
 * - ai-router can create a ServiceClient for monica-integration
 * - The resolveContactRef graph node runs without crashing
 * - Graceful degradation when monica-integration cannot reach a real Monica instance
 *
 * Prerequisites:
 * - ai-router, monica-integration, user-management, postgres, redis running
 * - LLM_API_KEY and JWT_SECRET set in environment
 *
 * Run: pnpm vitest run src/__smoke__/contact-resolution.smoke.test.ts
 */

import { randomUUID } from "node:crypto";
import { signServiceToken } from "@monica-companion/auth";
import { describe, expect, it } from "vitest";
import { loadLlmSmokeConfig } from "./smoke-config.js";

const TIMEOUT_MS = 45_000;

async function signToken(userId: string): Promise<string> {
	const config = loadLlmSmokeConfig();
	return signServiceToken({
		issuer: "telegram-bridge",
		audience: "ai-router",
		secret: config.JWT_SECRET,
		subject: userId,
		ttlSeconds: 60,
	});
}

describe("Contact resolution smoke tests", () => {
	const userId = randomUUID();

	it(
		"POST /internal/process with contact reference does not return 500",
		async () => {
			const config = loadLlmSmokeConfig();
			const token = await signToken(userId);
			const correlationId = randomUUID();

			const controller = new AbortController();
			const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

			try {
				const res = await fetch(`${config.AI_ROUTER_URL}/internal/process`, {
					method: "POST",
					headers: {
						"content-type": "application/json",
						authorization: `Bearer ${token}`,
					},
					body: JSON.stringify({
						type: "text_message",
						userId,
						sourceRef: `smoke:cr:${correlationId}`,
						correlationId,
						text: "Add a note to John about the meeting",
					}),
					signal: controller.signal,
				});

				const body = (await res.json()) as Record<string, unknown>;

				// The key assertion: the system does not crash (no 500).
				// The response may be text, clarification, disambiguation, or error
				// depending on whether Monica data is available, but it must not be 500.
				expect(res.status).not.toBe(500);
				expect(body.type).toBeDefined();
				expect(["text", "confirmation_prompt", "disambiguation_prompt", "error"]).toContain(
					body.type,
				);
			} finally {
				clearTimeout(timer);
			}
		},
		TIMEOUT_MS + 5_000,
	);

	it(
		"POST /internal/resolve-contact returns valid response shape",
		async () => {
			const config = loadLlmSmokeConfig();
			const token = await signToken(userId);
			const correlationId = randomUUID();

			const controller = new AbortController();
			const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

			try {
				const res = await fetch(`${config.AI_ROUTER_URL}/internal/resolve-contact`, {
					method: "POST",
					headers: {
						"content-type": "application/json",
						authorization: `Bearer ${token}`,
					},
					body: JSON.stringify({
						contactRef: "John",
						correlationId,
					}),
					signal: controller.signal,
				});

				// May return 200 (with no_match if no real Monica) or 502 (if monica-integration unreachable)
				// Both are acceptable graceful outcomes. 500 is not acceptable.
				expect(res.status).not.toBe(500);

				if (res.status === 200) {
					const body = (await res.json()) as Record<string, unknown>;
					expect(body.outcome).toBeDefined();
					expect(["resolved", "ambiguous", "no_match"]).toContain(body.outcome);
					expect(body.query).toBe("John");
				}
			} finally {
				clearTimeout(timer);
			}
		},
		TIMEOUT_MS + 5_000,
	);
});
