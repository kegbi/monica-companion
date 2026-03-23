import { eq } from "drizzle-orm";
import type { Database } from "../db/connection.js";
import { conversationHistory, conversationTurns, pendingCommands } from "../db/schema.js";

/**
 * Purge all conversation turns for a specific user.
 * Returns the number of deleted rows.
 */
export async function purgeUserConversationTurns(db: Database, userId: string): Promise<number> {
	const result = await db.delete(conversationTurns).where(eq(conversationTurns.userId, userId));
	return (result as unknown as { count: number }).count;
}

/**
 * Purge all pending commands for a specific user (regardless of status/age).
 * Returns the number of deleted rows.
 */
export async function purgeUserPendingCommands(db: Database, userId: string): Promise<number> {
	const result = await db.delete(pendingCommands).where(eq(pendingCommands.userId, userId));
	return (result as unknown as { count: number }).count;
}

/**
 * Purge conversation history for a specific user.
 * Returns the number of deleted rows.
 */
export async function purgeUserConversationHistory(db: Database, userId: string): Promise<number> {
	const result = await db.delete(conversationHistory).where(eq(conversationHistory.userId, userId));
	return (result as unknown as { count: number }).count;
}
