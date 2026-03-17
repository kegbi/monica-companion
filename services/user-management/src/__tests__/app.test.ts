import { randomBytes, randomUUID } from "node:crypto";
import { signServiceToken } from "@monica-companion/auth";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app";
import type { Config } from "../config";
import { computeKeyId, encryptCredential } from "../crypto/credential-cipher";
import { createDb, type Database } from "../db/connection";
import { setupTokenAuditLog, setupTokens } from "../db/schema";

const JWT_SECRET = "test-secret-256-bit-minimum-key!";
const SETUP_TOKEN_SECRET = "test-setup-token-secret-32-bytes!";
const DATABASE_URL =
	process.env.DATABASE_URL ?? "postgresql://monica:monica_dev@localhost:5432/monica_companion";
const MASTER_KEY = randomBytes(32);

const testConfig: Config = {
	port: 3007,
	databaseUrl: DATABASE_URL,
	setupTokenSecret: SETUP_TOKEN_SECRET,
	setupBaseUrl: "http://localhost",
	setupTokenTtlMinutes: 15,
	auth: {
		serviceName: "user-management",
		jwtSecrets: [JWT_SECRET],
	},
	encryptionMasterKey: MASTER_KEY,
	encryptionMasterKeyPrevious: null,
};

let db: Database;

beforeAll(async () => {
	db = createDb(DATABASE_URL);
	await db.execute(sql`
		CREATE TABLE IF NOT EXISTS setup_tokens (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			telegram_user_id TEXT NOT NULL,
			step TEXT NOT NULL DEFAULT 'onboarding',
			status TEXT NOT NULL DEFAULT 'active',
			created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
			expires_at TIMESTAMPTZ NOT NULL,
			consumed_at TIMESTAMPTZ,
			invalidated_at TIMESTAMPTZ
		)
	`);
	await db.execute(sql`
		CREATE UNIQUE INDEX IF NOT EXISTS idx_setup_tokens_active_user
		ON setup_tokens (telegram_user_id)
		WHERE status = 'active'
	`);
	await db.execute(sql`
		CREATE TABLE IF NOT EXISTS setup_token_audit_log (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			token_id UUID NOT NULL REFERENCES setup_tokens(id),
			event TEXT NOT NULL,
			actor_service TEXT NOT NULL,
			ip_address TEXT,
			correlation_id TEXT,
			created_at TIMESTAMPTZ NOT NULL DEFAULT now()
		)
	`);
	await db.execute(sql`
		CREATE INDEX IF NOT EXISTS idx_audit_log_token_id
		ON setup_token_audit_log(token_id)
	`);
	// User tables for credential and preference endpoints
	await db.execute(sql`
		CREATE TABLE IF NOT EXISTS users (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			telegram_user_id TEXT NOT NULL UNIQUE,
			monica_base_url TEXT NOT NULL,
			monica_api_token_encrypted TEXT NOT NULL,
			encryption_key_id TEXT NOT NULL,
			created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
		)
	`);
	await db.execute(sql`
		CREATE TABLE IF NOT EXISTS user_preferences (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			user_id UUID NOT NULL UNIQUE REFERENCES users(id),
			language TEXT NOT NULL DEFAULT 'en',
			confirmation_mode TEXT NOT NULL DEFAULT 'explicit',
			timezone TEXT NOT NULL,
			reminder_cadence TEXT NOT NULL DEFAULT 'daily',
			reminder_time TEXT NOT NULL DEFAULT '08:00',
			connector_type TEXT NOT NULL DEFAULT 'telegram',
			connector_routing_id TEXT NOT NULL,
			created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
		)
	`);
	await db.execute(sql`
		CREATE TABLE IF NOT EXISTS credential_access_audit_log (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			user_id UUID NOT NULL REFERENCES users(id),
			actor_service TEXT NOT NULL,
			correlation_id TEXT,
			created_at TIMESTAMPTZ NOT NULL DEFAULT now()
		)
	`);
	await db.execute(sql`
		CREATE INDEX IF NOT EXISTS idx_credential_audit_user_id
		ON credential_access_audit_log(user_id)
	`);
	await db.execute(sql`
		CREATE INDEX IF NOT EXISTS idx_credential_audit_created_at
		ON credential_access_audit_log(created_at)
	`);
});

