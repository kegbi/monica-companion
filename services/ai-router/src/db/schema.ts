/**
 * Drizzle schema for the ai-router service.
 *
 * Table ownership: All tables in this file are owned by ai-router.
 * No other service should read or write these tables directly.
 */

import { sql } from "drizzle-orm";
import { index, jsonb, pgTable, timestamp, unique, uuid } from "drizzle-orm/pg-core";

/**
 * Conversation history table for the agent loop.
 * Stores the full OpenAI-format message array per user as JSONB,
 * plus an optional pending tool call for confirmation guardrails.
 * One row per user (upserted on each agent loop invocation).
 *
 * user_id references users in user-management's table but has no FK constraint
 * because it is a cross-service reference. Application-level validation suffices for V1.
 */
export const conversationHistory = pgTable(
	"conversation_history",
	{
		id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
		userId: uuid("user_id").notNull(),
		messages: jsonb("messages").notNull().default(sql`'[]'::jsonb`),
		pendingToolCall: jsonb("pending_tool_call"),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(table) => [
		unique("uq_conversation_history_user_id").on(table.userId),
		index("idx_conversation_history_updated_at").on(table.updatedAt),
	],
);
