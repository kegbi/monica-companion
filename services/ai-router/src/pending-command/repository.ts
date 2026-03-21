import type { MutatingCommandPayload, PendingCommandStatus } from "@monica-companion/types";
import { and, desc, eq, inArray, lte, sql } from "drizzle-orm";
import type { Database } from "../db/connection.js";
import { pendingCommands } from "../db/schema.js";
import { assertTransition, isTerminal } from "./state-machine.js";

export interface CreatePendingCommandParams {
	userId: string;
	commandType: string;
	payload: MutatingCommandPayload;
	sourceMessageRef: string;
	correlationId: string;
	ttlMinutes: number;
}

export type PendingCommandRow = typeof pendingCommands.$inferSelect;

/**
 * Create a new pending command in draft status.
 */
export async function createPendingCommand(
	db: Database,
	params: CreatePendingCommandParams,
): Promise<PendingCommandRow> {
	const expiresAt = new Date(Date.now() + params.ttlMinutes * 60 * 1000);

	const [row] = await db
		.insert(pendingCommands)
		.values({
			userId: params.userId,
			commandType: params.commandType,
			payload: params.payload,
			sourceMessageRef: params.sourceMessageRef,
			correlationId: params.correlationId,
			expiresAt,
		})
		.returning();

	return row;
}

/**
 * Fetch a pending command by ID.
 * Returns null if not found.
 */
export async function getPendingCommand(
	db: Database,
	id: string,
): Promise<PendingCommandRow | null> {
	const rows = await db.select().from(pendingCommands).where(eq(pendingCommands.id, id)).limit(1);

	return rows[0] ?? null;
}

/**
 * Fetch the most recent active (non-terminal) pending command for a user.
 * Returns null if no active command exists.
 */
export async function getActivePendingCommandForUser(
	db: Database,
	userId: string,
): Promise<PendingCommandRow | null> {
	const activeStatuses: PendingCommandStatus[] = ["draft", "pending_confirmation", "confirmed"];

	const rows = await db
		.select()
		.from(pendingCommands)
		.where(and(eq(pendingCommands.userId, userId), inArray(pendingCommands.status, activeStatuses)))
		.orderBy(desc(pendingCommands.createdAt))
		.limit(1);

	return rows[0] ?? null;
}

/**
 * Atomically transition a pending command's status.
 * Uses optimistic concurrency control via version check.
 *
 * Returns the updated row, or null if the version/status didn't match
 * (indicating a concurrent modification).
 *
 * Throws if the transition is invalid per the state machine.
 */
export async function transitionStatus(
	db: Database,
	id: string,
	expectedVersion: number,
	from: PendingCommandStatus,
	to: PendingCommandStatus,
): Promise<PendingCommandRow | null> {
	// Validate the transition before touching the DB
	assertTransition(from, to);

	const now = new Date();
	const updates: Record<string, unknown> = {
		status: to,
		version: sql`${pendingCommands.version} + 1`,
		updatedAt: now,
	};

	if (to === "confirmed") {
		updates.confirmedAt = now;
	}
	if (to === "executed") {
		updates.executedAt = now;
	}
	if (isTerminal(to)) {
		updates.terminalAt = now;
	}

	const rows = await db
		.update(pendingCommands)
		.set(updates)
		.where(
			and(
				eq(pendingCommands.id, id),
				eq(pendingCommands.version, expectedVersion),
				eq(pendingCommands.status, from),
			),
		)
		.returning();

	return rows[0] ?? null;
}

/**
 * Update the payload of a draft pending command.
 * Also bumps the version and refreshes the TTL.
 *
 * Returns the updated row, or null if the version/status didn't match.
 * Only works on commands in 'draft' status.
 */
export async function updateDraftPayload(
	db: Database,
	id: string,
	expectedVersion: number,
	newPayload: MutatingCommandPayload,
	ttlMinutes: number,
): Promise<PendingCommandRow | null> {
	const now = new Date();
	const expiresAt = new Date(now.getTime() + ttlMinutes * 60 * 1000);

	const rows = await db
		.update(pendingCommands)
		.set({
			payload: newPayload,
			version: sql`${pendingCommands.version} + 1`,
			updatedAt: now,
			expiresAt,
		})
		.where(
			and(
				eq(pendingCommands.id, id),
				eq(pendingCommands.version, expectedVersion),
				eq(pendingCommands.status, "draft"),
			),
		)
		.returning();

	return rows[0] ?? null;
}

/**
 * Update the narrowing context on a draft pending command.
 * Also bumps the version and updatedAt.
 *
 * Returns the updated row, or null if the version/status didn't match.
 * Only works on commands in 'draft' status.
 */
export async function updateNarrowingContext(
	db: Database,
	id: string,
	expectedVersion: number,
	narrowingContext: Record<string, unknown>,
): Promise<PendingCommandRow | null> {
	const now = new Date();

	const rows = await db
		.update(pendingCommands)
		.set({
			narrowingContext,
			version: sql`${pendingCommands.version} + 1`,
			updatedAt: now,
		})
		.where(
			and(
				eq(pendingCommands.id, id),
				eq(pendingCommands.version, expectedVersion),
				eq(pendingCommands.status, "draft"),
			),
		)
		.returning();

	return rows[0] ?? null;
}

/**
 * Clear the narrowing context on a pending command.
 * Idempotent: sets the column to null regardless of current value.
 *
 * Returns the updated row, or null if the command was not found.
 */
export async function clearNarrowingContext(
	db: Database,
	id: string,
): Promise<PendingCommandRow | null> {
	const rows = await db
		.update(pendingCommands)
		.set({
			narrowingContext: null,
		})
		.where(eq(pendingCommands.id, id))
		.returning();

	return rows[0] ?? null;
}

/**
 * Expire all stale pending commands that have passed their TTL.
 * Only transitions active (non-terminal) commands.
 * Returns the number of expired commands.
 */
export async function expireStaleCommands(db: Database, now: Date): Promise<number> {
	const activeStatuses: PendingCommandStatus[] = ["draft", "pending_confirmation", "confirmed"];

	const rows = await db
		.update(pendingCommands)
		.set({
			status: "expired",
			terminalAt: now,
			updatedAt: now,
		})
		.where(
			and(lte(pendingCommands.expiresAt, now), inArray(pendingCommands.status, activeStatuses)),
		)
		.returning();

	return rows.length;
}
