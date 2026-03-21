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

	describe("bidirectional kinship matching", () => {
		it("'mom' matches contact with relationshipLabels ['child'] (contact IS a parent)", () => {
			const candidates = [
				makeSummary({
					contactId: 100,
					displayName: "Elena Yuryevna",
					aliases: ["Elena", "Yuryevna"],
					relationshipLabels: ["child"],
				}),
			];

			const result = matchContacts("mom", candidates);

			expect(result).toHaveLength(1);
			expect(result[0].contactId).toBe(100);
			expect(result[0].score).toBe(0.9);
			expect(result[0].matchReason).toBe("relationship_label_match");
		});

		it("'mom' matches contact with relationshipLabels ['parent'] (backward compat)", () => {
			const candidates = [
				makeSummary({
					contactId: 101,
					displayName: "Olga Petrova",
					aliases: ["Olga", "Petrova"],
					relationshipLabels: ["parent"],
				}),
			];

			const result = matchContacts("mom", candidates);

			expect(result).toHaveLength(1);
			expect(result[0].contactId).toBe(101);
			expect(result[0].score).toBe(0.9);
			expect(result[0].matchReason).toBe("relationship_label_match");
		});

		it("'mom' matches BOTH directions, producing ambiguous result", () => {
			const candidates = [
				makeSummary({
					contactId: 100,
					displayName: "Elena Yuryevna",
					aliases: ["Elena", "Yuryevna"],
					relationshipLabels: ["child"],
				}),
				makeSummary({
					contactId: 101,
					displayName: "Olga Petrova",
					aliases: ["Olga", "Petrova"],
					relationshipLabels: ["parent"],
				}),
			];

			const result = matchContacts("mom", candidates);

			expect(result).toHaveLength(2);
			expect(result[0].score).toBe(0.9);
			expect(result[1].score).toBe(0.9);
			// Both contacts matched at the same score
			expect(result.map((r) => r.contactId).sort()).toEqual([100, 101]);
		});

		it("'dad' matches contacts with either 'parent' or 'child' labels", () => {
			const candidates = [
				makeSummary({
					contactId: 200,
					displayName: "Ivan Petrov",
					aliases: ["Ivan", "Petrov"],
					relationshipLabels: ["parent"],
				}),
				makeSummary({
					contactId: 201,
					displayName: "Dmitry Smirnov",
					aliases: ["Dmitry", "Smirnov"],
					relationshipLabels: ["child"],
				}),
			];

			const result = matchContacts("dad", candidates);

			expect(result).toHaveLength(2);
			expect(result[0].score).toBe(0.9);
			expect(result[1].score).toBe(0.9);
			expect(result.map((r) => r.contactId).sort()).toEqual([200, 201]);
		});

		it("'boss' matches contacts with either 'boss' or 'subordinate' labels", () => {
			const candidates = [
				makeSummary({
					contactId: 300,
					displayName: "Director Dan",
					aliases: ["Dan"],
					relationshipLabels: ["boss"],
				}),
				makeSummary({
					contactId: 301,
					displayName: "Manager Mike",
					aliases: ["Mike"],
					relationshipLabels: ["subordinate"],
				}),
			];

			const result = matchContacts("boss", candidates);

			expect(result).toHaveLength(2);
			expect(result[0].score).toBe(0.9);
			expect(result[1].score).toBe(0.9);
		});

		it("'uncle' matches contacts with either 'uncle' or 'nephew' labels", () => {
			const candidates = [
				makeSummary({
					contactId: 400,
					displayName: "Uncle Bob",
					aliases: ["Bob"],
					relationshipLabels: ["uncle"],
				}),
				makeSummary({
					contactId: 401,
					displayName: "Cousin Steve",
					aliases: ["Steve"],
					relationshipLabels: ["nephew"],
				}),
			];

			const result = matchContacts("uncle", candidates);

			expect(result).toHaveLength(2);
			expect(result[0].score).toBe(0.9);
			expect(result[1].score).toBe(0.9);
		});

		it("symmetric types still work: 'wife' matches 'spouse' only", () => {
			const candidates = [
				makeSummary({
					contactId: 500,
					displayName: "Jane Doe",
					aliases: ["Jane"],
					relationshipLabels: ["spouse"],
				}),
				makeSummary({
					contactId: 501,
					displayName: "Alice Wonder",
					aliases: ["Alice"],
					relationshipLabels: ["friend"],
				}),
			];

			const result = matchContacts("wife", candidates);

			expect(result).toHaveLength(1);
			expect(result[0].contactId).toBe(500);
			expect(result[0].score).toBe(0.9);
			expect(result[0].matchReason).toBe("relationship_label_match");
		});

		it("'grandma' matches contacts with either 'grandparent' or 'grandchild' labels", () => {
			const candidates = [
				makeSummary({
					contactId: 600,
					displayName: "Grandma Rose",
					aliases: ["Rose"],
					relationshipLabels: ["grandparent"],
				}),
				makeSummary({
					contactId: 601,
					displayName: "Nana Betty",
					aliases: ["Betty"],
					relationshipLabels: ["grandchild"],
				}),
			];

			const result = matchContacts("grandma", candidates);

			expect(result).toHaveLength(2);
			expect(result[0].score).toBe(0.9);
			expect(result[1].score).toBe(0.9);
		});

		it("real-world topology: 3-contact family demonstrates fundamental ambiguity", () => {
			// Alice has a parent and a sibling listed
			// Mom Mary has children (IS parent) and a spouse
			// Dad Tom has children (IS parent) and a spouse
			const candidates = [
				makeSummary({
					contactId: 700,
					displayName: "Alice",
					aliases: ["Alice"],
					relationshipLabels: ["parent", "sibling"],
				}),
				makeSummary({
					contactId: 701,
					displayName: "Mom Mary",
					aliases: ["Mary"],
					relationshipLabels: ["child", "spouse"],
				}),
				makeSummary({
					contactId: 702,
					displayName: "Dad Tom",
					aliases: ["Tom"],
					relationshipLabels: ["child", "spouse"],
				}),
			];

			const result = matchContacts("mom", candidates);

			// All three match at 0.9: Alice has "parent" label, Mary and Tom have "child" label
			// This ambiguity is by design -- disambiguation narrows downstream
			expect(result).toHaveLength(3);
			expect(result.every((r) => r.score === 0.9)).toBe(true);
		});

		it("'mentor' matches both 'mentor' and 'protege' labels", () => {
			const candidates = [
				makeSummary({
					contactId: 800,
					displayName: "Dr. Smith",
					aliases: ["Smith"],
					relationshipLabels: ["mentor"],
				}),
				makeSummary({
					contactId: 801,
					displayName: "Junior Dev",
					aliases: ["Junior"],
					relationshipLabels: ["protege"],
				}),
			];

			const result = matchContacts("mentor", candidates);

			expect(result).toHaveLength(2);
			expect(result[0].score).toBe(0.9);
			expect(result[1].score).toBe(0.9);
		});

		it("'godmother' matches both 'godparent' and 'godchild' labels", () => {
			const candidates = [
				makeSummary({
					contactId: 900,
					displayName: "Fairy Godmother",
					aliases: ["Fairy"],
					relationshipLabels: ["godparent"],
				}),
				makeSummary({
					contactId: 901,
					displayName: "Little Timmy",
					aliases: ["Timmy"],
					relationshipLabels: ["godchild"],
				}),
			];

			const result = matchContacts("godmother", candidates);

			expect(result).toHaveLength(2);
			expect(result[0].score).toBe(0.9);
			expect(result[1].score).toBe(0.9);
		});

		it("direct match path survives refactor: 'parent' label matches term 'parent'", () => {
			// LOW-3 review finding: verify the direct match path still works
			const candidates = [
				makeSummary({
					contactId: 950,
					displayName: "Some Contact",
					aliases: [],
					relationshipLabels: ["parent"],
				}),
			];

			const result = matchContacts("parent", candidates);

			expect(result).toHaveLength(1);
			expect(result[0].contactId).toBe(950);
			expect(result[0].score).toBe(0.9);
			expect(result[0].matchReason).toBe("relationship_label_match");
		});
	});
});
