import { ContactResolutionBenchmarkCase, IntentBenchmarkCase } from "@monica-companion/types";
import { describe, expect, it } from "vitest";
import { clarificationCases } from "../fixtures/clarification-turns.js";
import { contactResolutionCases } from "../fixtures/contact-resolution.js";
import { readIntentCases } from "../fixtures/read-intents.js";
import { writeIntentCases } from "../fixtures/write-intents.js";

describe("Contact resolution benchmark fixtures", () => {
	it("every case parses against the ContactResolutionBenchmarkCase schema", () => {
		for (const c of contactResolutionCases) {
			const result = ContactResolutionBenchmarkCase.safeParse(c);
			expect(result.success, `Case ${c.id} failed to parse: ${JSON.stringify(result)}`).toBe(true);
		}
	});

	it("has at least 40 contact-resolution cases", () => {
		expect(contactResolutionCases.length).toBeGreaterThanOrEqual(40);
	});

	it("has unique IDs across all contact-resolution cases", () => {
		const ids = contactResolutionCases.map((c) => c.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it("all cases have category contact_resolution", () => {
		for (const c of contactResolutionCases) {
			expect(c.category).toBe("contact_resolution");
		}
	});
});

describe("Intent benchmark fixture stubs", () => {
	it("every write intent case parses against the IntentBenchmarkCase schema", () => {
		for (const c of writeIntentCases) {
			const result = IntentBenchmarkCase.safeParse(c);
			expect(result.success, `Case ${c.id} failed to parse`).toBe(true);
		}
	});

	it("every read intent case parses against the IntentBenchmarkCase schema", () => {
		for (const c of readIntentCases) {
			const result = IntentBenchmarkCase.safeParse(c);
			expect(result.success, `Case ${c.id} failed to parse`).toBe(true);
		}
	});

	it("every clarification case parses against the IntentBenchmarkCase schema", () => {
		for (const c of clarificationCases) {
			const result = IntentBenchmarkCase.safeParse(c);
			expect(result.success, `Case ${c.id} failed to parse`).toBe(true);
		}
	});

	// Lowered from >= 10 / >= 6 to match post-cleanup V1 case counts.
	// Non-V1 command types (create_reminder, create_task, list_birthdays, etc.)
	// were removed during LLM benchmark activation.
	it("has at least 8 write intent cases", () => {
		expect(writeIntentCases.length).toBeGreaterThanOrEqual(8);
	});

	it("has at least 4 read intent cases", () => {
		expect(readIntentCases.length).toBeGreaterThanOrEqual(4);
	});

	it("has at least 4 clarification stubs", () => {
		expect(clarificationCases.length).toBeGreaterThanOrEqual(4);
	});

	it("all write intent cases have category write_intent", () => {
		for (const c of writeIntentCases) {
			expect(c.category).toBe("write_intent");
		}
	});

	it("all read intent cases have category read_intent", () => {
		for (const c of readIntentCases) {
			expect(c.category).toBe("read_intent");
		}
	});

	it("all clarification cases have category clarification", () => {
		for (const c of clarificationCases) {
			expect(c.category).toBe("clarification");
		}
	});

	it("has unique IDs across all intent cases", () => {
		const allCases = [...writeIntentCases, ...readIntentCases, ...clarificationCases];
		const ids = allCases.map((c) => c.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it("all write intent cases are active", () => {
		for (const c of writeIntentCases) {
			expect(c.status, `Case ${c.id} should be active`).toBe("active");
		}
	});

	it("all read intent cases are active", () => {
		for (const c of readIntentCases) {
			expect(c.status, `Case ${c.id} should be active`).toBe("active");
		}
	});

	it("all clarification cases are active", () => {
		for (const c of clarificationCases) {
			expect(c.status, `Case ${c.id} should be active`).toBe("active");
		}
	});
});
