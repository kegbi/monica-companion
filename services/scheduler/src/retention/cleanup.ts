import { idempotencyKeys } from "@monica-companion/idempotency";
import { and, inArray, lt } from "drizzle-orm";
import type { Database } from "../db/connection";
import { commandExecutions, reminderWindows } from "../db/schema";

/**
 * Purge completed/failed/dead-lettered command executions older than the cutoff date.
 * Returns the number of deleted rows.
 */
export async function purgeExpiredExecutions(db: Database, cutoffDate: Date): Promise<number> {
	const result = await db
		.delete(commandExecutions)
		.where(
			and(
				lt(commandExecutions.createdAt, cutoffDate),
				inArray(commandExecutions.status, ["completed", "failed", "dead_lettered"]),
			),
		);
	return (result as unknown as { count: number }).count;
}

/**
 * Purge expired idempotency keys (keys whose expires_at is before the cutoff).
 * These keys are already expired, so deletion is safe.
 * Returns the number of deleted rows.
 */
export async function purgeExpiredIdempotencyKeys(db: Database, cutoffDate: Date): Promise<number> {
	const result = await db.delete(idempotencyKeys).where(lt(idempotencyKeys.expiresAt, cutoffDate));
	return (result as unknown as { count: number }).count;
}

/**
 * Purge fired/skipped reminder windows older than the cutoff date.
 * Returns the number of deleted rows.
 */
export async function purgeExpiredReminderWindows(db: Database, cutoffDate: Date): Promise<number> {
	const result = await db
		.delete(reminderWindows)
		.where(
			and(
				lt(reminderWindows.createdAt, cutoffDate),
				inArray(reminderWindows.status, ["fired", "skipped"]),
			),
		);
	return (result as unknown as { count: number }).count;
}