beforeEach(async () => {
	await db.execute(sql`DELETE FROM credential_access_audit_log`);
	await db.execute(sql`DELETE FROM user_preferences`);
	await db.execute(sql`DELETE FROM users`);
	await db.delete(setupTokenAuditLog);
	await db.delete(setupTokens);
});

afterAll(async () => {
	await db.execute(sql`DELETE FROM credential_access_audit_log`);
	await db.execute(sql`DELETE FROM user_preferences`);
	await db.execute(sql`DELETE FROM users`);
	await db.delete(setupTokenAuditLog);
	await db.delete(setupTokens);
});

async function signToken(issuer: string, audience: string = "user-management") {
	return signServiceToken({
		issuer: issuer as Parameters<typeof signServiceToken>[0]["issuer"],
		audience: audience as Parameters<typeof signServiceToken>[0]["audience"],
		secret: JWT_SECRET,
	});
}

/** Insert a test user directly into the database. */
async function seedTestUser(opts?: {
	telegramUserId?: string;
	monicaBaseUrl?: string;
	apiToken?: string;
	withPreferences?: boolean;
	timezone?: string;
	connectorRoutingId?: string;
	reminderCadence?: string;
	reminderTime?: string;
}) {
	const telegramUserId = opts?.telegramUserId ?? `tg-${randomUUID()}`;
	const apiToken = opts?.apiToken ?? "test-api-token";
	const encrypted = encryptCredential(apiToken, MASTER_KEY);
	const keyId = computeKeyId(MASTER_KEY);

	const [user] = await db.execute(sql`
		INSERT INTO users (telegram_user_id, monica_base_url, monica_api_token_encrypted, encryption_key_id)
		VALUES (${telegramUserId}, ${opts?.monicaBaseUrl ?? "https://monica.example.com"}, ${encrypted}, ${keyId})
		RETURNING id
	`);

	if (opts?.withPreferences) {
		await db.execute(sql`
			INSERT INTO user_preferences (user_id, timezone, connector_routing_id, reminder_cadence, reminder_time)
			VALUES (
				${user.id},
				${opts?.timezone ?? "America/New_York"},
				${opts?.connectorRoutingId ?? "chat-123"},
				${opts?.reminderCadence ?? "daily"},
				${opts?.reminderTime ?? "08:00"}
			)
		`);
	}

	return { id: user.id as string, telegramUserId, apiToken };
}

describe("GET /health", () => {
	it("returns 200 without auth", async () => {
		const app = createApp(testConfig, db);
		const res = await app.request("/health");
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body).toEqual({ status: "ok", service: "user-management" });
	});
});

describe("POST /internal/setup-tokens", () => {
	it("returns 401 without auth", async () => {
		const app = createApp(testConfig, db);
		const res = await app.request("/internal/setup-tokens", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ telegramUserId: "123", step: "onboarding" }),
		});
		expect(res.status).toBe(401);
	});

	it("returns 403 for disallowed caller", async () => {
		const token = await signToken("ai-router");
		const app = createApp(testConfig, db);
		const res = await app.request("/internal/setup-tokens", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${token}`,
			},
			body: JSON.stringify({ telegramUserId: "123", step: "onboarding" }),
		});
		expect(res.status).toBe(403);
	});

	it("returns 400 for invalid body", async () => {
		const token = await signToken("telegram-bridge");
		const app = createApp(testConfig, db);
		const res = await app.request("/internal/setup-tokens", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${token}`,
			},
			body: JSON.stringify({ invalid: "body" }),
		});
		expect(res.status).toBe(400);
	});

	it("returns 400 for malformed JSON body", async () => {
		const token = await signToken("telegram-bridge");
		const app = createApp(testConfig, db);
		const res = await app.request("/internal/setup-tokens", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${token}`,
			},
			body: "not-valid-json{{{",
		});
		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.error).toBe("Invalid request body");
	});

	it("returns 201 with valid auth and body", async () => {
		const token = await signToken("telegram-bridge");
		const app = createApp(testConfig, db);
		const res = await app.request("/internal/setup-tokens", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${token}`,
			},
			body: JSON.stringify({ telegramUserId: "123456", step: "onboarding" }),
		});
		expect(res.status).toBe(201);
		const body = await res.json();
		expect(body.setupUrl).toContain("/setup/");
		expect(body.setupUrl).toContain("?sig=");
		expect(body.tokenId).toBeDefined();
		expect(body.expiresAt).toBeDefined();
	});

	it("invalidates previous token for same user", async () => {
		const token = await signToken("telegram-bridge");
		const app = createApp(testConfig, db);

		const res1 = await app.request("/internal/setup-tokens", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${token}`,
			},
			body: JSON.stringify({ telegramUserId: "same-user", step: "onboarding" }),
		});
		const body1 = await res1.json();

		const token2 = await signToken("telegram-bridge");
		const res2 = await app.request("/internal/setup-tokens", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${token2}`,
			},
			body: JSON.stringify({ telegramUserId: "same-user", step: "onboarding" }),
		});
		expect(res2.status).toBe(201);

		// Validate the old token should fail
		const webUiToken = await signToken("web-ui");
		const sigFromUrl = new URL(body1.setupUrl).searchParams.get("sig");
		const validateRes = await app.request(
			`/internal/setup-tokens/${body1.tokenId}/validate?sig=${sigFromUrl}`,
			{
				headers: { Authorization: `Bearer ${webUiToken}` },
			},
		);
		const validateBody = await validateRes.json();
		expect(validateBody.valid).toBe(false);
	});
});

