import { getTableColumns, getTableName } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { conversationTurns } from "../schema.js";

describe("conversationTurns table schema", () => {
	it("has the correct table name", () => {
		expect(getTableName(conversationTurns)).toBe("conversation_turns");
	});

	it("has all required columns", () => {
		const columns = getTableColumns(conversationTurns);
		expect(columns).toHaveProperty("id");
		expect(columns).toHaveProperty("userId");
		expect(columns).toHaveProperty("role");
		expect(columns).toHaveProperty("summary");
		expect(columns).toHaveProperty("correlationId");
		expect(columns).toHaveProperty("createdAt");
	});

	it("id column is a uuid with default", () => {
		const columns = getTableColumns(conversationTurns);
		expect(columns.id.dataType).toBe("string");
		expect(columns.id.hasDefault).toBe(true);
	});

	it("userId column is not null", () => {
		const columns = getTableColumns(conversationTurns);
		expect(columns.userId.notNull).toBe(true);
	});

	it("role column is not null text", () => {
		const columns = getTableColumns(conversationTurns);
		expect(columns.role.notNull).toBe(true);
		expect(columns.role.dataType).toBe("string");
	});

	it("summary column is not null text", () => {
		const columns = getTableColumns(conversationTurns);
		expect(columns.summary.notNull).toBe(true);
	});

	it("correlationId column is not null text", () => {
		const columns = getTableColumns(conversationTurns);
		expect(columns.correlationId.notNull).toBe(true);
	});

	it("createdAt column is not null with default", () => {
		const columns = getTableColumns(conversationTurns);
		expect(columns.createdAt.notNull).toBe(true);
		expect(columns.createdAt.hasDefault).toBe(true);
	});

	it("has exactly 6 columns", () => {
		const columns = getTableColumns(conversationTurns);
		expect(Object.keys(columns)).toHaveLength(6);
	});
});
