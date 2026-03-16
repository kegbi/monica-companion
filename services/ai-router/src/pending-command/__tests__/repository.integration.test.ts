import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDb, type Database } from "../../db/connection.js";
import { pendingCommands } from "../../db/schema.js";
import {
	createPendingCommand,
	expireStaleCommands,
	getActivePendingCommandForUser,
	getPendingCommand,
	transitionStatus,
	updateDraftPayload,
} from "../repository.js";

const TEST_DB_URL =
	process.env.TEST_DATABASE_URL ?? "postgresql://monica:monica_dev@localhost:5432/monica_companion";

describe("pending-command repository (integration)", () => {
	let db: Database;

	beforeAll(async () => {
		db = createDb(TEST_DB_URL);
		// Ensure the table exists (use drizzle push or create manually)
		await db.execute(sql`
			CREATE TABLE IF NOT EXISTS pending_commands (
				id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
				user_id UUID NOT NULL,
				command_type TEXT NOT NULL,
				payload JSONB NOT NULL,
				status TEXT NOT NULL DEFAULT 'draft',
				version INTEGER NOT NULL DEFAULT 1,
				source_message_ref TEXT NOT NULL,
				correlation_id TEXT NOT NULL,
				created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
				updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
				expires_at TIMESTAMPTZ NOT NULL,
				confirmed_at TIMESTAMPTZ,
				executed_at TIMESTAMPTZ,
				terminal_at TIMESTAMPTZ,
				execution_result JSONB
			)
		`);
		await db.execute(
			sql`CREATE INDEX IF NOT EXISTS idx_pending_commands_user_status ON pending_commands (user_id, status)`,
		);
		await db.execute(
			sql`CREATE INDEX IF NOT EXISTS idx_pending_commands_expires_at ON pending_commands (expires_at)`,
		);
	});

	beforeEach(async () => {
		await db.delete(pendingCommands);
	});

	afterAll(async () => {
		await db.execute(sql`DROP TABLE IF EXISTS pending_commands CASCADE`);
	});

	const makeParams = (overrides: Record<string, unknown> = {}) => ({
		userId: randomUUID(),
		commandType: "create_note" as const,
		payload: { type: "create_note" as const, contactId: 42, body: "Test note" },
		sourceMessageRef: "telegram:msg:12345",
		correlationId: randomUUID(),
		ttlMinutes: 30,
		...overrides,
	});

	describe("createPendingCommand", () => {
		it("creates a draft pending command", async () => {
			const params = makeParams();
			const record = await createPendingCommand(db, params);

			expect(record.id).toBeDefined();
			expect(record.userId).toBe(params.userId);
			expect(record.commandType).toBe("create_note");
			expect(record.payload).toEqual(params.payload);
			expect(record.status).toBe("draft");
			expect(record.version).toBe(1);
			expect(record.sourceMessageRef).toBe(params.sourceMessageRef);
			expect(record.correlationId).toBe(params.correlationId);
			expect(record.expiresAt).toBeDefined();
			expect(record.confirmedAt).toBeNull();
			expect(record.executedAt).toBeNull();
			expect(record.terminalAt).toBeNull();
		});

		it("sets expiresAt based on ttlMinutes", async () => {
			const params = makeParams({ ttlMinutes: 15 });
			const before = new Date();
			const record = await createPendingCommand(db, params);
			const after = new Date();

			const expectedMin = new Date(before.getTime() + 15 * 60 * 1000);
			const expectedMax = new Date(after.getTime() + 15 * 60 * 1000);

			expect(record.expiresAt.getTime()).toBeGreaterThanOrEqual(expectedMin.getTime() - 1000);
			expect(record.expiresAt.getTime()).toBeLessThanOrEqual(expectedMax.getTime() + 1000);
		});
	});

	describe("getPendingCommand", () => {
		it("returns the command by ID", async () => {
			const params = makeParams();
			const created = await createPendingCommand(db, params);
			const found = await getPendingCommand(db, created.id);

			expect(found).not.toBeNull();
			expect(found!.id).toBe(created.id);
			expect(found!.payload).toEqual(params.payload);
		});

		it("returns null for non-existent ID", async () => {
			const found = await getPendingCommand(db, randomUUID());
			expect(found).toBeNull();
		});
	});

	describe("getActivePendingCommandForUser", () => {
		it("returns the most recent active command for a user", async () => {
			const userId = randomUUID();
			await createPendingCommand(db, makeParams({ userId }));
			const second = await createPendingCommand(db, makeParams({ userId }));

			const found = await getActivePendingCommandForUser(db, userId);
			expect(found).not.toBeNull();
			expect(found!.id).toBe(second.id);
		});

		it("excludes terminal commands", async () => {
			const userId = randomUUID();
			const cmd = await createPendingCommand(db, makeParams({ userId }));

			// Transition to expired (terminal)
			await transitionStatus(db, cmd.id, 1, "draft", "expired");

			const found = await getActivePendingCommandForUser(db, userId);
			expect(found).toBeNull();
		});

		it("returns null when user has no commands", async () => {
			const found = await getActivePendingCommandForUser(db, randomUUID());
			expect(found).toBeNull();
		});
	});

	describe("transitionStatus", () => {
		it("transitions from draft to pending_confirmation", async () => {
			const cmd = await createPendingCommand(db, makeParams());
			const updated = await transitionStatus(db, cmd.id, 1, "draft", "pending_confirmation");

			expect(updated).not.toBeNull();
			expect(updated!.status).toBe("pending_confirmation");
			expect(updated!.version).toBe(2);
		});

		it("transitions from pending_confirmation to confirmed and sets confirmedAt", async () => {
			const cmd = await createPendingCommand(db, makeParams());
			await transitionStatus(db, cmd.id, 1, "draft", "pending_confirmation");
			const confirmed = await transitionStatus(db, cmd.id, 2, "pending_confirmation", "confirmed");

			expect(confirmed).not.toBeNull();
			expect(confirmed!.status).toBe("confirmed");
			expect(confirmed!.confirmedAt).not.toBeNull();
		});

		it("transitions to terminal state and sets terminalAt", async () => {
			const cmd = await createPendingCommand(db, makeParams());
			const cancelled = await transitionStatus(db, cmd.id, 1, "draft", "cancelled");

			expect(cancelled).not.toBeNull();
			expect(cancelled!.status).toBe("cancelled");
			expect(cancelled!.terminalAt).not.toBeNull();
		});

		it("transitions to executed and sets executedAt and terminalAt", async () => {
			const cmd = await createPendingCommand(db, makeParams());
			await transitionStatus(db, cmd.id, 1, "draft", "pending_confirmation");
			await transitionStatus(db, cmd.id, 2, "pending_confirmation", "confirmed");
			const executed = await transitionStatus(db, cmd.id, 3, "confirmed", "executed");

			expect(executed).not.toBeNull();
			expect(executed!.status).toBe("executed");
			expect(executed!.executedAt).not.toBeNull();
			expect(executed!.terminalAt).not.toBeNull();
		});

		it("returns null on version mismatch (optimistic concurrency)", async () => {
			const cmd = await createPendingCommand(db, makeParams());
			const result = await transitionStatus(db, cmd.id, 999, "draft", "pending_confirmation");

			expect(result).toBeNull();
		});

		it("returns null on status mismatch", async () => {
			const cmd = await createPendingCommand(db, makeParams());
			const result = await transitionStatus(db, cmd.id, 1, "pending_confirmation", "confirmed");

			expect(result).toBeNull();
		});

		it("rejects invalid state transitions", async () => {
			const cmd = await createPendingCommand(db, makeParams());
			await expect(transitionStatus(db, cmd.id, 1, "draft", "executed")).rejects.toThrow(
				"Invalid transition",
			);
		});

		it("concurrent version conflict: exactly one succeeds", async () => {
			const cmd = await createPendingCommand(db, makeParams());

			const [result1, result2] = await Promise.all([
				transitionStatus(db, cmd.id, 1, "draft", "pending_confirmation"),
				transitionStatus(db, cmd.id, 1, "draft", "pending_confirmation"),
			]);

			const successes = [result1, result2].filter((r) => r !== null);
			const failures = [result1, result2].filter((r) => r === null);

			expect(successes).toHaveLength(1);
			expect(failures).toHaveLength(1);
			expect(successes[0]!.version).toBe(2);
		});
	});

	describe("updateDraftPayload", () => {
		it("updates the payload and bumps version", async () => {
			const cmd = await createPendingCommand(db, makeParams());
			const newPayload = { type: "create_note" as const, contactId: 99, body: "Updated note" };
			const updated = await updateDraftPayload(db, cmd.id, 1, newPayload, 30);

			expect(updated).not.toBeNull();
			expect(updated!.payload).toEqual(newPayload);
			expect(updated!.version).toBe(2);
		});

		it("refreshes expiresAt on update", async () => {
			const cmd = await createPendingCommand(db, makeParams({ ttlMinutes: 1 }));
			const originalExpiry = cmd.expiresAt;

			const newPayload = { type: "create_note" as const, contactId: 99, body: "Updated" };
			const updated = await updateDraftPayload(db, cmd.id, 1, newPayload, 30);

			expect(updated).not.toBeNull();
			expect(updated!.expiresAt.getTime()).toBeGreaterThan(originalExpiry.getTime());
		});

		it("returns null on version mismatch", async () => {
			const cmd = await createPendingCommand(db, makeParams());
			const newPayload = { type: "create_note" as const, contactId: 99, body: "Updated" };
			const result = await updateDraftPayload(db, cmd.id, 999, newPayload, 30);

			expect(result).toBeNull();
		});

		it("returns null for non-draft commands", async () => {
			const cmd = await createPendingCommand(db, makeParams());
			await transitionStatus(db, cmd.id, 1, "draft", "pending_confirmation");

			const newPayload = { type: "create_note" as const, contactId: 99, body: "Updated" };
			const result = await updateDraftPayload(db, cmd.id, 2, newPayload, 30);

			expect(result).toBeNull();
		});
	});

	describe("expireStaleCommands", () => {
		it("expires commands past their TTL", async () => {
			// Create a command with TTL already in the past
			const cmd = await createPendingCommand(db, makeParams({ ttlMinutes: 0 }));

			// Manually set expiresAt to the past
			await db
				.update(pendingCommands)
				.set({ expiresAt: new Date(Date.now() - 60000) })
				.where(sql`id = ${cmd.id}`);

			const count = await expireStaleCommands(db, new Date());
			expect(count).toBe(1);

			const expired = await getPendingCommand(db, cmd.id);
			expect(expired!.status).toBe("expired");
			expect(expired!.terminalAt).not.toBeNull();
		});

		it("does not expire commands still within TTL", async () => {
			await createPendingCommand(db, makeParams({ ttlMinutes: 60 }));

			const count = await expireStaleCommands(db, new Date());
			expect(count).toBe(0);
		});

		it("does not expire already terminal commands", async () => {
			const cmd = await createPendingCommand(db, makeParams());
			await transitionStatus(db, cmd.id, 1, "draft", "cancelled");

			// Set expiresAt to the past
			await db
				.update(pendingCommands)
				.set({ expiresAt: new Date(Date.now() - 60000) })
				.where(sql`id = ${cmd.id}`);

			const count = await expireStaleCommands(db, new Date());
			expect(count).toBe(0);
		});
	});
});
