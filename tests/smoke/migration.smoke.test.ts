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

	it("ai-router tables exist (conversation_turns, pending_commands)", async () => {
		const tables = await sql`
			SELECT table_name FROM information_schema.tables
			WHERE table_schema = 'public'
			AND table_name IN ('conversation_turns', 'pending_commands')
			ORDER BY table_name
		`;
		expect(tables.map((r) => r.table_name)).toEqual(["conversation_turns", "pending_commands"]);
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

	it("conversation_turns has expected indexes", async () => {
		const indexes = await sql`
			SELECT indexname FROM pg_indexes
			WHERE tablename = 'conversation_turns'
			ORDER BY indexname
		`;
		const names = indexes.map((r) => r.indexname);
		expect(names).toContain("idx_conversation_turns_user_created");
		expect(names).toContain("idx_conversation_turns_created_at");
	});

	it("pending_commands has narrowing_context column (progressive narrowing migration)", async () => {
		const columns = await sql`
			SELECT column_name, data_type, is_nullable
			FROM information_schema.columns
			WHERE table_name = 'pending_commands'
			AND column_name = 'narrowing_context'
		`;
		expect(columns).toHaveLength(1);
		expect(columns[0].data_type).toBe("jsonb");
		expect(columns[0].is_nullable).toBe("YES");
	});

	afterAll(async () => {
		await sql.end();
	});
});
