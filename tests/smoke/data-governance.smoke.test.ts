/**
 * Data Governance Enforcement smoke tests.
 */

import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { authedRequest, smokeRequest } from "./helpers.js";
import { loadSmokeConfig } from "./smoke-config.js";

const config = loadSmokeConfig();
const SQ = String.fromCharCode(39);
const DL = String.fromCharCode(36);

describe("retention cleanup endpoints", () => {
	const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

	it("ai-router POST /internal/retention-cleanup returns 200", async () => {
		const { status, body } = await authedRequest(
			config.AI_ROUTER_URL + "/internal/retention-cleanup",
			"ai-router",
			{
				method: "POST",
				issuer: "scheduler",
				body: { conversationTurnsCutoff: cutoff, pendingCommandsCutoff: cutoff },
			},
		);
		expect(status).toBe(200);
		expect(body).toHaveProperty("purged");
		const purged = (body as { purged: Record<string, number> }).purged;
		expect(purged).toHaveProperty("conversationTurns");
		expect(purged).toHaveProperty("pendingCommands");
	});

	it("delivery POST /internal/retention-cleanup returns 200", async () => {
		const { status, body } = await authedRequest(
			config.DELIVERY_URL + "/internal/retention-cleanup",
			"delivery",
			{ method: "POST", issuer: "scheduler", body: { deliveryAuditsCutoff: cutoff } },
		);
		expect(status).toBe(200);
		expect(body).toHaveProperty("purged");
	});

	it("ai-router retention-cleanup rejects invalid payload (400)", async () => {
		const { status } = await authedRequest(
			config.AI_ROUTER_URL + "/internal/retention-cleanup",
			"ai-router",
			{ method: "POST", issuer: "scheduler", body: { invalid: "data" } },
		);
		expect(status).toBe(400);
	});

	it("delivery retention-cleanup rejects invalid payload (400)", async () => {
		const { status } = await authedRequest(
			config.DELIVERY_URL + "/internal/retention-cleanup",
			"delivery",
			{ method: "POST", issuer: "scheduler", body: { invalid: "data" } },
		);
		expect(status).toBe(400);
	});
});

describe("data governance auth enforcement", () => {
	const testUserId = randomUUID();

	it("ai-router retention-cleanup rejects wrong caller (403)", async () => {
		const { status } = await authedRequest(
			config.AI_ROUTER_URL + "/internal/retention-cleanup",
			"ai-router",
			{
				method: "POST",
				issuer: "telegram-bridge",
				body: {
					conversationTurnsCutoff: new Date().toISOString(),
					pendingCommandsCutoff: new Date().toISOString(),
				},
			},
		);
		expect(status).toBe(403);
	});

	it("delivery retention-cleanup rejects wrong caller (403)", async () => {
		const { status } = await authedRequest(
			config.DELIVERY_URL + "/internal/retention-cleanup",
			"delivery",
			{
				method: "POST",
				issuer: "ai-router",
				body: { deliveryAuditsCutoff: new Date().toISOString() },
			},
		);
		expect(status).toBe(403);
	});

	it("ai-router user purge rejects wrong caller (403)", async () => {
		const { status } = await authedRequest(
			config.AI_ROUTER_URL + "/internal/users/" + testUserId + "/data",
			"ai-router",
			{ method: "DELETE", issuer: "scheduler" },
		);
		expect(status).toBe(403);
	});

	it("delivery user purge rejects wrong caller (403)", async () => {
		const { status } = await authedRequest(
			config.DELIVERY_URL + "/internal/users/" + testUserId + "/data",
			"delivery",
			{ method: "DELETE", issuer: "scheduler" },
		);
		expect(status).toBe(403);
	});

	it("scheduler user purge rejects wrong caller (403)", async () => {
		const { status } = await authedRequest(
			config.SCHEDULER_URL + "/internal/users/" + testUserId + "/data",
			"scheduler",
			{ method: "DELETE", issuer: "ai-router" },
		);
		expect(status).toBe(403);
	});

	it("ai-router retention-cleanup rejects no auth (401)", async () => {
		const { status } = await smokeRequest(config.AI_ROUTER_URL + "/internal/retention-cleanup", {
			method: "POST",
			body: {
				conversationTurnsCutoff: new Date().toISOString(),
				pendingCommandsCutoff: new Date().toISOString(),
			},
		});
		expect(status).toBe(401);
	});

	it("delivery retention-cleanup rejects no auth (401)", async () => {
		const { status } = await smokeRequest(config.DELIVERY_URL + "/internal/retention-cleanup", {
			method: "POST",
			body: { deliveryAuditsCutoff: new Date().toISOString() },
		});
		expect(status).toBe(401);
	});
});

