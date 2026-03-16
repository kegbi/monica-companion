import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDb, type Database } from "../../db/connection";
import { setupTokenAuditLog, setupTokens } from "../../db/schema";
import {
	cancelToken,
	consumeToken,
	findActiveToken,
	issueToken,
	logAuditEvent,
} from "../repository";

const DATABASE_URL =
	process.env.DATABASE_URL ?? "postgresql://monica:monica_dev@localhost:5432/monica_companion";

let db: Database;

beforeAll(async () => {
	db = createDb(DATABASE_URL);
	// Create tables if they do not exist (push-style for tests)
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
});

beforeEach(async () => {
	// Clean tables before each test
	await db.delete(setupTokenAuditLog);
	await db.delete(setupTokens);
});

afterAll(async () => {
	// Clean up after all tests
	await db.delete(setupTokenAuditLog);
	await db.delete(setupTokens);
});

describe("issueToken", () => {
	it("inserts a row and returns it", async () => {
		const tokenId = randomUUID();
		const result = await issueToken(db, {
			tokenId,
			telegramUserId: "user-1",
			step: "onboarding",
			expiresAt: new Date(Date.now() + 15 * 60 * 1000),
			actorService: "telegram-bridge",
			correlationId: "corr-1",
		});

		expect(result.id).toBe(tokenId);
		expect(result.telegramUserId).toBe("user-1");
		expect(result.step).toBe("onboarding");
		expect(result.status).toBe("active");
	});

	it("supersedes existing active token for same user", async () => {
		const tokenId1 = randomUUID();
		const tokenId2 = randomUUID();

		await issueToken(db, {
			tokenId: tokenId1,
			telegramUserId: "user-2",
			step: "onboarding",
			expiresAt: new Date(Date.now() + 15 * 60 * 1000),
			actorService: "telegram-bridge",
		});

		await issueToken(db, {
			tokenId: tokenId2,
			telegramUserId: "user-2",
			step: "onboarding",
			expiresAt: new Date(Date.now() + 15 * 60 * 1000),
			actorService: "telegram-bridge",
		});

		// Token 1 should be superseded
		const token1 = await findActiveToken(db, tokenId1);
		expect(token1).toBeNull();

		// Token 2 should be active
		const token2 = await findActiveToken(db, tokenId2);
		expect(token2).not.toBeNull();
		expect(token2?.status).toBe("active");
	});

	it("creates audit log entry on issue", async () => {
		const tokenId = randomUUID();
		await issueToken(db, {
			tokenId,
			telegramUserId: "user-3",
			step: "onboarding",
			expiresAt: new Date(Date.now() + 15 * 60 * 1000),
			actorService: "telegram-bridge",
			correlationId: "corr-3",
		});

		const logs = await db.select().from(setupTokenAuditLog).where(sql`token_id = ${tokenId}`);

		expect(logs.length).toBe(1);
		expect(logs[0].event).toBe("issued");
		expect(logs[0].actorService).toBe("telegram-bridge");
		expect(logs[0].correlationId).toBe("corr-3");
	});

	it("creates superseded audit log when reissuing", async () => {
		const tokenId1 = randomUUID();
		const tokenId2 = randomUUID();

		await issueToken(db, {
			tokenId: tokenId1,
			telegramUserId: "user-4",
			step: "onboarding",
			expiresAt: new Date(Date.now() + 15 * 60 * 1000),
			actorService: "telegram-bridge",
		});

		await issueToken(db, {
			tokenId: tokenId2,
			telegramUserId: "user-4",
			step: "onboarding",
			expiresAt: new Date(Date.now() + 15 * 60 * 1000),
			actorService: "telegram-bridge",
		});

		const logs = await db.select().from(setupTokenAuditLog).where(sql`token_id = ${tokenId1}`);

		const supersededLog = logs.find((l) => l.event === "superseded_by_reissue");
		expect(supersededLog).toBeDefined();
	});
});

