import { and, isNotNull, lt } from "drizzle-orm";
import type { Database } from "../db/connection.js";
import { conversationHistory, conversationTurns, pendingCommands } from "../db/schema.js";

/**
 * Purge conversation turns older than the cutoff date.
 * Returns the number of deleted rows.
 */
export async function purgeExpiredConversationTurns(
	db: Database,
	cutoffDate: Date,
): Promise<number> {
	const result = await db
		.delete(conversationTurns)
		.where(lt(conversationTurns.createdAt, cutoffDate));
	return (result as unknown as { count: number }).count;
}

/**
 * Purge terminal pending commands older than the cutoff date.
 * Only commands that have reached a terminal state (terminal_at IS NOT NULL)
 * and whose terminal_at is before the cutoff are deleted.
 * Active commands are never touched.
 * Returns the number of deleted rows.
 */
export async function purgeExpiredPendingCommands(db: Database, cutoffDate: Date): Promise<number> {
	const result = await db
		.delete(pendingCommands)
		.where(and(isNotNull(pendingCommands.terminalAt), lt(pendingCommands.terminalAt, cutoffDate)));
	return (result as unknown as { count: number }).count;
}

/**
 * Purge conversation history records older than the cutoff date.
 * Returns the number of deleted rows.
 */
export async function purgeExpiredConversationHistory(
	db: Database,
	cutoffDate: Date,
): Promise<number> {
	const result = await db
		.delete(conversationHistory)
		.where(lt(conversationHistory.updatedAt, cutoffDate));
	return (result as unknown as { count: number }).count;
}
