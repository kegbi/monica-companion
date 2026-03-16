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

// --- User tables (least-privilege user management) ---

export const users = pgTable("users", {
	id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
	telegramUserId: text("telegram_user_id").unique().notNull(),
	monicaBaseUrl: text("monica_base_url").notNull(),
	monicaApiTokenEncrypted: text("monica_api_token_encrypted").notNull(),
	encryptionKeyId: text("encryption_key_id").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const userPreferences = pgTable("user_preferences", {
	id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
	userId: uuid("user_id")
		.notNull()
		.unique()
		.references(() => users.id),
	language: text("language").notNull().default("en"),
	confirmationMode: text("confirmation_mode").notNull().default("explicit"),
	timezone: text("timezone").notNull(),
	reminderCadence: text("reminder_cadence").notNull().default("daily"),
	reminderTime: text("reminder_time").notNull().default("08:00"),
	connectorType: text("connector_type").notNull().default("telegram"),
	connectorRoutingId: text("connector_routing_id").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const credentialAccessAuditLog = pgTable(
	"credential_access_audit_log",
	{
		id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
		userId: uuid("user_id")
			.notNull()
			.references(() => users.id),
		actorService: text("actor_service").notNull(),
		correlationId: text("correlation_id"),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(table) => [
		index("idx_credential_audit_user_id").on(table.userId),
		index("idx_credential_audit_created_at").on(table.createdAt),
	],
);
