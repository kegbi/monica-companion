import { describe, expect, it } from "vitest";
import {
	generateActionDescription,
	MUTATING_TOOLS,
	READ_ONLY_TOOLS,
	TOOL_ARG_SCHEMAS,
	TOOL_DEFINITIONS,
} from "../tools.js";

describe("tool definitions", () => {
	it("exports 14 tool definitions", () => {
		expect(TOOL_DEFINITIONS).toHaveLength(14);
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

	it("READ_ONLY_TOOLS contains exactly 5 tools including search_contacts", () => {
		expect(READ_ONLY_TOOLS.size).toBe(5);
		expect(READ_ONLY_TOOLS.has("search_contacts")).toBe(true);
		expect(READ_ONLY_TOOLS.has("query_birthday")).toBe(true);
		expect(READ_ONLY_TOOLS.has("query_phone")).toBe(true);
		expect(READ_ONLY_TOOLS.has("query_last_note")).toBe(true);
		expect(READ_ONLY_TOOLS.has("query_today_reminders")).toBe(true);
	});

	it("MUTATING_TOOLS contains exactly 9 tools", () => {
		expect(MUTATING_TOOLS.size).toBe(9);
		expect(MUTATING_TOOLS.has("create_note")).toBe(true);
		expect(MUTATING_TOOLS.has("create_contact")).toBe(true);
		expect(MUTATING_TOOLS.has("create_activity")).toBe(true);
		expect(MUTATING_TOOLS.has("update_contact_birthday")).toBe(true);
		expect(MUTATING_TOOLS.has("update_contact_phone")).toBe(true);
		expect(MUTATING_TOOLS.has("update_contact_email")).toBe(true);
		expect(MUTATING_TOOLS.has("update_contact_address")).toBe(true);
		expect(MUTATING_TOOLS.has("update_contact_nickname")).toBe(true);
		expect(MUTATING_TOOLS.has("delete_contact")).toBe(true);
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

	it("total of MUTATING_TOOLS + READ_ONLY_TOOLS equals TOOL_DEFINITIONS length", () => {
		expect(MUTATING_TOOLS.size + READ_ONLY_TOOLS.size).toBe(TOOL_DEFINITIONS.length);
	});
});

describe("TOOL_ARG_SCHEMAS", () => {
	it("has an entry for every mutating tool", () => {
		for (const name of MUTATING_TOOLS) {
			expect(TOOL_ARG_SCHEMAS).toHaveProperty(name);
		}
	});

	it("has an entry for every read-only tool", () => {
		for (const name of READ_ONLY_TOOLS) {
			expect(TOOL_ARG_SCHEMAS).toHaveProperty(name);
		}
	});

	it("has an entry for search_contacts", () => {
		expect(TOOL_ARG_SCHEMAS).toHaveProperty("search_contacts");
	});

	it("validates valid search_contacts args", () => {
		const result = TOOL_ARG_SCHEMAS.search_contacts.safeParse({
			query: "mom",
		});
		expect(result.success).toBe(true);
	});

	it("rejects search_contacts with empty query", () => {
		const result = TOOL_ARG_SCHEMAS.search_contacts.safeParse({
			query: "",
		});
		expect(result.success).toBe(false);
	});

	it("rejects search_contacts with missing query", () => {
		const result = TOOL_ARG_SCHEMAS.search_contacts.safeParse({});
		expect(result.success).toBe(false);
	});

	it("validates valid create_note args", () => {
		const result = TOOL_ARG_SCHEMAS.create_note.safeParse({
			contact_id: 1,
			body: "Test note",
		});
		expect(result.success).toBe(true);
	});

	it("rejects create_note args missing required body", () => {
		const result = TOOL_ARG_SCHEMAS.create_note.safeParse({
			contact_id: 1,
		});
		expect(result.success).toBe(false);
	});

	it("validates valid create_contact args", () => {
		const result = TOOL_ARG_SCHEMAS.create_contact.safeParse({
			first_name: "Jane",
		});
		expect(result.success).toBe(true);
	});

	it("validates create_contact with optional fields", () => {
		const result = TOOL_ARG_SCHEMAS.create_contact.safeParse({
			first_name: "Jane",
			last_name: "Doe",
			gender_id: 2,
		});
		expect(result.success).toBe(true);
	});

	it("validates create_contact with nickname", () => {
		const result = TOOL_ARG_SCHEMAS.create_contact.safeParse({
			first_name: "John",
			last_name: "Doe",
			nickname: "Johnny",
		});
		expect(result.success).toBe(true);
	});

	it("validates valid update_contact_nickname args", () => {
		const result = TOOL_ARG_SCHEMAS.update_contact_nickname.safeParse({
			contact_id: 1,
			nickname: "Johnny",
		});
		expect(result.success).toBe(true);
	});

	it("validates update_contact_nickname with empty string to remove", () => {
		const result = TOOL_ARG_SCHEMAS.update_contact_nickname.safeParse({
			contact_id: 1,
			nickname: "",
		});
		expect(result.success).toBe(true);
	});

	it("validates valid create_activity args", () => {
		const result = TOOL_ARG_SCHEMAS.create_activity.safeParse({
			contact_ids: [1, 2],
			description: "Lunch meeting",
		});
		expect(result.success).toBe(true);
	});

	it("validates valid update_contact_birthday args", () => {
		const result = TOOL_ARG_SCHEMAS.update_contact_birthday.safeParse({
			contact_id: 1,
			date: "1990-05-15",
		});
		expect(result.success).toBe(true);
	});

	it("validates valid update_contact_phone args", () => {
		const result = TOOL_ARG_SCHEMAS.update_contact_phone.safeParse({
			contact_id: 1,
			phone_number: "+1-555-1234",
		});
		expect(result.success).toBe(true);
	});

	it("validates valid update_contact_email args", () => {
		const result = TOOL_ARG_SCHEMAS.update_contact_email.safeParse({
			contact_id: 1,
			email: "jane@example.com",
		});
		expect(result.success).toBe(true);
	});

	it("validates valid update_contact_address args", () => {
		const result = TOOL_ARG_SCHEMAS.update_contact_address.safeParse({
			contact_id: 1,
			city: "Portland",
		});
		expect(result.success).toBe(true);
	});
});

describe("generateActionDescription", () => {
	it("generates description for create_note with numeric ID fallback", () => {
		const desc = generateActionDescription("create_note", {
			contact_id: 42,
			body: "Had coffee with them today",
		});
		expect(desc).toContain("Create a note");
		expect(desc).toContain("contact 42");
		expect(desc).toContain("Had coffee with them today");
	});

	it("generates description for create_note with contactName", () => {
		const desc = generateActionDescription("create_note", {
			contact_id: 42,
			body: "Had coffee with them today",
			contactName: "Elena Yuryevna",
		});
		expect(desc).toContain("Create a note");
		expect(desc).toContain("Elena Yuryevna");
		expect(desc).not.toContain("42");
		expect(desc).toContain("Had coffee with them today");
	});

	it("truncates long note body in description", () => {
		const longBody = "A".repeat(300);
		const desc = generateActionDescription("create_note", {
			contact_id: 1,
			body: longBody,
		});
		expect(desc.length).toBeLessThan(350);
		expect(desc).toContain("…");
	});

	it("generates description for create_contact", () => {
		const desc = generateActionDescription("create_contact", {
			first_name: "Jane",
			last_name: "Doe",
		});
		expect(desc).toContain("Create");
		expect(desc).toContain("contact");
		expect(desc).toContain("Jane Doe");
	});

	it("generates description for create_activity", () => {
		const desc = generateActionDescription("create_activity", {
			contact_ids: [1, 2],
			description: "Had lunch",
		});
		expect(desc).toContain("Log");
		expect(desc).toContain("activity");
		expect(desc).toContain("Had lunch");
	});

	it("generates description for update_contact_birthday", () => {
		const desc = generateActionDescription("update_contact_birthday", {
			contact_id: 5,
			date: "1990-01-15",
		});
		expect(desc).toContain("birthday");
		expect(desc).toContain("contact 5");
		expect(desc).toContain("1990-01-15");
	});

	it("generates description for update_contact_birthday with contactName", () => {
		const desc = generateActionDescription("update_contact_birthday", {
			contact_id: 5,
			date: "1990-01-15",
			contactName: "Alex",
		});
		expect(desc).toContain("birthday");
		expect(desc).toContain("Alex");
		expect(desc).not.toContain("contact 5");
	});

	it("generates description for update_contact_phone", () => {
		const desc = generateActionDescription("update_contact_phone", {
			contact_id: 3,
			phone_number: "+1-555-0100",
		});
		expect(desc).toContain("phone");
		expect(desc).toContain("contact 3");
	});

	it("generates description for update_contact_email", () => {
		const desc = generateActionDescription("update_contact_email", {
			contact_id: 7,
			email: "jane@example.com",
		});
		expect(desc).toContain("email");
		expect(desc).toContain("contact 7");
	});

	it("generates description for update_contact_address", () => {
		const desc = generateActionDescription("update_contact_address", {
			contact_id: 9,
			city: "Portland",
			country: "US",
		});
		expect(desc).toContain("address");
		expect(desc).toContain("contact 9");
	});

	it("generates description for create_contact with nickname", () => {
		const desc = generateActionDescription("create_contact", {
			first_name: "John",
			last_name: "Doe",
			nickname: "Johnny",
		});
		expect(desc).toContain("John Doe");
		expect(desc).toContain("Johnny");
	});

	it("generates description for update_contact_nickname", () => {
		const desc = generateActionDescription("update_contact_nickname", {
			contact_id: 5,
			nickname: "Johnny",
		});
		expect(desc).toContain("nickname");
		expect(desc).toContain("contact 5");
		expect(desc).toContain("Johnny");
	});

	it("generates description for update_contact_nickname with contactName", () => {
		const desc = generateActionDescription("update_contact_nickname", {
			contact_id: 5,
			nickname: "Johnny",
			contactName: "John Doe",
		});
		expect(desc).toContain("John Doe");
		expect(desc).not.toContain("contact 5");
	});

	it("generates description for update_contact_nickname removal", () => {
		const desc = generateActionDescription("update_contact_nickname", {
			contact_id: 5,
			nickname: "",
		});
		expect(desc).toContain("(remove)");
	});

	it("returns a fallback for unknown tool names", () => {
		const desc = generateActionDescription("unknown_tool", { foo: "bar" });
		expect(desc).toContain("unknown_tool");
	});
});
