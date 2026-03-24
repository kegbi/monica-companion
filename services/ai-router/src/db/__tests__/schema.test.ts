import { getTableColumns, getTableName } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { conversationHistory } from "../schema.js";

describe("conversationHistory table schema", () => {
	it("has the correct table name", () => {
		expect(getTableName(conversationHistory)).toBe("conversation_history");
	});

	it("has all required columns", () => {
		const columns = getTableColumns(conversationHistory);
		expect(columns).toHaveProperty("id");
		expect(columns).toHaveProperty("userId");
		expect(columns).toHaveProperty("messages");
		expect(columns).toHaveProperty("pendingToolCall");
		expect(columns).toHaveProperty("updatedAt");
	});

	it("id column is a uuid with default", () => {
		const columns = getTableColumns(conversationHistory);
		expect(columns.id.dataType).toBe("string");
		expect(columns.id.hasDefault).toBe(true);
	});

	it("userId column is not null", () => {
		const columns = getTableColumns(conversationHistory);
		expect(columns.userId.notNull).toBe(true);
	});

	it("messages column is not null with default", () => {
		const columns = getTableColumns(conversationHistory);
		expect(columns.messages.notNull).toBe(true);
		expect(columns.messages.hasDefault).toBe(true);
	});

	it("pendingToolCall column is nullable", () => {
		const columns = getTableColumns(conversationHistory);
		expect(columns.pendingToolCall.notNull).toBe(false);
	});

	it("updatedAt column is not null with default", () => {
		const columns = getTableColumns(conversationHistory);
		expect(columns.updatedAt.notNull).toBe(true);
		expect(columns.updatedAt.hasDefault).toBe(true);
	});

	it("has exactly 5 columns", () => {
		const columns = getTableColumns(conversationHistory);
		expect(Object.keys(columns)).toHaveLength(5);
	});
});
