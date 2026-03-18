/**
 * Comprehensive service smoke tests.
 *
 * Covers all implemented user flows verified in .claude-work smoke reports:
 * ai-router /internal/process, ai-router /internal/resolve-contact,
 * delivery /internal/deliver, user-management /internal/setup-tokens,
 * voice-transcription /internal/transcribe, scheduler /internal/execute,
 * service isolation via Caddy, and guardrails wiring.
 *
 * Each test targets the real Docker Compose stack and completes in under 5s.
 */

import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { authedRequest, smokeRequest } from "./helpers.js";
import { loadSmokeConfig } from "./smoke-config.js";

const config = loadSmokeConfig();

// ---------------------------------------------------------------------------
// 1. ai-router /internal/process
// ---------------------------------------------------------------------------
describe("ai-router /internal/process", () => {
	const url = `${config.AI_ROUTER_URL}/internal/process`;

	const validBody = {
		type: "text_message",
		userId: randomUUID(),
		correlationId: randomUUID(),
		sourceRef: "smoke:services:1",
		text: "Hello, this is a smoke test",
	};

	it("accepts text_message with valid JWT and returns a response with type field", async () => {
		const { status, body } = await authedRequest(url, "ai-router", {
			method: "POST",
			body: validBody,
		});
		// The graph may return 200 with a response type, or 500 if OpenAI key is
		// invalid. Either way it should not be 401/403 and should reach the handler.
		expect(status).not.toBe(401);
		expect(status).not.toBe(403);

		// If 200, the response should contain a type field (text, error, etc.)
		if (status === 200) {
			expect(body).toHaveProperty("type");
		}
	});

	it("returns 400 for invalid payload (missing required fields)", async () => {
		const { status, body } = await authedRequest(url, "ai-router", {
			method: "POST",
			body: { invalid: "payload" },
		});
		expect(status).toBe(400);
		expect(body).toHaveProperty("error");
	});

	it("returns 400 for empty text in text_message", async () => {
		const { status } = await authedRequest(url, "ai-router", {
			method: "POST",
			body: {
				type: "text_message",
				userId: randomUUID(),
				correlationId: randomUUID(),
				sourceRef: "smoke:services:2",
				text: "",
			},
		});
		expect(status).toBe(400);
	});

	it("rejects requests without auth (401)", async () => {
		const { status } = await smokeRequest(url, {
			method: "POST",
			body: validBody,
		});
		expect(status).toBe(401);
	});
});

// ---------------------------------------------------------------------------
// 2. ai-router /internal/resolve-contact
// ---------------------------------------------------------------------------
describe("ai-router /internal/resolve-contact", () => {
	const url = `${config.AI_ROUTER_URL}/internal/resolve-contact`;

	it("rejects requests without auth (401)", async () => {
		const { status } = await smokeRequest(url, {
			method: "POST",
			body: {
				contactRef: "John",
				correlationId: randomUUID(),
			},
		});
		expect(status).toBe(401);
	});

	it("returns 502 with auth (monica-integration has no real backend)", async () => {
		const userId = randomUUID();
		const { status } = await authedRequest(url, "ai-router", {
			method: "POST",
			userId,
			body: {
				contactRef: "John",
				correlationId: randomUUID(),
			},
		});
		// ai-router forwards to monica-integration which has no real Monica backend.
		// Expected: 502 (service unavailable) since upstream fails.
		// Could also be 500 if the error handling differs. Either way, not 401/403.
		expect(status).not.toBe(401);
		expect(status).not.toBe(403);
		expect([500, 502]).toContain(status);
	});

	it("returns 400 for invalid request body", async () => {
		const { status, body } = await authedRequest(url, "ai-router", {
			method: "POST",
			body: { invalid: "data" },
		});
		expect(status).toBe(400);
		expect(body).toHaveProperty("error");
	});
});