describe("GET /internal/setup-tokens/:tokenId/validate", () => {
	it("returns 401 without auth", async () => {
		const app = createApp(testConfig, db);
		const res = await app.request("/internal/setup-tokens/some-id/validate?sig=test");
		expect(res.status).toBe(401);
	});

	it("returns valid: true for a valid token", async () => {
		const app = createApp(testConfig, db);

		// Issue a token
		const bridgeToken = await signToken("telegram-bridge");
		const issueRes = await app.request("/internal/setup-tokens", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${bridgeToken}`,
			},
			body: JSON.stringify({ telegramUserId: "user-valid", step: "onboarding" }),
		});
		const issueBody = await issueRes.json();
		const sig = new URL(issueBody.setupUrl).searchParams.get("sig");

		// Validate it
		const webUiToken = await signToken("web-ui");
		const validateRes = await app.request(
			`/internal/setup-tokens/${issueBody.tokenId}/validate?sig=${sig}`,
			{
				headers: { Authorization: `Bearer ${webUiToken}` },
			},
		);
		expect(validateRes.status).toBe(200);
		const body = await validateRes.json();
		expect(body.valid).toBe(true);
		expect(body.telegramUserId).toBe("user-valid");
		expect(body.step).toBe("onboarding");
		expect(body.expiresAt).toBeDefined();
	});

	it("returns valid: false for nonexistent token", async () => {
		const app = createApp(testConfig, db);
		const webUiToken = await signToken("web-ui");
		const res = await app.request(`/internal/setup-tokens/${randomUUID()}/validate?sig=anything`, {
			headers: { Authorization: `Bearer ${webUiToken}` },
		});
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.valid).toBe(false);
	});

	it("returns 403 for wrong signature", async () => {
		const app = createApp(testConfig, db);

		const bridgeToken = await signToken("telegram-bridge");
		const issueRes = await app.request("/internal/setup-tokens", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${bridgeToken}`,
			},
			body: JSON.stringify({ telegramUserId: "user-sig-test", step: "onboarding" }),
		});
		const issueBody = await issueRes.json();

		const webUiToken = await signToken("web-ui");
		const res = await app.request(
			`/internal/setup-tokens/${issueBody.tokenId}/validate?sig=wrong-signature`,
			{
				headers: { Authorization: `Bearer ${webUiToken}` },
			},
		);
		expect(res.status).toBe(403);
	});

	it("returns 400 when sig is missing", async () => {
		const app = createApp(testConfig, db);
		const webUiToken = await signToken("web-ui");
		const res = await app.request(`/internal/setup-tokens/${randomUUID()}/validate`, {
			headers: { Authorization: `Bearer ${webUiToken}` },
		});
		expect(res.status).toBe(400);
	});
});

