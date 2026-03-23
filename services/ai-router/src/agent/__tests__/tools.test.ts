import { describe, expect, it } from "vitest";
import { MUTATING_TOOLS, READ_ONLY_TOOLS, TOOL_DEFINITIONS } from "../tools.js";

describe("tool definitions", () => {
	it("exports 11 tool definitions", () => {
		expect(TOOL_DEFINITIONS).toHaveLength(11);
	});

	it("all definitions have type 'function'", () => {
		for (const tool of TOOL_DEFINITIONS) {
			expect(tool.type).toBe("function");
		}
	});

	it("all definitions have name, description, and parameters", () => {
		for (const tool of TOOL_DEFINITIONS) {
			expect(tool.function.name).toBeTruthy();
			expect(tool.function.description).toBeTruthy();
			expect(tool.function.parameters).toBeDefined();
		}
	});

	it("READ_ONLY_TOOLS contains exactly 4 tools including search_contacts", () => {
		expect(READ_ONLY_TOOLS.size).toBe(4);
		expect(READ_ONLY_TOOLS.has("search_contacts")).toBe(true);
		expect(READ_ONLY_TOOLS.has("query_birthday")).toBe(true);
		expect(READ_ONLY_TOOLS.has("query_phone")).toBe(true);
		expect(READ_ONLY_TOOLS.has("query_last_note")).toBe(true);
	});

	it("MUTATING_TOOLS contains exactly 7 tools", () => {
		expect(MUTATING_TOOLS.size).toBe(7);
		expect(MUTATING_TOOLS.has("create_note")).toBe(true);
		expect(MUTATING_TOOLS.has("create_contact")).toBe(true);
		expect(MUTATING_TOOLS.has("create_activity")).toBe(true);
		expect(MUTATING_TOOLS.has("update_contact_birthday")).toBe(true);
		expect(MUTATING_TOOLS.has("update_contact_phone")).toBe(true);
		expect(MUTATING_TOOLS.has("update_contact_email")).toBe(true);
		expect(MUTATING_TOOLS.has("update_contact_address")).toBe(true);
	});

	it("every tool definition name is in exactly one of MUTATING_TOOLS or READ_ONLY_TOOLS", () => {
		for (const tool of TOOL_DEFINITIONS) {
			const name = tool.function.name;
			const inMutating = MUTATING_TOOLS.has(name);
			const inReadOnly = READ_ONLY_TOOLS.has(name);
			expect(
				(inMutating && !inReadOnly) || (!inMutating && inReadOnly),
				`Tool "${name}" should be in exactly one set`,
			).toBe(true);
		}
	});

	it("no overlap between MUTATING_TOOLS and READ_ONLY_TOOLS", () => {
		for (const name of MUTATING_TOOLS) {
			expect(READ_ONLY_TOOLS.has(name)).toBe(false);
		}
	});

	it("total of MUTATING_TOOLS + READ_ONLY_TOOLS equals 11", () => {
		expect(MUTATING_TOOLS.size + READ_ONLY_TOOLS.size).toBe(11);
	});
});