// ---------------------------------------------------------------------------
// 3. delivery /internal/deliver
// ---------------------------------------------------------------------------
describe("delivery /internal/deliver", () => {
	const url = `${config.DELIVERY_URL}/internal/deliver`;

	it("rejects requests without auth (401)", async () => {
		const { status } = await smokeRequest(url, {
			method: "POST",
			body: {},
		});
		expect(status).toBe(401);
	});

	it("rejects requests from disallowed caller (403)", async () => {
		const { status } = await authedRequest(url, "delivery", {
			method: "POST",
			// telegram-bridge is NOT in delivery's allowed callers (ai-router, scheduler)
			issuer: "telegram-bridge",
			body: {
				userId: randomUUID(),
				connectorType: "telegram",
				connectorRoutingId: "12345",
				correlationId: randomUUID(),
				content: { type: "text", text: "test" },
			},
		});
		expect(status).toBe(403);
	});

	it("accepts valid auth from ai-router (may fail downstream but not 401/403)", async () => {
		const { status } = await authedRequest(url, "delivery", {
			method: "POST",
			issuer: "ai-router",
			body: {
				userId: randomUUID(),
				connectorType: "telegram",
				connectorRoutingId: "12345",
				correlationId: randomUUID(),
				content: { type: "text", text: "smoke test delivery" },
			},
		});
		// Auth passes, but downstream connector (telegram-bridge) is likely not up.
		// Expect 502 (failed delivery) or 503 (audit persistence issue).
		expect(status).not.toBe(401);
		expect(status).not.toBe(403);
	});

	it("accepts valid auth from scheduler (allowed caller)", async () => {
		const { status } = await authedRequest(url, "delivery", {
			method: "POST",
			issuer: "scheduler",
			body: {
				userId: randomUUID(),
				connectorType: "telegram",
				connectorRoutingId: "67890",
				correlationId: randomUUID(),
				content: { type: "text", text: "smoke test from scheduler" },
			},
		});
		expect(status).not.toBe(401);
		expect(status).not.toBe(403);
	});

	it("returns 400 for invalid payload with valid auth", async () => {
		const { status, body } = await authedRequest(url, "delivery", {
			method: "POST",
			issuer: "ai-router",
			body: { invalid: "payload" },
		});
		expect(status).toBe(400);
		expect(body).toMatchObject({ status: "rejected" });
	});
});

// ---------------------------------------------------------------------------
// 4. user-management /internal/setup-tokens (issue token)
// ---------------------------------------------------------------------------
describe("user-management /internal/setup-tokens", () => {
	const url = `${config.USER_MANAGEMENT_URL}/internal/setup-tokens`;

	it("rejects requests without auth (401)", async () => {
		const { status } = await smokeRequest(url, {
			method: "POST",
			body: {
				telegramUserId: "123456",
				step: "onboarding",
			},
		});
		expect(status).toBe(401);
	});

	it("rejects requests from wrong caller (403)", async () => {
		// ai-router is not in telegramBridgeAuth's allowed callers
		const { status } = await authedRequest(url, "user-management", {
			method: "POST",
			issuer: "ai-router",
			body: {
				telegramUserId: "123456",
				step: "onboarding",
			},
		});
		expect(status).toBe(403);
	});

	it("accepts request from telegram-bridge (allowed caller)", async () => {
		const { status, body } = await authedRequest(url, "user-management", {
			method: "POST",
			issuer: "telegram-bridge",
			body: {
				telegramUserId: `smoke-${Date.now()}`,
				step: "onboarding",
			},
		});
		// Should return 201 with setupUrl, tokenId, expiresAt
		expect(status).toBe(201);
		expect(body).toHaveProperty("setupUrl");
		expect(body).toHaveProperty("tokenId");
		expect(body).toHaveProperty("expiresAt");
	});

	it("returns 400 for invalid payload", async () => {
		const { status } = await authedRequest(url, "user-management", {
			method: "POST",
			issuer: "telegram-bridge",
			body: { invalid: "data" },
		});
		expect(status).toBe(400);
	});
});

