import { sql } from "drizzle-orm";
import { index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

export const setupTokens = pgTable(
	"setup_tokens",
	{
		id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
		telegramUserId: text("telegram_user_id").notNull(),
		step: text("step").notNull().default("onboarding"),
		status: text("status").notNull().default("active"),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
		consumedAt: timestamp("consumed_at", { withTimezone: true }),
		invalidatedAt: timestamp("invalidated_at", { withTimezone: true }),
	},
	(table) => [
		uniqueIndex("idx_setup_tokens_active_user")
			.on(table.telegramUserId)
			.where(sql`status = 'active'`),
	],
);

export const setupTokenAuditLog = pgTable(
	"setup_token_audit_log",
	{
		id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
		tokenId: uuid("token_id")
			.notNull()
			.references(() => setupTokens.id),
		event: text("event").notNull(),
		actorService: text("actor_service").notNull(),
		ipAddress: text("ip_address"),
		correlationId: text("correlation_id"),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(table) => [index("idx_audit_log_token_id").on(table.tokenId)],
);