describe("consumeToken", () => {
	it("marks token as consumed and returns consumed: true", async () => {
		const tokenId = randomUUID();
		await issueToken(db, {
			tokenId,
			telegramUserId: "user-5",
			step: "onboarding",
			expiresAt: new Date(Date.now() + 15 * 60 * 1000),
			actorService: "telegram-bridge",
		});

		const result = await consumeToken(db, {
			tokenId,
			actorService: "web-ui",
			correlationId: "corr-5",
		});

		expect(result.consumed).toBe(true);
	});

	it("returns consumed: false for already-consumed token", async () => {
		const tokenId = randomUUID();
		await issueToken(db, {
			tokenId,
			telegramUserId: "user-6",
			step: "onboarding",
			expiresAt: new Date(Date.now() + 15 * 60 * 1000),
			actorService: "telegram-bridge",
		});

		await consumeToken(db, { tokenId, actorService: "web-ui" });
		const result = await consumeToken(db, { tokenId, actorService: "web-ui" });

		expect(result.consumed).toBe(false);
		expect(result.reason).toBe("already_consumed");
	});

	it("returns consumed: false for expired token", async () => {
		const tokenId = randomUUID();
		await issueToken(db, {
			tokenId,
			telegramUserId: "user-7",
			step: "onboarding",
			expiresAt: new Date(Date.now() - 1000), // already expired
			actorService: "telegram-bridge",
		});

		const result = await consumeToken(db, { tokenId, actorService: "web-ui" });

		expect(result.consumed).toBe(false);
		expect(result.reason).toBe("expired");
	});

	it("creates consumed audit log entry", async () => {
		const tokenId = randomUUID();
		await issueToken(db, {
			tokenId,
			telegramUserId: "user-8",
			step: "onboarding",
			expiresAt: new Date(Date.now() + 15 * 60 * 1000),
			actorService: "telegram-bridge",
		});

		await consumeToken(db, {
			tokenId,
			actorService: "web-ui",
			ipAddress: "192.168.1.1",
			correlationId: "corr-8",
		});

		const logs = await db.select().from(setupTokenAuditLog).where(sql`token_id = ${tokenId}`);

		const consumedLog = logs.find((l) => l.event === "consumed");
		expect(consumedLog).toBeDefined();
		expect(consumedLog?.actorService).toBe("web-ui");
		expect(consumedLog?.ipAddress).toBe("192.168.1.1");
	});

	it("creates replay_rejected audit log for already-consumed token", async () => {
		const tokenId = randomUUID();
		await issueToken(db, {
			tokenId,
			telegramUserId: "user-9",
			step: "onboarding",
			expiresAt: new Date(Date.now() + 15 * 60 * 1000),
			actorService: "telegram-bridge",
		});

		await consumeToken(db, { tokenId, actorService: "web-ui" });
		await consumeToken(db, { tokenId, actorService: "web-ui" });

		const logs = await db.select().from(setupTokenAuditLog).where(sql`token_id = ${tokenId}`);

		const replayLog = logs.find((l) => l.event === "replay_rejected");
		expect(replayLog).toBeDefined();
	});
});

describe("cancelToken", () => {
	it("sets status to cancelled", async () => {
		const tokenId = randomUUID();
		await issueToken(db, {
			tokenId,
			telegramUserId: "user-10",
			step: "onboarding",
			expiresAt: new Date(Date.now() + 15 * 60 * 1000),
			actorService: "telegram-bridge",
		});

		const result = await cancelToken(db, {
			telegramUserId: "user-10",
			actorService: "telegram-bridge",
		});

		expect(result.cancelled).toBe(true);

		const token = await findActiveToken(db, tokenId);
		expect(token).toBeNull();
	});

	it("returns cancelled: false when no active token", async () => {
		const result = await cancelToken(db, {
			telegramUserId: "user-nonexistent",
			actorService: "telegram-bridge",
		});

		expect(result.cancelled).toBe(false);
	});

	it("creates cancelled audit log entry", async () => {
		const tokenId = randomUUID();
		await issueToken(db, {
			tokenId,
			telegramUserId: "user-11",
			step: "onboarding",
			expiresAt: new Date(Date.now() + 15 * 60 * 1000),
			actorService: "telegram-bridge",
		});

		await cancelToken(db, {
			telegramUserId: "user-11",
			actorService: "telegram-bridge",
			correlationId: "corr-11",
		});

		const logs = await db.select().from(setupTokenAuditLog).where(sql`token_id = ${tokenId}`);

		const cancelledLog = logs.find((l) => l.event === "cancelled");
		expect(cancelledLog).toBeDefined();
	});
});

describe("logAuditEvent", () => {
	it("inserts an audit log entry", async () => {
		const tokenId = randomUUID();
		await issueToken(db, {
			tokenId,
			telegramUserId: "user-12",
			step: "onboarding",
			expiresAt: new Date(Date.now() + 15 * 60 * 1000),
			actorService: "telegram-bridge",
		});

		await logAuditEvent(db, {
			tokenId,
			event: "validated",
			actorService: "web-ui",
			ipAddress: "10.0.0.1",
			correlationId: "corr-12",
		});

		const logs = await db.select().from(setupTokenAuditLog).where(sql`token_id = ${tokenId}`);

		const validatedLog = logs.find((l) => l.event === "validated");
		expect(validatedLog).toBeDefined();
		expect(validatedLog?.actorService).toBe("web-ui");
		expect(validatedLog?.ipAddress).toBe("10.0.0.1");
	});
});
