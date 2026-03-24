import { eq } from "drizzle-orm";
import type { Database } from "../db/connection.js";
import { conversationHistory } from "../db/schema.js";

/**
 * Purge conversation history for a specific user.
 * Returns the number of deleted rows.
 */
export async function purgeUserConversationHistory(db: Database, userId: string): Promise<number> {
	const result = await db.delete(conversationHistory).where(eq(conversationHistory.userId, userId));
	return (result as unknown as { count: number }).count;
}
