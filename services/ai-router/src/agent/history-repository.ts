import { eq, lt } from "drizzle-orm";
import type { Database } from "../db/connection.js";
import { conversationHistory } from "../db/schema.js";

/** Maximum number of messages retained in the sliding window. */
export const SLIDING_WINDOW_SIZE = 40;

export interface ConversationHistoryRow {
	id: string;
	userId: string;
	messages: unknown;
	pendingToolCall: unknown;
	updatedAt: Date;
}

/**
 * Retrieve the conversation history for a user.
 * Returns null if no history exists.
 */
export async function getHistory(
	db: Database,
	userId: string,
): Promise<ConversationHistoryRow | null> {
	const rows = await db
		.select()
		.from(conversationHistory)
		.where(eq(conversationHistory.userId, userId))
		.limit(1);
	return rows[0] ?? null;
}

/**
 * Upsert conversation history for a user.
 * Applies sliding window truncation to keep at most SLIDING_WINDOW_SIZE messages.
 */
export async function saveHistory(
	db: Database,
	userId: string,
	messages: unknown[],
	pendingToolCall: unknown,
): Promise<void> {
	const truncated = messages.slice(-SLIDING_WINDOW_SIZE);

	await db
		.insert(conversationHistory)
		.values({
			userId,
			messages: truncated,
			pendingToolCall,
			updatedAt: new Date(),
		})
		.onConflictDoUpdate({
			target: conversationHistory.userId,
			set: {
				messages: truncated,
				pendingToolCall,
				updatedAt: new Date(),
			},
		});
}

/**
 * Delete conversation history for a specific user.
 * Returns the number of deleted rows.
 */
export async function clearHistory(db: Database, userId: string): Promise<number> {
	const result = await db.delete(conversationHistory).where(eq(conversationHistory.userId, userId));
	return (result as unknown as { count: number }).count;
}

/**
 * Delete all conversation histories that have not been updated since the cutoff date.
 * Used by the inactivity sweep.
 * Returns the number of deleted rows.
 */
export async function clearStaleHistories(db: Database, cutoffDate: Date): Promise<number> {
	const result = await db
		.delete(conversationHistory)
		.where(lt(conversationHistory.updatedAt, cutoffDate));
	return (result as unknown as { count: number }).count;
}
