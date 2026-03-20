import { eq, sql } from "drizzle-orm";
import type { Database } from "../db/connection";
import { reminderWindows } from "../db/schema";

/**
 * Purge all command executions and their associated idempotency keys for a user.
 * Uses a CTE to atomically collect keys before deleting executions.
 * Returns the counts of deleted rows.
 */
export async function purgeUserCommandExecutionsAndKeys(
	db: Database,
	userId: string,
): Promise<{ commandExecutions: number; idempotencyKeys: number }> {
	const result = await db.execute(
		sql`WITH deleted_executions AS (
			DELETE FROM command_executions WHERE user_id = ${userId} RETURNING idempotency_key
		),
		deleted_keys AS (
			DELETE FROM idempotency_keys WHERE key IN (SELECT idempotency_key FROM deleted_executions) RETURNING key
		)
		SELECT
			(SELECT COUNT(*)::int FROM deleted_executions) AS executions_deleted,
			(SELECT COUNT(*)::int FROM deleted_keys) AS keys_deleted`,
	);

	// Drizzle's execute() returns { rows: [...] } with node-postgres.
	// The CTE always returns exactly one row with COUNT aggregates, but we
	// guard against an empty result set for safety.
	const rows = (
		result as unknown as { rows: Array<{ executions_deleted: number; keys_deleted: number }> }
	).rows;
	const row = rows?.[0];
	return {
		commandExecutions: row?.executions_deleted ?? 0,
		idempotencyKeys: row?.keys_deleted ?? 0,
	};
}

/**
 * Purge all reminder windows for a specific user.
 * Returns the number of deleted rows.
 */
export async function purgeUserReminderWindows(db: Database, userId: string): Promise<number> {
	const result = await db.delete(reminderWindows).where(eq(reminderWindows.userId, userId));
	return (result as unknown as { count: number }).count;
}