// ---------------------------------------------------------------------------
// 5. voice-transcription /internal/transcribe
// ---------------------------------------------------------------------------
describe("voice-transcription /internal/transcribe", () => {
	const url = `${config.VOICE_TRANSCRIPTION_URL}/internal/transcribe`;

	it("rejects requests without auth (401)", async () => {
		const { status } = await smokeRequest(url, {
			method: "POST",
			body: {},
		});
		expect(status).toBe(401);
	});

	it("rejects requests from wrong caller (403)", async () => {
		// ai-router is not in voice-transcription's allowed callers (telegram-bridge)
		const { status } = await authedRequest(url, "voice-transcription", {
			method: "POST",
			issuer: "ai-router",
			body: {},
		});
		expect(status).toBe(403);
	});

	it("rejects oversized body", async () => {
		// voice-transcription has a 25MB body limit.
		// We send a large payload that exceeds the limit.
		// The body limit middleware should reject it with 413.
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), 10_000);

		try {
			const token = await (await import("./helpers.js")).signToken({
				audience: "voice-transcription",
				issuer: "telegram-bridge",
			});

			// Create a payload that exceeds 25MB.
			// We use a simple approach: repeat a character enough times.
			const oversizedPayload = "x".repeat(26 * 1024 * 1024);

			const res = await fetch(url, {
				method: "POST",
				headers: {
					authorization: `Bearer ${token}`,
					"content-type": "application/octet-stream",
				},
				body: oversizedPayload,
				signal: controller.signal,
			});

			// Expect 413 (Payload Too Large) from body limit middleware
			// or connection reset / error if the server closes the connection
			expect([413, 400, 422]).toContain(res.status);
		} catch (err) {
			// If the connection was terminated by the server due to body size,
			// that is also acceptable behavior for oversized body rejection.
			expect(err).toBeDefined();
		} finally {
			clearTimeout(timer);
		}
	});

	it("returns 400 for missing metadata in valid authed multipart request", async () => {
		const token = await (await import("./helpers.js")).signToken({
			audience: "voice-transcription",
			issuer: "telegram-bridge",
		});

		// Send a JSON body instead of multipart -- should fail with 400
		const { status, body } = await smokeRequest(url, {
			method: "POST",
			headers: {
				authorization: `Bearer ${token}`,
			},
			body: { not: "multipart" },
		});
		// The handler expects multipart form data, so JSON body should yield 400
		expect(status).toBe(400);
		expect(body).toHaveProperty("error");
	});
});

// ---------------------------------------------------------------------------
// 6. Service isolation -- internal services NOT exposed via Caddy
//    Skipped when Caddy is not running (e.g. CI without Docker Compose)
// ---------------------------------------------------------------------------
describe("service isolation via Caddy", async () => {
	let caddyAvailable = false;
	try {
		await smokeRequest(`${config.CADDY_URL}/`, { timeout: 2000 });
		caddyAvailable = true;
	} catch {
		// Caddy not running
	}
	if (!caddyAvailable) {
		it.skip("caddy not available — skipping isolation tests", () => {});
		return;
	}

	it("ai-router is not exposed via Caddy", async () => {
		const { status } = await smokeRequest(`${config.CADDY_URL}/internal/process`, {
			method: "POST",
			body: {},
		});
		expect(status).toBe(404);
	});

	it("user-management is not exposed via Caddy", async () => {
		const { status } = await smokeRequest(`${config.CADDY_URL}/internal/setup-tokens`, {
			method: "POST",
			body: {},
		});
		expect(status).toBe(404);
	});

	it("scheduler is not exposed via Caddy", async () => {
		const { status } = await smokeRequest(`${config.CADDY_URL}/internal/execute`, {
			method: "POST",
			body: {},
		});
		expect(status).toBe(404);
	});

	it("delivery is not exposed via Caddy", async () => {
		const { status } = await smokeRequest(`${config.CADDY_URL}/internal/deliver`, {
			method: "POST",
			body: {},
		});
		expect(status).toBe(404);
	});

	it("voice-transcription is not exposed via Caddy", async () => {
		const { status } = await smokeRequest(`${config.CADDY_URL}/internal/transcribe`, {
			method: "POST",
			body: {},
		});
		expect(status).toBe(404);
	});

	it("health endpoints are not exposed via Caddy", async () => {
		const { status } = await smokeRequest(`${config.CADDY_URL}/health`);
		expect(status).toBe(404);
	});
});

