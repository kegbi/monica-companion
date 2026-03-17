import { jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Drizzle table definition for idempotency keys.
 * Migration ownership: This table is created by the scheduler service migration
 * since scheduler is the primary consumer in V1. If other services need
 * idempotency in the future, the migration should move to a shared location.
 */
export const idempotencyKeys = pgTable("idempotency_keys", {
	key: text("key").primaryKey(),
	status: text("status").notNull().default("in_progress"),
	claimedAt: timestamp("claimed_at", { withTimezone: true }).notNull().defaultNow(),
	completedAt: timestamp("completed_at", { withTimezone: true }),
	result: jsonb("result"),
	expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});
