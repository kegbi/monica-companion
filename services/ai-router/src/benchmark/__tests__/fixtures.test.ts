/**
 * Contact resolution benchmark fixture validation.
 *
 * Intent classification fixtures have been migrated to YAML datasets
 * in promptfoo/datasets/ and are validated by promptfoo assertions.
 * Only contact-resolution fixture validation remains here.
 */
import { ContactResolutionBenchmarkCase } from "@monica-companion/types";
import { describe, expect, it } from "vitest";
import { contactResolutionCases } from "../fixtures/contact-resolution.js";

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
