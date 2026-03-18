/**
 * Repository for conversation_turns table operations.
 *
 * Provides functions to read recent turn summaries and insert new ones.
 * Only compressed summaries are stored -- never raw utterances or full LLM responses.
 */

import { desc, eq } from "drizzle-orm";
import type { TurnSummary } from "../graph/state.js";
import type { Database } from "./connection.js";
import { conversationTurns } from "./schema.js";

export interface InsertTurnParams {
	userId: string;
	role: string;
	summary: string;
	correlationId: string;
}

export type ConversationTurnRow = typeof conversationTurns.$inferSelect;

/**
 * Fetch the most recent N turn summaries for a user, returned in
 * chronological order (oldest first) for prompt construction.
 */
export async function getRecentTurns(
	db: Database,
	userId: string,
	limit: number,
): Promise<TurnSummary[]> {
	const rows = await db
		.select()
		.from(conversationTurns)
		.where(eq(conversationTurns.userId, userId))
		.orderBy(desc(conversationTurns.createdAt))
		.limit(limit);

	// Reverse to chronological order (oldest first)
	return rows.reverse().map((row) => ({
		role: row.role as TurnSummary["role"],
		summary: row.summary,
		correlationId: row.correlationId,
		createdAt: row.createdAt.toISOString(),
	}));
}

/**
 * Insert a compressed turn summary row.
 */
export async function insertTurnSummary(
	db: Database,
	params: InsertTurnParams,
): Promise<ConversationTurnRow> {
	const [row] = await db
		.insert(conversationTurns)
		.values({
			userId: params.userId,
			role: params.role,
			summary: params.summary,
			correlationId: params.correlationId,
		})
		.returning();

	return row;
}
