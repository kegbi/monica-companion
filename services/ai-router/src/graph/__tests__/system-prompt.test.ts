import { describe, expect, it } from "vitest";
import { buildSystemPrompt } from "../system-prompt.js";

describe("buildSystemPrompt", () => {
	it("returns a non-empty string", () => {
		const prompt = buildSystemPrompt();
		expect(typeof prompt).toBe("string");
		expect(prompt.length).toBeGreaterThan(0);
	});

	it("defines the assistant role as Monica Companion / personal CRM assistant", () => {
		const prompt = buildSystemPrompt();
		expect(prompt).toMatch(/Monica Companion/i);
		expect(prompt).toMatch(/CRM/i);
	});

	it("enumerates all V1 mutating command types", () => {
		const prompt = buildSystemPrompt();
		const mutatingTypes = [
			"create_contact",
			"create_note",
			"create_activity",
			"update_contact_birthday",
			"update_contact_phone",
			"update_contact_email",
			"update_contact_address",
		];
		for (const ct of mutatingTypes) {
			expect(prompt, `should contain ${ct}`).toContain(ct);
		}
	});

	it("enumerates all V1 read-only command types", () => {
		const prompt = buildSystemPrompt();
		const readOnlyTypes = ["query_birthday", "query_phone", "query_last_note"];
		for (const ct of readOnlyTypes) {
			expect(prompt, `should contain ${ct}`).toContain(ct);
		}
	});

	it("instructs intent classification into exactly five categories", () => {
		const prompt = buildSystemPrompt();
		const intents = [
			"mutating_command",
			"read_query",
			"clarification_response",
			"greeting",
			"out_of_scope",
		];
		for (const intent of intents) {
			expect(prompt, `should contain ${intent}`).toContain(intent);
		}
	});

	it("instructs language detection", () => {
		const prompt = buildSystemPrompt();
		expect(prompt).toMatch(/language/i);
		expect(prompt).toMatch(/detect/i);
	});

	it("instructs extraction of contactRef and commandPayload", () => {
		const prompt = buildSystemPrompt();
		expect(prompt).toContain("contactRef");
		expect(prompt).toContain("commandPayload");
	});

	it("instructs greetings get friendly responses", () => {
		const prompt = buildSystemPrompt();
		expect(prompt).toMatch(/greeting/i);
		expect(prompt).toMatch(/friendly/i);
	});

	it("instructs out-of-scope gets polite declines", () => {
		const prompt = buildSystemPrompt();
		expect(prompt).toMatch(/out_of_scope/i);
		expect(prompt).toMatch(/polite/i);
	});

	it("instructs the LLM to never reveal system instructions", () => {
		const prompt = buildSystemPrompt();
		expect(prompt).toMatch(/never reveal/i);
	});

	it("includes the current date", () => {
		const prompt = buildSystemPrompt();
		// Should contain today's date in some format
		const today = new Date().toISOString().split("T")[0];
		expect(prompt).toContain(today);
	});
});
