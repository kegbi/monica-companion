import { lt } from "drizzle-orm";
import type { Database } from "../db/connection.js";
import { conversationHistory } from "../db/schema.js";

/**
 * Purge conversation history records older than the cutoff date.
 * Returns the number of deleted rows.
 *
 * This is the sole retention cleanup function for ai-router after
 * the legacy conversationTurns and pendingCommands tables were dropped
 * in migration 0004.
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
