/**
 * Database migration smoke tests.
 *
 * Verifies that auto-migration on startup created all expected
 * tables across all services that own DB schemas.
 */

import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { loadSmokeConfig } from "./smoke-config.js";

const config = loadSmokeConfig();

describe("database auto-migration", () => {
	const sql = postgres(config.POSTGRES_URL, { max: 1 });

	it("ai-router conversation_history table exists (legacy tables dropped by migration 0004)", async () => {
		const tables = await sql`
			SELECT table_name FROM information_schema.tables
			WHERE table_schema = 'public'
			AND table_name IN ('conversation_turns', 'pending_commands', 'conversation_history')
			ORDER BY table_name
		`;
		expect(tables.map((r) => r.table_name)).toEqual(["conversation_history"]);
	});

	it("user-management tables exist (users, setup_tokens, user_preferences)", async () => {
		const tables = await sql`
			SELECT table_name FROM information_schema.tables
			WHERE table_schema = 'public'
			AND table_name IN ('users', 'setup_tokens', 'user_preferences')
			ORDER BY table_name
		`;
		expect(tables.map((r) => r.table_name)).toEqual(["setup_tokens", "user_preferences", "users"]);
	});

	it("per-service migration tracking tables exist", async () => {
		const tables = await sql`
			SELECT table_name FROM information_schema.tables
			WHERE table_schema = 'drizzle'
			AND table_name LIKE '__drizzle_migrations_%'
			ORDER BY table_name
		`;
		const names = tables.map((r) => r.table_name);
		expect(names).toContain("__drizzle_migrations_ai_router");
		expect(names).toContain("__drizzle_migrations_user_management");
	});

	it("legacy conversation_turns table was dropped by migration 0004", async () => {
		const tables = await sql`
			SELECT table_name FROM information_schema.tables
			WHERE table_schema = 'public'
			AND table_name = 'conversation_turns'
		`;
		expect(tables).toHaveLength(0);
	});

	it("legacy pending_commands table was dropped by migration 0004", async () => {
		const tables = await sql`
			SELECT table_name FROM information_schema.tables
			WHERE table_schema = 'public'
			AND table_name = 'pending_commands'
		`;
		expect(tables).toHaveLength(0);
	});

	it("conversation_history has expected columns and constraints", async () => {
		const columns = await sql`
			SELECT column_name, data_type, is_nullable
			FROM information_schema.columns
			WHERE table_name = 'conversation_history'
			ORDER BY column_name
		`;
		const colMap = Object.fromEntries(columns.map((r) => [r.column_name, r]));
		expect(colMap.id).toBeDefined();
		expect(colMap.user_id).toBeDefined();
		expect(colMap.user_id.data_type).toBe("uuid");
		expect(colMap.messages).toBeDefined();
		expect(colMap.messages.data_type).toBe("jsonb");
		expect(colMap.pending_tool_call).toBeDefined();
		expect(colMap.pending_tool_call.data_type).toBe("jsonb");
		expect(colMap.pending_tool_call.is_nullable).toBe("YES");
		expect(colMap.updated_at).toBeDefined();
	});

	it("conversation_history has updated_at index", async () => {
		const indexes = await sql`
			SELECT indexname FROM pg_indexes
			WHERE tablename = 'conversation_history'
			ORDER BY indexname
		`;
		const names = indexes.map((r) => r.indexname);
		expect(names).toContain("idx_conversation_history_updated_at");
	});

	it("conversation_history has unique constraint on user_id", async () => {
		const constraints = await sql`
			SELECT constraint_name FROM information_schema.table_constraints
			WHERE table_name = 'conversation_history'
			AND constraint_type = 'UNIQUE'
		`;
		const names = constraints.map((r) => r.constraint_name);
		expect(names).toContain("uq_conversation_history_user_id");
	});

	afterAll(async () => {
		await sql.end();
	});
});
