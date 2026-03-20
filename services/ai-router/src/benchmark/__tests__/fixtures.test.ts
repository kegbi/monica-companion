import { ContactResolutionBenchmarkCase, IntentBenchmarkCase } from "@monica-companion/types";
import { describe, expect, it } from "vitest";
import { clarificationCases } from "../fixtures/clarification-turns.js";
import { contactResolutionCases } from "../fixtures/contact-resolution.js";
import { greetingCases } from "../fixtures/greeting-turns.js";
import { outOfScopeCases } from "../fixtures/out-of-scope-turns.js";
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

describe("Intent benchmark fixtures", () => {
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

	it("has at least 100 write intent cases", () => {
		expect(writeIntentCases.length).toBeGreaterThanOrEqual(100);
	});

	it("has at least 60 read intent cases", () => {
		expect(readIntentCases.length).toBeGreaterThanOrEqual(60);
	});

	it("has at least 25 clarification cases", () => {
		expect(clarificationCases.length).toBeGreaterThanOrEqual(25);
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

	it("every out-of-scope case parses against the IntentBenchmarkCase schema", () => {
		for (const c of outOfScopeCases) {
			const result = IntentBenchmarkCase.safeParse(c);
			expect(result.success, `Case ${c.id} failed to parse`).toBe(true);
		}
	});

	it("has at least 10 out-of-scope cases", () => {
		expect(outOfScopeCases.length).toBeGreaterThanOrEqual(10);
	});

	it("all out-of-scope cases have category out_of_scope", () => {
		for (const c of outOfScopeCases) {
			expect(c.category).toBe("out_of_scope");
		}
	});

	it("all out-of-scope cases are non-mutating", () => {
		for (const c of outOfScopeCases) {
			expect(c.expected.isMutating, `Case ${c.id} should be non-mutating`).toBe(false);
		}
	});

	it("every greeting case parses against the IntentBenchmarkCase schema", () => {
		for (const c of greetingCases) {
			const result = IntentBenchmarkCase.safeParse(c);
			expect(result.success, `Case ${c.id} failed to parse`).toBe(true);
		}
	});

	it("has at least 5 greeting cases", () => {
		expect(greetingCases.length).toBeGreaterThanOrEqual(5);
	});

	it("all greeting cases have category greeting", () => {
		for (const c of greetingCases) {
			expect(c.category).toBe("greeting");
		}
	});

	it("all greeting cases are non-mutating", () => {
		for (const c of greetingCases) {
			expect(c.expected.isMutating, `Case ${c.id} should be non-mutating`).toBe(false);
		}
	});

	it("has unique IDs across all intent cases", () => {
		const allCases = [
			...writeIntentCases,
			...readIntentCases,
			...clarificationCases,
			...outOfScopeCases,
			...greetingCases,
		];
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

	it("all out-of-scope cases are active", () => {
		for (const c of outOfScopeCases) {
			expect(c.status, `Case ${c.id} should be active`).toBe("active");
		}
	});

	it("all greeting cases are active", () => {
		for (const c of greetingCases) {
			expect(c.status, `Case ${c.id} should be active`).toBe("active");
		}
	});

	it("has at least 200 total intent cases", () => {
		const totalIntentCases =
			writeIntentCases.length +
			readIntentCases.length +
			clarificationCases.length +
			outOfScopeCases.length +
			greetingCases.length;
		expect(totalIntentCases).toBeGreaterThanOrEqual(200);
	});

	it("has at least 50 voice samples total across all intent cases", () => {
		const allIntentCases = [
			...writeIntentCases,
			...readIntentCases,
			...clarificationCases,
			...outOfScopeCases,
			...greetingCases,
		];
		const voiceSamples = allIntentCases.filter((c) => c.input.voiceSamplePath !== null);
		expect(voiceSamples.length).toBeGreaterThanOrEqual(50);
	});
});
