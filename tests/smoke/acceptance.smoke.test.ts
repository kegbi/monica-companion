/**
 * Net-new acceptance criteria smoke tests.
 *
 * Only contains verifications NOT already covered by existing smoke test files.
 * Covers health checks for newly-exposed services (telegram-bridge,
 * monica-integration, scheduler) and criteria that lack existing smoke coverage.
 *
 * Existing coverage map (not duplicated here):
 * - health.smoke.test.ts: all 7 Hono services (ai-router, user-management, delivery, voice-transcription, telegram-bridge, monica-integration, scheduler)
 * - auth.smoke.test.ts: JWT enforcement (SE-1, SE-2)
 * - reverse-proxy.smoke.test.ts: Caddy isolation (SE-3, SE-4)
 * - services.smoke.test.ts: endpoint contracts, payload validation, correlation IDs
 * - middleware.smoke.test.ts: auth-before-guardrails ordering
 * - data-governance.smoke.test.ts: retention cleanup, user purge, disconnect
 * - migration.smoke.test.ts: database schema verification
 */

import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { authedRequest, smokeRequest } from "./helpers.js";
import { loadSmokeConfig } from "./smoke-config.js";

const config = loadSmokeConfig();

// ---------------------------------------------------------------------------
// SE-2 + CL-5: Scheduler per-endpoint caller allowlist enforcement
// Verifies that scheduler rejects callers not in its allowlist
// (services.smoke.test.ts covers 401/403 but not all caller combinations)
// ---------------------------------------------------------------------------
describe("scheduler caller allowlist (SE-2, CL-5)", () => {
	it("scheduler /internal/execute rejects delivery as caller (403)", async () => {
		const { status } = await authedRequest(
			`${config.SCHEDULER_URL}/internal/execute`,
			"scheduler",
			{
				method: "POST",
				issuer: "delivery",
				body: {
					pendingCommandId: randomUUID(),
					idempotencyKey: randomUUID(),
					userId: randomUUID(),
					commandType: "create_note",
					payload: {},
					version: 1,
					ttlSeconds: 300,
				},
			},
		);
		expect(status).toBe(403);
	});
});

// ---------------------------------------------------------------------------
// SE-2: monica-integration per-endpoint caller allowlist
// Uses POST /internal/contacts (write route, scheduler-only callers)
// ---------------------------------------------------------------------------
describe("monica-integration caller allowlist (SE-2)", () => {
	it("monica-integration rejects unauthenticated requests (401)", async () => {
		const { status } = await smokeRequest(`${config.MONICA_INTEGRATION_URL}/internal/contacts`, {
			method: "POST",
			body: { firstName: "test", genderId: 1 },
		});
		expect(status).toBe(401);
	});

	it("monica-integration rejects wrong caller (403)", async () => {
		const { status } = await authedRequest(
			`${config.MONICA_INTEGRATION_URL}/internal/contacts`,
			"monica-integration",
			{
				method: "POST",
				issuer: "telegram-bridge",
				body: { firstName: "test", genderId: 1 },
			},
		);
		expect(status).toBe(403);
	});
});

// ---------------------------------------------------------------------------
// SE-2: telegram-bridge per-endpoint caller allowlist
// ---------------------------------------------------------------------------
describe("telegram-bridge auth enforcement (SE-2)", () => {
	it("telegram-bridge /internal/send rejects unauthenticated requests (401)", async () => {
		const { status } = await smokeRequest(`${config.TELEGRAM_BRIDGE_URL}/internal/send`, {
			method: "POST",
			body: {
				chatId: "12345",
				content: { type: "text", text: "test" },
			},
		});
		expect(status).toBe(401);
	});

	it("telegram-bridge /internal/send rejects wrong caller (403)", async () => {
		const { status } = await authedRequest(
			`${config.TELEGRAM_BRIDGE_URL}/internal/send`,
			"telegram-bridge",
			{
				method: "POST",
				issuer: "scheduler",
				body: {
					chatId: "12345",
					content: { type: "text", text: "test" },
				},
			},
		);
		expect(status).toBe(403);
	});
});

// ---------------------------------------------------------------------------
// RE-6: Strict payload validation on newly-exposed services
// (services.smoke.test.ts covers ai-router, delivery, user-management,
//  voice-transcription, and scheduler. This adds monica-integration.)
// Uses POST /internal/contacts with scheduler as allowed caller and
// an invalid body to verify Zod schema rejects it.
// ---------------------------------------------------------------------------
describe("strict payload validation on monica-integration (RE-6)", () => {
	it("monica-integration POST /internal/contacts rejects invalid payload (400)", async () => {
		const { status } = await authedRequest(
			`${config.MONICA_INTEGRATION_URL}/internal/contacts`,
			"monica-integration",
			{
				method: "POST",
				issuer: "scheduler",
				body: { invalid: "data" },
			},
		);
		expect(status).toBe(400);
	});
});

// ---------------------------------------------------------------------------
// OB-1: Correlation ID propagation on newly-exposed services
// (services.smoke.test.ts covers ai-router, delivery, user-management)
// ---------------------------------------------------------------------------
describe("correlation ID propagation on new services (OB-1)", () => {
	it("scheduler returns X-Correlation-ID header", async () => {
		const { headers, status } = await authedRequest(
			`${config.SCHEDULER_URL}/internal/execute`,
			"scheduler",
			{
				method: "POST",
				issuer: "ai-router",
				body: {
					pendingCommandId: randomUUID(),
					idempotencyKey: randomUUID(),
					userId: randomUUID(),
					commandType: "create_note",
					payload: {},
					version: 1,
					ttlSeconds: 300,
				},
			},
		);
		expect(status).not.toBe(401);
		expect(status).not.toBe(403);
		const correlationHeader = headers.get("x-correlation-id");
		expect(correlationHeader).toBeTruthy();
	});

	it("telegram-bridge returns X-Correlation-ID on authenticated requests", async () => {
		const { headers, status } = await authedRequest(
			`${config.TELEGRAM_BRIDGE_URL}/internal/send`,
			"telegram-bridge",
			{
				method: "POST",
				issuer: "delivery",
				body: {
					chatId: "12345",
					content: { type: "text", text: "correlation test" },
				},
			},
		);
		expect(status).not.toBe(401);
		expect(status).not.toBe(403);
		const correlationHeader = headers.get("x-correlation-id");
		expect(correlationHeader).toBeTruthy();
	});
});
