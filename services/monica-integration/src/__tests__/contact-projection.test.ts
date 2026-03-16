import { fullContactFixture } from "@monica-companion/monica-api-lib/__fixtures__";
import { ContactResolutionSummary } from "@monica-companion/types";
import { describe, expect, it } from "vitest";
import {
	buildContactResolutionSummaries,
	buildContactResolutionSummary,
} from "../lib/contact-projection.js";

describe("buildContactResolutionSummary", () => {
	it("maps full contact fixture correctly", () => {
		const summary = buildContactResolutionSummary(fullContactFixture);

		expect(summary.contactId).toBe(42);
		expect(summary.displayName).toBe("John Doe (Johnny)");
		expect(summary.aliases).toContain("John");
		expect(summary.aliases).toContain("Doe");
		expect(summary.aliases).toContain("Johnny");
		// complete_name should NOT be in aliases
		expect(summary.aliases).not.toContain("John Doe (Johnny)");
		expect(summary.relationshipLabels).toEqual(["partner"]);
		expect(summary.importantDates).toHaveLength(1);
		expect(summary.importantDates[0].label).toBe("birthdate");
		expect(summary.importantDates[0].date).toContain("1990-01-15");
		expect(summary.importantDates[0].isYearUnknown).toBe(false);
		expect(summary.lastInteractionAt).toBe("2026-03-10T14:30:00Z");
	});

	it("handles contact with no nickname, no relationships, no birthdate", () => {
		const minimal = {
			...fullContactFixture,
			nickname: null,
			last_activity_together: null,
			information: {
				...fullContactFixture.information,
				relationships: {
					love: { total: 0, contacts: [] },
					family: { total: 0, contacts: [] },
					friend: { total: 0, contacts: [] },
					work: { total: 0, contacts: [] },
				},
				dates: {
					birthdate: {
						is_age_based: null,
						is_year_unknown: null,
						date: null,
					},
					deceased_date: {
						is_age_based: null,
						is_year_unknown: null,
						date: null,
					},
				},
			},
		};

		const summary = buildContactResolutionSummary(minimal);

		expect(summary.aliases).not.toContain(null);
		expect(summary.relationshipLabels).toEqual([]);
		expect(summary.importantDates).toEqual([]);
		expect(summary.lastInteractionAt).toBeNull();
	});

	it("handles partial contact (is_partial = true) with empty relationship labels", () => {
		const partial = {
			...fullContactFixture,
			is_partial: true,
		};

		const summary = buildContactResolutionSummary(partial);

		expect(summary.relationshipLabels).toEqual([]);
	});

	it("deduplicates aliases", () => {
		const contact = {
			...fullContactFixture,
			first_name: "John",
			last_name: "John", // duplicate
			nickname: "John", // duplicate
			complete_name: "John John (John)",
		};

		const summary = buildContactResolutionSummary(contact);

		// "John" should appear only once, and complete_name excluded
		const johnCount = summary.aliases.filter((a) => a === "John").length;
		expect(johnCount).toBe(1);
	});

	it("handles is_year_unknown: true for birthdate", () => {
		const contact = {
			...fullContactFixture,
			information: {
				...fullContactFixture.information,
				dates: {
					birthdate: {
						is_age_based: false,
						is_year_unknown: true,
						date: "0000-06-15T00:00:00Z",
					},
					deceased_date: {
						is_age_based: null,
						is_year_unknown: null,
						date: null,
					},
				},
			},
		};

		const summary = buildContactResolutionSummary(contact);

		expect(summary.importantDates).toHaveLength(1);
		expect(summary.importantDates[0].isYearUnknown).toBe(true);
	});

	it("output validates against ContactResolutionSummary schema", () => {
		const summary = buildContactResolutionSummary(fullContactFixture);
		const result = ContactResolutionSummary.safeParse(summary);
		expect(result.success).toBe(true);
	});
});

describe("buildContactResolutionSummaries", () => {
	it("maps over array of contacts", () => {
		const summaries = buildContactResolutionSummaries([
			fullContactFixture,
			{ ...fullContactFixture, id: 99, complete_name: "Jane Smith" },
		]);

		expect(summaries).toHaveLength(2);
		expect(summaries[0].contactId).toBe(42);
		expect(summaries[1].contactId).toBe(99);
	});
});
