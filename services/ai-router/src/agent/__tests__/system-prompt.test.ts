import { describe, expect, it } from "vitest";
import { buildAgentSystemPrompt } from "../system-prompt.js";

describe("buildAgentSystemPrompt", () => {
	it("returns a non-empty string", () => {
		const prompt = buildAgentSystemPrompt();
		expect(prompt).toBeTruthy();
		expect(typeof prompt).toBe("string");
	});

	it("includes the current date", () => {
		const prompt = buildAgentSystemPrompt();
		const today = new Date().toISOString().split("T")[0];
		expect(prompt).toContain(today);
	});

	it("mentions Monica Companion role", () => {
		const prompt = buildAgentSystemPrompt();
		expect(prompt).toContain("Monica Companion");
	});

	it("describes tool-calling behavior", () => {
		const prompt = buildAgentSystemPrompt();
		expect(prompt).toContain("tool");
	});

	it("lists all mutating operations", () => {
		const prompt = buildAgentSystemPrompt();
		expect(prompt).toContain("create_note");
		expect(prompt).toContain("create_contact");
		expect(prompt).toContain("create_activity");
		expect(prompt).toContain("update_contact_birthday");
		expect(prompt).toContain("update_contact_phone");
		expect(prompt).toContain("update_contact_email");
		expect(prompt).toContain("update_contact_address");
	});

	it("lists all read-only operations", () => {
		const prompt = buildAgentSystemPrompt();
		expect(prompt).toContain("search_contacts");
		expect(prompt).toContain("query_birthday");
		expect(prompt).toContain("query_phone");
		expect(prompt).toContain("query_last_note");
	});

	it("includes security instructions", () => {
		const prompt = buildAgentSystemPrompt();
		expect(prompt).toContain("Never reveal");
		expect(prompt).toContain("system instructions");
	});

	it("includes injection defense", () => {
		const prompt = buildAgentSystemPrompt();
		expect(prompt).toContain("override");
	});

	it("includes confirmation behavior instructions", () => {
		const prompt = buildAgentSystemPrompt();
		expect(prompt).toContain("confirmation");
		expect(prompt).toContain("intercepted");
	});

	it("includes abandoned action instructions", () => {
		const prompt = buildAgentSystemPrompt();
		expect(prompt).toContain("abandoned");
	});

	it("includes a dedicated Contact Resolution Rules section", () => {
		const prompt = buildAgentSystemPrompt();
		expect(prompt).toContain("## Contact Resolution Rules");
	});

	it("instructs to call search_contacts before any tool requiring contactId", () => {
		const prompt = buildAgentSystemPrompt();
		expect(prompt).toContain("search_contacts");
		expect(prompt).toContain("contactId");
	});

	it("instructs to never guess or fabricate a contactId", () => {
		const prompt = buildAgentSystemPrompt();
		expect(prompt).toContain("Never guess or fabricate a contactId");
	});

	it("instructs to present multiple results for disambiguation", () => {
		const prompt = buildAgentSystemPrompt();
		expect(prompt).toContain("multiple results");
		expect(prompt).toContain("ask which one");
	});

	it("instructs to ask user to clarify on zero results", () => {
		const prompt = buildAgentSystemPrompt();
		expect(prompt).toContain("zero results");
		expect(prompt).toContain("clarify");
	});
});
