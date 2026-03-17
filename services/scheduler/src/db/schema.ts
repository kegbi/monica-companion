import { sql } from "drizzle-orm";
import { integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

export const commandExecutions = pgTable("command_executions", {
	id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
	pendingCommandId: uuid("pending_command_id").notNull(),
	idempotencyKey: text("idempotency_key").unique().notNull(),
	userId: uuid("user_id").notNull(),
	commandType: text("command_type").notNull(),
	payload: jsonb("payload").notNull(),
	status: text("status").notNull().default("queued"),
	correlationId: text("correlation_id").notNull(),
	attemptCount: integer("attempt_count").notNull().default(0),
	lastError: text("last_error"),
	queuedAt: timestamp("queued_at", { withTimezone: true }).notNull().defaultNow(),
	startedAt: timestamp("started_at", { withTimezone: true }),
	completedAt: timestamp("completed_at", { withTimezone: true }),
	createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const reminderWindows = pgTable(
	"reminder_windows",
	{
		id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
		userId: uuid("user_id").notNull(),
		dedupeKey: text("dedupe_key").notNull(),
		cadence: text("cadence").notNull(),
		scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
		firedAt: timestamp("fired_at", { withTimezone: true }),
		status: text("status").notNull().default("pending"),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(table) => [uniqueIndex("idx_reminder_windows_dedupe_key").on(table.dedupeKey)],
);