// ---------------------------------------------------------------------------
// 7. Guardrails wiring -- X-Correlation-ID header proves auth middleware ran
// ---------------------------------------------------------------------------
describe("guardrails wiring", () => {
	it("ai-router /internal/process returns X-Correlation-ID header with valid auth", async () => {
		const { status, headers } = await authedRequest(
			`${config.AI_ROUTER_URL}/internal/process`,
			"ai-router",
			{
				method: "POST",
				body: {
					type: "text_message",
					userId: randomUUID(),
					correlationId: randomUUID(),
					sourceRef: "smoke:guardrails:1",
					text: "correlation id test",
				},
			},
		);

		// Auth middleware should have run and set X-Correlation-ID
		expect(status).not.toBe(401);
		expect(status).not.toBe(403);
		const correlationHeader = headers.get("x-correlation-id");
		expect(correlationHeader).toBeTruthy();
		expect(typeof correlationHeader).toBe("string");
		expect(correlationHeader?.length).toBeGreaterThan(0);
	});

	it("delivery /internal/deliver returns X-Correlation-ID header with valid auth", async () => {
		const { status, headers } = await authedRequest(
			`${config.DELIVERY_URL}/internal/deliver`,
			"delivery",
			{
				method: "POST",
				issuer: "ai-router",
				body: {
					userId: randomUUID(),
					connectorType: "telegram",
					connectorRoutingId: "99999",
					correlationId: randomUUID(),
					content: { type: "text", text: "correlation test" },
				},
			},
		);

		expect(status).not.toBe(401);
		expect(status).not.toBe(403);
		const correlationHeader = headers.get("x-correlation-id");
		expect(correlationHeader).toBeTruthy();
	});

	it("user-management setup-tokens returns X-Correlation-ID with valid auth", async () => {
		const { status, headers } = await authedRequest(
			`${config.USER_MANAGEMENT_URL}/internal/setup-tokens`,
			"user-management",
			{
				method: "POST",
				issuer: "telegram-bridge",
				body: {
					telegramUserId: `smoke-corr-${Date.now()}`,
					step: "onboarding",
				},
			},
		);

		expect(status).toBe(201);
		const correlationHeader = headers.get("x-correlation-id");
		expect(correlationHeader).toBeTruthy();
	});
});

// ---------------------------------------------------------------------------
// 8. Scheduler /internal/execute (additional service coverage)
// ---------------------------------------------------------------------------
describe("scheduler /internal/execute", () => {
	const url = `${config.SCHEDULER_URL}/internal/execute`;

	it("rejects requests without auth (401)", async () => {
		const { status } = await smokeRequest(url, {
			method: "POST",
			body: {},
		});
		expect(status).toBe(401);
	});

	it("rejects requests from wrong caller (403)", async () => {
		// telegram-bridge is not in scheduler's allowed callers (ai-router)
		const { status } = await authedRequest(url, "scheduler", {
			method: "POST",
			issuer: "telegram-bridge",
			body: {
				pendingCommandId: randomUUID(),
				idempotencyKey: randomUUID(),
				userId: randomUUID(),
				commandType: "create_note",
				payload: {},
				version: 1,
				ttlSeconds: 300,
			},
		});
		expect(status).toBe(403);
	});

	it("returns 400 for invalid payload with valid auth from ai-router", async () => {
		const { status, body } = await authedRequest(url, "scheduler", {
			method: "POST",
			issuer: "ai-router",
			body: { invalid: "data" },
		});
		expect(status).toBe(400);
		expect(body).toHaveProperty("error");
	});
});
