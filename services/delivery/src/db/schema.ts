import { sql } from "drizzle-orm";
import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const deliveryAudits = pgTable(
	"delivery_audits",
	{
		id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
		correlationId: text("correlation_id").notNull(),
		userId: text("user_id").notNull(),
		connectorType: text("connector_type").notNull(),
		connectorRoutingId: text("connector_routing_id").notNull(),
		contentType: text("content_type").notNull(),
		status: text("status").notNull().default("pending"),
		error: text("error"),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		completedAt: timestamp("completed_at", { withTimezone: true }),
	},
	(table) => [
		index("idx_delivery_audits_user_created").on(table.userId, table.createdAt),
		index("idx_delivery_audits_correlation").on(table.correlationId),
	],
);