describe("user data purge endpoints", () => {
	const testUserId = randomUUID();

	it("ai-router user purge returns 200 with zero counts", async () => {
		const { status, body } = await authedRequest(
			config.AI_ROUTER_URL + "/internal/users/" + testUserId + "/data",
			"ai-router",
			{ method: "DELETE", issuer: "user-management" },
		);
		expect(status).toBe(200);
		expect(body).toHaveProperty("purged");
		const purged = (body as { purged: Record<string, number> }).purged;
		expect(purged.conversationTurns).toBe(0);
		expect(purged.pendingCommands).toBe(0);
	});

	it("scheduler user purge returns 200 with zero counts", async () => {
		const { status, body } = await authedRequest(
			config.SCHEDULER_URL + "/internal/users/" + testUserId + "/data",
			"scheduler",
			{ method: "DELETE", issuer: "user-management" },
		);
		expect(status).toBe(200);
		expect(body).toHaveProperty("purged");
		const purged = (body as { purged: Record<string, number> }).purged;
		expect(purged.commandExecutions).toBe(0);
		expect(purged.idempotencyKeys).toBe(0);
		expect(purged.reminderWindows).toBe(0);
	});

	it("delivery user purge returns 200 with zero counts", async () => {
		const { status, body } = await authedRequest(
			config.DELIVERY_URL + "/internal/users/" + testUserId + "/data",
			"delivery",
			{ method: "DELETE", issuer: "user-management" },
		);
		expect(status).toBe(200);
		expect(body).toHaveProperty("purged");
		const purged = (body as { purged: Record<string, number> }).purged;
		expect(purged.deliveryAudits).toBe(0);
	});

	it("ai-router user purge rejects invalid UUID (400)", async () => {
		const { status } = await authedRequest(
			config.AI_ROUTER_URL + "/internal/users/not-a-uuid/data",
			"ai-router",
			{ method: "DELETE", issuer: "user-management" },
		);
		expect(status).toBe(400);
	});
});

describe("disconnect endpoint", () => {
	const sql = postgres(config.POSTGRES_URL, { max: 1 });

	afterAll(async () => {
		await sql.end();
	});

	it("returns 404 for non-existent user", async () => {
		const fakeUserId = randomUUID();
		const { status } = await authedRequest(
			config.USER_MANAGEMENT_URL + "/internal/users/" + fakeUserId + "/disconnect",
			"user-management",
			{ method: "DELETE", issuer: "telegram-bridge" },
		);
		expect(status).toBe(404);
	});

	it("disconnects a seeded user and revokes credentials", async () => {
		const userId = randomUUID();
		const telegramUserId = "smoke-disconnect-" + Date.now();
		await sql.unsafe(
			"INSERT INTO users (id, telegram_user_id, monica_base_url, monica_api_token_encrypted, encryption_key_id) VALUES (" +
				DL +
				"1, " +
				DL +
				"2, " +
				DL +
				"3, " +
				DL +
				"4, " +
				DL +
				"5)",
			[userId, telegramUserId, "https://monica.example.com", "encrypted-token-data", "key-1"],
		);

		const { status, body } = await authedRequest(
			config.USER_MANAGEMENT_URL + "/internal/users/" + userId + "/disconnect",
			"user-management",
			{ method: "DELETE", issuer: "telegram-bridge" },
		);
		expect(status).toBe(200);
		expect(body).toHaveProperty("disconnected", true);
		expect(body).toHaveProperty("purgeScheduledAt");

		const userRows = await sql.unsafe(
			"SELECT monica_base_url, encryption_key_id FROM users WHERE id = " + DL + "1",
			[userId],
		);
		expect(userRows.length).toBe(1);
		expect(userRows[0].monica_base_url).toBe("revoked");
		expect(userRows[0].encryption_key_id).toBe("revoked");

		const purgeRows = await sql.unsafe(
			"SELECT status, reason FROM data_purge_requests WHERE user_id = " + DL + "1",
			[userId],
		);
		expect(purgeRows.length).toBe(1);
		expect(purgeRows[0].status).toBe("pending");
		expect(purgeRows[0].reason).toBe("account_disconnection");

		await sql.unsafe("DELETE FROM data_purge_requests WHERE user_id = " + DL + "1", [userId]);
		await sql.unsafe("DELETE FROM credential_access_audit_log WHERE user_id = " + DL + "1", [
			userId,
		]);
		await sql.unsafe("DELETE FROM users WHERE id = " + DL + "1", [userId]);
	});

	it("disconnect rejects wrong caller (403)", async () => {
		const fakeUserId = randomUUID();
		const { status } = await authedRequest(
			config.USER_MANAGEMENT_URL + "/internal/users/" + fakeUserId + "/disconnect",
			"user-management",
			{ method: "DELETE", issuer: "ai-router" },
		);
		expect(status).toBe(403);
	});

	it("disconnect rejects invalid UUID (400)", async () => {
		const { status } = await authedRequest(
			config.USER_MANAGEMENT_URL + "/internal/users/not-a-uuid/disconnect",
			"user-management",
			{ method: "DELETE", issuer: "telegram-bridge" },
		);
		expect(status).toBe(400);
	});
});

describe("data_purge_requests migration", () => {
	const sql = postgres(config.POSTGRES_URL, { max: 1 });

	afterAll(async () => {
		await sql.end();
	});

	it("data_purge_requests table exists with expected columns", async () => {
		const columns = await sql.unsafe(
			"SELECT column_name FROM information_schema.columns WHERE table_schema = " +
				SQ +
				"public" +
				SQ +
				" AND table_name = " +
				SQ +
				"data_purge_requests" +
				SQ +
				" ORDER BY column_name",
		);
		const names = columns.map((r: Record<string, string>) => r.column_name);
		expect(names).toContain("id");
		expect(names).toContain("user_id");
		expect(names).toContain("status");
		expect(names).toContain("reason");
		expect(names).toContain("purge_after");
		expect(names).toContain("claimed_at");
		expect(names).toContain("retry_count");
	});

	it("data_purge_requests indexes exist", async () => {
		const indexes = await sql.unsafe(
			"SELECT indexname FROM pg_indexes WHERE tablename = " +
				SQ +
				"data_purge_requests" +
				SQ +
				" ORDER BY indexname",
		);
		const names = indexes.map((r: Record<string, string>) => r.indexname);
		expect(names).toContain("idx_data_purge_requests_status");
		expect(names).toContain("idx_data_purge_requests_user_id");
	});
});
