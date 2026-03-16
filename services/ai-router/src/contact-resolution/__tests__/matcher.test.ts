import type { ContactResolutionSummary } from "@monica-companion/types";
import { describe, expect, it } from "vitest";
import { matchContacts } from "../matcher.js";

function makeSummary(
	overrides: Partial<ContactResolutionSummary> & { contactId: number },
): ContactResolutionSummary {
	return {
		displayName: `Contact ${overrides.contactId}`,
		aliases: [],
		relationshipLabels: [],
		importantDates: [],
		lastInteractionAt: null,
		...overrides,
	};
}

describe("matchContacts", () => {
	it("returns score 1.0 for exact displayName match (full, including parenthetical)", () => {
		const candidates = [
			makeSummary({
				contactId: 42,
				displayName: "John Doe (Johnny)",
				aliases: ["Johnny", "John", "Doe"],
			}),
		];

		const result = matchContacts("John Doe (Johnny)", candidates);

		expect(result).toHaveLength(1);
		expect(result[0].score).toBe(1.0);
		expect(result[0].matchReason).toBe("exact_display_name");
		expect(result[0].contactId).toBe(42);
	});

	it("returns score 1.0 for displayName match after stripping parenthetical", () => {
		const candidates = [
			makeSummary({
				contactId: 42,
				displayName: "John Doe (Johnny)",
				aliases: ["Johnny", "John", "Doe"],
			}),
		];

		const result = matchContacts("John Doe", candidates);

		expect(result).toHaveLength(1);
		expect(result[0].score).toBe(1.0);
		expect(result[0].matchReason).toBe("exact_display_name");
	});

	it("returns score 0.95 for exact first+last name match from aliases", () => {
		const candidates = [
			makeSummary({
				contactId: 42,
				displayName: "John Michael Doe (Johnny)",
				aliases: ["Johnny", "John", "Doe"],
			}),
		];

		const result = matchContacts("John Doe", candidates);

		// displayName stripped would be "John Michael Doe", not "John Doe"
		// so this should match via aliases first+last at 0.95
		// Actually, the stripped displayName "John Michael Doe" != "John Doe"
		// so we fall through to alias first+last check
		expect(result).toHaveLength(1);
		expect(result[0].score).toBe(0.95);
		expect(result[0].matchReason).toBe("exact_first_name");
	});

	it("returns score 0.90 for relationship label match (exact)", () => {
		const candidates = [
			makeSummary({
				contactId: 42,
				displayName: "Maria Smith",
				relationshipLabels: ["partner"],
			}),
		];

		const result = matchContacts("my partner", candidates);

		expect(result).toHaveLength(1);
		expect(result[0].score).toBe(0.9);
		expect(result[0].matchReason).toBe("relationship_label_match");
	});

	it("normalizes kinship term: 'Mom' matches relationshipLabel 'parent'", () => {
		const candidates = [
			makeSummary({
				contactId: 42,
				displayName: "Mary Johnson",
				relationshipLabels: ["parent"],
			}),
		];

		const result = matchContacts("Mom", candidates);

		expect(result).toHaveLength(1);
		expect(result[0].score).toBe(0.9);
		expect(result[0].matchReason).toBe("relationship_label_match");
	});

	it("returns score 0.80 for exact single alias match", () => {
		const candidates = [
			makeSummary({
				contactId: 42,
				displayName: "John Doe (Johnny)",
				aliases: ["Johnny", "John", "Doe"],
			}),
		];

		const result = matchContacts("Johnny", candidates);

		expect(result).toHaveLength(1);
		expect(result[0].score).toBe(0.8);
		expect(result[0].matchReason).toBe("alias_match");
	});

	it("returns score 0.60 for prefix match on first name (min 2 chars)", () => {
		const candidates = [
			makeSummary({
				contactId: 42,
				displayName: "John Doe",
				aliases: ["John", "Doe"],
			}),
		];

		const result = matchContacts("Joh", candidates);

		expect(result).toHaveLength(1);
		expect(result[0].score).toBe(0.6);
		expect(result[0].matchReason).toBe("partial_match");
	});

	it("returns empty results when no candidate matches", () => {
		const candidates = [
			makeSummary({
				contactId: 42,
				displayName: "John Doe",
				aliases: ["John", "Doe"],
			}),
		];

		const result = matchContacts("Xavier", candidates);

		expect(result).toHaveLength(0);
	});

	it("handles duplicate names: two contacts with same first name get same score, ordered by recency", () => {
		const candidates = [
			makeSummary({
				contactId: 10,
				displayName: "Sherry Miller",
				aliases: ["Sherry", "Miller"],
				lastInteractionAt: null,
			}),
			makeSummary({
				contactId: 20,
				displayName: "Sherry Chen",
				aliases: ["Sherry", "Chen"],
				lastInteractionAt: "2026-03-10T14:30:00Z",
			}),
		];

		const result = matchContacts("Sherry", candidates);

		expect(result).toHaveLength(2);
		expect(result[0].score).toBe(0.8);
		expect(result[1].score).toBe(0.8);
		// More recent interaction ranks higher
		expect(result[0].contactId).toBe(20);
		expect(result[1].contactId).toBe(10);
	});

	it("tiebreaker: same score, one with lastInteractionAt wins; null ranks last", () => {
		const candidates = [
			makeSummary({
				contactId: 1,
				displayName: "Alex A",
				aliases: ["Alex"],
				lastInteractionAt: null,
			}),
			makeSummary({
				contactId: 2,
				displayName: "Alex B",
				aliases: ["Alex"],
				lastInteractionAt: "2026-03-10T00:00:00Z",
			}),
		];

		const result = matchContacts("Alex", candidates);

		expect(result).toHaveLength(2);
		expect(result[0].contactId).toBe(2);
		expect(result[1].contactId).toBe(1);
	});

	it("tiebreaker: both null lastInteractionAt, ordered by contactId ascending", () => {
		const candidates = [
			makeSummary({
				contactId: 99,
				displayName: "Alex Z",
				aliases: ["Alex"],
				lastInteractionAt: null,
			}),
			makeSummary({
				contactId: 5,
				displayName: "Alex A",
				aliases: ["Alex"],
				lastInteractionAt: null,
			}),
		];

		const result = matchContacts("Alex", candidates);

		expect(result).toHaveLength(2);
		expect(result[0].contactId).toBe(5);
		expect(result[1].contactId).toBe(99);
	});

	it("is case insensitive: 'johnny' matches alias 'Johnny'", () => {
		const candidates = [
			makeSummary({
				contactId: 42,
				displayName: "John Doe (Johnny)",
				aliases: ["Johnny", "John", "Doe"],
			}),
		];

		const result = matchContacts("johnny", candidates);

		expect(result).toHaveLength(1);
		expect(result[0].score).toBe(0.8);
		expect(result[0].matchReason).toBe("alias_match");
	});

	it("strips 'my' prefix: 'my brother' matches relationship 'sibling'", () => {
		const candidates = [
			makeSummary({
				contactId: 42,
				displayName: "Alex Johnson",
				relationshipLabels: ["sibling"],
			}),
		];

		const result = matchContacts("my brother", candidates);

		expect(result).toHaveLength(1);
		expect(result[0].score).toBe(0.9);
		expect(result[0].matchReason).toBe("relationship_label_match");
	});

	it("single-char query does NOT match as prefix (minimum 2 chars)", () => {
		const candidates = [
			makeSummary({
				contactId: 42,
				displayName: "John Doe",
				aliases: ["John", "Doe"],
			}),
		];

		const result = matchContacts("J", candidates);

		expect(result).toHaveLength(0);
	});

	it("kinship: 'wife' matches relationshipLabel 'spouse'", () => {
		const candidates = [
			makeSummary({
				contactId: 42,
				displayName: "Jane Doe",
				relationshipLabels: ["spouse"],
			}),
		];

		const result = matchContacts("wife", candidates);

		expect(result).toHaveLength(1);
		expect(result[0].score).toBe(0.9);
		expect(result[0].matchReason).toBe("relationship_label_match");
	});

	it("kinship: 'colleague' matches relationshipLabel 'colleague'", () => {
		const candidates = [
			makeSummary({
				contactId: 42,
				displayName: "Bob Builder",
				relationshipLabels: ["colleague"],
			}),
		];

		const result = matchContacts("colleague", candidates);

		expect(result).toHaveLength(1);
		expect(result[0].score).toBe(0.9);
	});

	it("strips possessives: \"Mom's\" matches as 'mom'", () => {
		const candidates = [
			makeSummary({
				contactId: 42,
				displayName: "Mary",
				relationshipLabels: ["parent"],
			}),
		];

		const result = matchContacts("Mom's", candidates);

		expect(result).toHaveLength(1);
		expect(result[0].score).toBe(0.9);
		expect(result[0].matchReason).toBe("relationship_label_match");
	});

	it("compound query 'brother Alex': takes max of relationship and name score", () => {
		const candidates = [
			makeSummary({
				contactId: 42,
				displayName: "Alex Johnson",
				aliases: ["Alex", "Johnson"],
				relationshipLabels: ["sibling"],
			}),
			makeSummary({
				contactId: 43,
				displayName: "Alex Smith",
				aliases: ["Alex", "Smith"],
				relationshipLabels: [],
			}),
		];

		const result = matchContacts("brother Alex", candidates);

		// Contact 42 matches both 'sibling' (0.90) and 'Alex' (0.80) -> max is 0.90
		// Contact 43 matches 'Alex' (0.80) only
		expect(result).toHaveLength(2);
		expect(result[0].contactId).toBe(42);
		expect(result[0].score).toBe(0.9);
		expect(result[1].contactId).toBe(43);
		expect(result[1].score).toBe(0.8);
	});

	it("returns candidates sorted by score descending", () => {
		const candidates = [
			makeSummary({
				contactId: 1,
				displayName: "John Doe",
				aliases: ["John", "Doe"],
			}),
			makeSummary({
				contactId: 2,
				displayName: "Johnny Walker",
				aliases: ["Johnny", "Walker"],
			}),
		];

		const result = matchContacts("John", candidates);

		// "John" exact alias match for contact 1 (0.80)
		// "John" is prefix of "Johnny" for contact 2 (0.60)
		expect(result).toHaveLength(2);
		expect(result[0].contactId).toBe(1);
		expect(result[0].score).toBe(0.8);
		expect(result[1].contactId).toBe(2);
		expect(result[1].score).toBe(0.6);
	});

	it("handles empty candidate list", () => {
		const result = matchContacts("John", []);
		expect(result).toHaveLength(0);
	});

	it("handles empty query", () => {
		const candidates = [
			makeSummary({
				contactId: 42,
				displayName: "John Doe",
				aliases: ["John"],
			}),
		];
		const result = matchContacts("", candidates);
		expect(result).toHaveLength(0);
	});

	it("handles whitespace-only query", () => {
		const candidates = [
			makeSummary({
				contactId: 42,
				displayName: "John Doe",
				aliases: ["John"],
			}),
		];
		const result = matchContacts("   ", candidates);
		expect(result).toHaveLength(0);
	});
});