describe("POST /internal/setup-tokens/:tokenId/consume", () => {
	it("returns 401 without auth", async () => {
		const app = createApp(testConfig, db);
		const res = await app.request(`/internal/setup-tokens/${randomUUID()}/consume`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ sig: "test" }),
		});
		expect(res.status).toBe(401);
	});

	it("consumes a valid token", async () => {
		const app = createApp(testConfig, db);

		// Issue
		const bridgeToken = await signToken("telegram-bridge");
		const issueRes = await app.request("/internal/setup-tokens", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${bridgeToken}`,
			},
			body: JSON.stringify({ telegramUserId: "user-consume", step: "onboarding" }),
		});
		const issueBody = await issueRes.json();
		const sig = new URL(issueBody.setupUrl).searchParams.get("sig");

		// Consume
		const webUiToken = await signToken("web-ui");
		const consumeRes = await app.request(`/internal/setup-tokens/${issueBody.tokenId}/consume`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${webUiToken}`,
			},
			body: JSON.stringify({ sig }),
		});
		expect(consumeRes.status).toBe(200);
		const body = await consumeRes.json();
		expect(body.consumed).toBe(true);
	});

	it("returns consumed: false for already-consumed token", async () => {
		const app = createApp(testConfig, db);

		// Issue
		const bridgeToken = await signToken("telegram-bridge");
		const issueRes = await app.request("/internal/setup-tokens", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${bridgeToken}`,
			},
			body: JSON.stringify({ telegramUserId: "user-double-consume", step: "onboarding" }),
		});
		const issueBody = await issueRes.json();
		const sig = new URL(issueBody.setupUrl).searchParams.get("sig");

		// Consume twice
		const webUiToken = await signToken("web-ui");
		await app.request(`/internal/setup-tokens/${issueBody.tokenId}/consume`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${webUiToken}`,
			},
			body: JSON.stringify({ sig }),
		});

		const webUiToken2 = await signToken("web-ui");
		const secondRes = await app.request(`/internal/setup-tokens/${issueBody.tokenId}/consume`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${webUiToken2}`,
			},
			body: JSON.stringify({ sig }),
		});
		const body = await secondRes.json();
		expect(body.consumed).toBe(false);
		expect(body.reason).toBe("already_consumed");
	});

	it("returns 403 for wrong signature", async () => {
		const app = createApp(testConfig, db);

		const bridgeToken = await signToken("telegram-bridge");
		const issueRes = await app.request("/internal/setup-tokens", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${bridgeToken}`,
			},
			body: JSON.stringify({ telegramUserId: "user-bad-sig-consume", step: "onboarding" }),
		});
		const issueBody = await issueRes.json();

		const webUiToken = await signToken("web-ui");
		const consumeRes = await app.request(`/internal/setup-tokens/${issueBody.tokenId}/consume`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${webUiToken}`,
			},
			body: JSON.stringify({ sig: "wrong-signature" }),
		});
		expect(consumeRes.status).toBe(403);
	});

	it("returns 400 for invalid body", async () => {
		const app = createApp(testConfig, db);
		const webUiToken = await signToken("web-ui");
		const res = await app.request(`/internal/setup-tokens/${randomUUID()}/consume`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${webUiToken}`,
			},
			body: JSON.stringify({}),
		});
		expect(res.status).toBe(400);
	});

	it("returns 400 for malformed JSON body", async () => {
		const app = createApp(testConfig, db);
		const webUiToken = await signToken("web-ui");
		const res = await app.request(`/internal/setup-tokens/${randomUUID()}/consume`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${webUiToken}`,
			},
			body: "not-valid-json{{{",
		});
		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.error).toBe("Invalid request body");
	});
});

describe("POST /internal/setup-tokens/:tokenId/cancel", () => {
	it("returns 401 without auth", async () => {
		const app = createApp(testConfig, db);
		const res = await app.request(`/internal/setup-tokens/${randomUUID()}/cancel`, {
			method: "POST",
		});
		expect(res.status).toBe(401);
	});

	it("cancels an active token", async () => {
		const app = createApp(testConfig, db);

		// Issue
		const bridgeToken = await signToken("telegram-bridge");
		const issueRes = await app.request("/internal/setup-tokens", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${bridgeToken}`,
			},
			body: JSON.stringify({ telegramUserId: "user-cancel", step: "onboarding" }),
		});
		const issueBody = await issueRes.json();

		// Cancel
		const bridgeToken2 = await signToken("telegram-bridge");
		const cancelRes = await app.request(`/internal/setup-tokens/${issueBody.tokenId}/cancel`, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${bridgeToken2}`,
			},
		});
		expect(cancelRes.status).toBe(200);
		const body = await cancelRes.json();
		expect(body.cancelled).toBe(true);
	});

	it("returns cancelled: false for nonexistent token", async () => {
		const app = createApp(testConfig, db);
		const bridgeToken = await signToken("telegram-bridge");
		const res = await app.request(`/internal/setup-tokens/${randomUUID()}/cancel`, {
			method: "POST",
			headers: { Authorization: `Bearer ${bridgeToken}` },
		});
		const body = await res.json();
		expect(body.cancelled).toBe(false);
	});

	it("returns 403 for disallowed caller", async () => {
		const app = createApp(testConfig, db);
		const token = await signToken("web-ui");
		const res = await app.request(`/internal/setup-tokens/${randomUUID()}/cancel`, {
			method: "POST",
			headers: { Authorization: `Bearer ${token}` },
		});
		expect(res.status).toBe(403);
	});
});

// --- Credential endpoint tests ---

describe("GET /internal/users/:userId/monica-credentials", () => {
	it("returns 401 without auth", async () => {
		const app = createApp(testConfig, db);
		const res = await app.request(`/internal/users/${randomUUID()}/monica-credentials`);
		expect(res.status).toBe(401);
	});

	it("returns 403 for disallowed caller (telegram-bridge)", async () => {
		const token = await signToken("telegram-bridge");
		const app = createApp(testConfig, db);
		const res = await app.request(`/internal/users/${randomUUID()}/monica-credentials`, {
			headers: { Authorization: `Bearer ${token}` },
		});
		expect(res.status).toBe(403);
	});

	it("returns 403 for disallowed caller (ai-router)", async () => {
		const token = await signToken("ai-router");
		const app = createApp(testConfig, db);
		const res = await app.request(`/internal/users/${randomUUID()}/monica-credentials`, {
			headers: { Authorization: `Bearer ${token}` },
		});
		expect(res.status).toBe(403);
	});

	it("returns 400 for malformed userId", async () => {
		const token = await signToken("monica-integration");
		const app = createApp(testConfig, db);
		const res = await app.request("/internal/users/not-a-uuid/monica-credentials", {
			headers: { Authorization: `Bearer ${token}` },
		});
		expect(res.status).toBe(400);
	});

	it("returns 404 for nonexistent user", async () => {
		const token = await signToken("monica-integration");
		const app = createApp(testConfig, db);
		const res = await app.request(`/internal/users/${randomUUID()}/monica-credentials`, {
			headers: { Authorization: `Bearer ${token}` },
		});
		expect(res.status).toBe(404);
		const body = await res.json();
		expect(body.error).toBe("User not found");
	});

	it("returns 200 with decrypted credentials for existing user", async () => {
		const user = await seedTestUser({ apiToken: "my-secret-token" });
		const token = await signToken("monica-integration");
		const app = createApp(testConfig, db);
		const res = await app.request(`/internal/users/${user.id}/monica-credentials`, {
			headers: { Authorization: `Bearer ${token}` },
		});
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.baseUrl).toBe("https://monica.example.com");
		expect(body.apiToken).toBe("my-secret-token");
	});

	it("creates audit log entry on successful credential access", async () => {
		const user = await seedTestUser();
		const token = await signToken("monica-integration");
		const app = createApp(testConfig, db);
		await app.request(`/internal/users/${user.id}/monica-credentials`, {
			headers: { Authorization: `Bearer ${token}` },
		});

		const rows = await db.execute(
			sql`SELECT * FROM credential_access_audit_log WHERE user_id = ${user.id}`,
		);
		expect(rows.length).toBe(1);
		expect(rows[0].actor_service).toBe("monica-integration");
	});
});

// --- Preference endpoint tests ---

describe("GET /internal/users/:userId/preferences", () => {
	it("returns 401 without auth", async () => {
		const app = createApp(testConfig, db);
		const res = await app.request(`/internal/users/${randomUUID()}/preferences`);
		expect(res.status).toBe(401);
	});

	it("returns 403 for disallowed caller (monica-integration)", async () => {
		const token = await signToken("monica-integration");
		const app = createApp(testConfig, db);
		const res = await app.request(`/internal/users/${randomUUID()}/preferences`, {
			headers: { Authorization: `Bearer ${token}` },
		});
		expect(res.status).toBe(403);
	});

	it("returns 400 for malformed userId", async () => {
		const token = await signToken("telegram-bridge");
		const app = createApp(testConfig, db);
		const res = await app.request("/internal/users/not-a-uuid/preferences", {
			headers: { Authorization: `Bearer ${token}` },
		});
		expect(res.status).toBe(400);
	});

	it("returns 404 for nonexistent user", async () => {
		const token = await signToken("telegram-bridge");
		const app = createApp(testConfig, db);
		const res = await app.request(`/internal/users/${randomUUID()}/preferences`, {
			headers: { Authorization: `Bearer ${token}` },
		});
		expect(res.status).toBe(404);
	});

	it("returns 404 when user exists but has no preferences", async () => {
		const user = await seedTestUser();
		const token = await signToken("telegram-bridge");
		const app = createApp(testConfig, db);
		const res = await app.request(`/internal/users/${user.id}/preferences`, {
			headers: { Authorization: `Bearer ${token}` },
		});
		expect(res.status).toBe(404);
	});

	it("returns 200 with preferences for allowed caller (telegram-bridge)", async () => {
		const user = await seedTestUser({ withPreferences: true, timezone: "Europe/Berlin" });
		const token = await signToken("telegram-bridge");
		const app = createApp(testConfig, db);
		const res = await app.request(`/internal/users/${user.id}/preferences`, {
			headers: { Authorization: `Bearer ${token}` },
		});
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.language).toBe("en");
		expect(body.confirmationMode).toBe("explicit");
		expect(body.timezone).toBe("Europe/Berlin");
	});

	it("returns 200 for allowed caller (ai-router)", async () => {
		const user = await seedTestUser({ withPreferences: true });
		const token = await signToken("ai-router");
		const app = createApp(testConfig, db);
		const res = await app.request(`/internal/users/${user.id}/preferences`, {
			headers: { Authorization: `Bearer ${token}` },
		});
		expect(res.status).toBe(200);
	});

	it("returns 200 for allowed caller (scheduler)", async () => {
		const user = await seedTestUser({ withPreferences: true });
		const token = await signToken("scheduler");
		const app = createApp(testConfig, db);
		const res = await app.request(`/internal/users/${user.id}/preferences`, {
			headers: { Authorization: `Bearer ${token}` },
		});
		expect(res.status).toBe(200);
	});
});

// --- Schedule endpoint tests ---

describe("GET /internal/users/:userId/schedule", () => {
	it("returns 401 without auth", async () => {
		const app = createApp(testConfig, db);
		const res = await app.request(`/internal/users/${randomUUID()}/schedule`);
		expect(res.status).toBe(401);
	});

	it("returns 403 for disallowed caller (telegram-bridge)", async () => {
		const token = await signToken("telegram-bridge");
		const app = createApp(testConfig, db);
		const res = await app.request(`/internal/users/${randomUUID()}/schedule`, {
			headers: { Authorization: `Bearer ${token}` },
		});
		expect(res.status).toBe(403);
	});

	it("returns 400 for malformed userId", async () => {
		const token = await signToken("scheduler");
		const app = createApp(testConfig, db);
		const res = await app.request("/internal/users/not-a-uuid/schedule", {
			headers: { Authorization: `Bearer ${token}` },
		});
		expect(res.status).toBe(400);
	});

	it("returns 404 for nonexistent user", async () => {
		const token = await signToken("scheduler");
		const app = createApp(testConfig, db);
		const res = await app.request(`/internal/users/${randomUUID()}/schedule`, {
			headers: { Authorization: `Bearer ${token}` },
		});
		expect(res.status).toBe(404);
	});

	it("returns 200 with schedule fields for scheduler", async () => {
		const user = await seedTestUser({
			withPreferences: true,
			timezone: "Asia/Tokyo",
			reminderCadence: "weekly",
			reminderTime: "09:00",
			connectorRoutingId: "chat-789",
		});
		const token = await signToken("scheduler");
		const app = createApp(testConfig, db);
		const res = await app.request(`/internal/users/${user.id}/schedule`, {
			headers: { Authorization: `Bearer ${token}` },
		});
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.reminderCadence).toBe("weekly");
		expect(body.reminderTime).toBe("09:00");
		expect(body.timezone).toBe("Asia/Tokyo");
		expect(body.connectorType).toBe("telegram");
		expect(body.connectorRoutingId).toBe("chat-789");
	});
});

// --- Connector user lookup endpoint tests ---

describe("GET /internal/users/by-connector/:connectorType/:connectorUserId", () => {
	it("returns 401 without auth", async () => {
		const app = createApp(testConfig, db);
		const res = await app.request("/internal/users/by-connector/telegram/12345");
		expect(res.status).toBe(401);
	});

	it("returns 403 for disallowed caller (ai-router)", async () => {
		const token = await signToken("ai-router");
		const app = createApp(testConfig, db);
		const res = await app.request("/internal/users/by-connector/telegram/12345", {
			headers: { Authorization: `Bearer ${token}` },
		});
		expect(res.status).toBe(403);
	});

	it("returns found: true with userId for known Telegram user", async () => {
		const user = await seedTestUser({ telegramUserId: "tg-lookup-test" });
		const token = await signToken("telegram-bridge");
		const app = createApp(testConfig, db);
		const res = await app.request("/internal/users/by-connector/telegram/tg-lookup-test", {
			headers: { Authorization: `Bearer ${token}` },
		});
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.found).toBe(true);
		expect(body.userId).toBe(user.id);
	});

	it("returns found: false for unknown Telegram user", async () => {
		const token = await signToken("telegram-bridge");
		const app = createApp(testConfig, db);
		const res = await app.request("/internal/users/by-connector/telegram/nonexistent-user", {
			headers: { Authorization: `Bearer ${token}` },
		});
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.found).toBe(false);
		expect(body.userId).toBeUndefined();
	});

	it("returns 400 for unsupported connector type", async () => {
		const token = await signToken("telegram-bridge");
		const app = createApp(testConfig, db);
		const res = await app.request("/internal/users/by-connector/slack/12345", {
			headers: { Authorization: `Bearer ${token}` },
		});
		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.error).toBe("Unsupported connector type");
	});
});

// --- User schedule list endpoint tests ---

describe("GET /internal/users/with-schedules", () => {
	it("returns 401 without auth", async () => {
		const app = createApp(testConfig, db);
		const res = await app.request("/internal/users/with-schedules");
		expect(res.status).toBe(401);
	});

	it("returns 403 for disallowed caller (telegram-bridge)", async () => {
		const token = await signToken("telegram-bridge");
		const app = createApp(testConfig, db);
		const res = await app.request("/internal/users/with-schedules", {
			headers: { Authorization: `Bearer ${token}` },
		});
		expect(res.status).toBe(403);
	});

	it("returns empty array when no users have schedules", async () => {
		const token = await signToken("scheduler");
		const app = createApp(testConfig, db);
		const res = await app.request("/internal/users/with-schedules", {
			headers: { Authorization: `Bearer ${token}` },
		});
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.data).toEqual([]);
	});

	it("returns users with active reminder cadence (not none)", async () => {
		await seedTestUser({
			withPreferences: true,
			timezone: "America/New_York",
			reminderCadence: "daily",
			reminderTime: "08:00",
			connectorRoutingId: "chat-123",
		});
		await seedTestUser({
			withPreferences: true,
			timezone: "Europe/London",
			reminderCadence: "weekly",
			reminderTime: "09:00",
			connectorRoutingId: "chat-456",
		});

		const token = await signToken("scheduler");
		const app = createApp(testConfig, db);
		const res = await app.request("/internal/users/with-schedules", {
			headers: { Authorization: `Bearer ${token}` },
		});
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.data).toHaveLength(2);
		expect(body.data[0]).toHaveProperty("userId");
		expect(body.data[0]).toHaveProperty("reminderCadence");
		expect(body.data[0]).toHaveProperty("reminderTime");
		expect(body.data[0]).toHaveProperty("timezone");
		expect(body.data[0]).toHaveProperty("connectorType");
		expect(body.data[0]).toHaveProperty("connectorRoutingId");
	});

	it("excludes users with reminder_cadence = none", async () => {
		await seedTestUser({
			withPreferences: true,
			timezone: "UTC",
			reminderCadence: "none",
			reminderTime: "08:00",
			connectorRoutingId: "chat-789",
		});
		await seedTestUser({
			withPreferences: true,
			timezone: "UTC",
			reminderCadence: "daily",
			reminderTime: "10:00",
			connectorRoutingId: "chat-012",
		});

		const token = await signToken("scheduler");
		const app = createApp(testConfig, db);
		const res = await app.request("/internal/users/with-schedules", {
			headers: { Authorization: `Bearer ${token}` },
		});
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.data).toHaveLength(1);
		expect(body.data[0].reminderCadence).toBe("daily");
	});
});
