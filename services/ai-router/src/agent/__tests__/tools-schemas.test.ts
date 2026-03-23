import { describe, expect, it } from "vitest";
import { TOOL_ARG_SCHEMAS } from "../tools.js";

describe("TOOL_ARG_SCHEMAS — read-only query tools", () => {
	it("has a schema for query_birthday", () => {
		expect(TOOL_ARG_SCHEMAS.query_birthday).toBeDefined();
	});

	it("validates query_birthday with valid contact_id", () => {
		const result = TOOL_ARG_SCHEMAS.query_birthday.safeParse({ contact_id: 1 });
		expect(result.success).toBe(true);
	});

	it("rejects query_birthday with missing contact_id", () => {
		const result = TOOL_ARG_SCHEMAS.query_birthday.safeParse({});
		expect(result.success).toBe(false);
	});

	it("rejects query_birthday with negative contact_id", () => {
		const result = TOOL_ARG_SCHEMAS.query_birthday.safeParse({ contact_id: -1 });
		expect(result.success).toBe(false);
	});

	it("has a schema for query_phone", () => {
		expect(TOOL_ARG_SCHEMAS.query_phone).toBeDefined();
	});

	it("validates query_phone with valid contact_id", () => {
		const result = TOOL_ARG_SCHEMAS.query_phone.safeParse({ contact_id: 42 });
		expect(result.success).toBe(true);
	});

	it("rejects query_phone with missing contact_id", () => {
		const result = TOOL_ARG_SCHEMAS.query_phone.safeParse({});
		expect(result.success).toBe(false);
	});

	it("has a schema for query_last_note", () => {
		expect(TOOL_ARG_SCHEMAS.query_last_note).toBeDefined();
	});

	it("validates query_last_note with valid contact_id", () => {
		const result = TOOL_ARG_SCHEMAS.query_last_note.safeParse({ contact_id: 5 });
		expect(result.success).toBe(true);
	});

	it("rejects query_last_note with missing contact_id", () => {
		const result = TOOL_ARG_SCHEMAS.query_last_note.safeParse({});
		expect(result.success).toBe(false);
	});
});
