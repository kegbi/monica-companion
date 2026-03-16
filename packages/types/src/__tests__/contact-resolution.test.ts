import { describe, expect, it } from "vitest";
import {
	ContactMatchCandidate,
	ContactResolutionRequest,
	ContactResolutionResult,
	ContactResolutionSummary,
	ImportantDate,
	MatchReason,
	ResolutionOutcome,
} from "../contact-resolution.js";

describe("ContactResolutionSummary schema", () => {
	const validSummary = {
		contactId: 42,
		displayName: "John Doe (Johnny)",
		aliases: ["Johnny", "John", "Doe"],
		relationshipLabels: ["partner", "friend"],
		importantDates: [
			{
				label: "birthdate",
				date: "1990-01-15",
				isYearUnknown: false,
			},
		],
		lastInteractionAt: "2026-03-10T14:30:00Z",
	};

	it("parses a valid ContactResolutionSummary", () => {
		const result = ContactResolutionSummary.safeParse(validSummary);
		expect(result.success).toBe(true);
	});

	it("parses with null lastInteractionAt", () => {
		const result = ContactResolutionSummary.safeParse({
			...validSummary,
			lastInteractionAt: null,
		});
		expect(result.success).toBe(true);
	});

	it("parses with empty arrays", () => {
		const result = ContactResolutionSummary.safeParse({
			contactId: 1,
			displayName: "Jane Smith",
			aliases: [],
			relationshipLabels: [],
			importantDates: [],
			lastInteractionAt: null,
		});
		expect(result.success).toBe(true);
	});

	it("rejects non-integer contactId", () => {
		const result = ContactResolutionSummary.safeParse({
			...validSummary,
			contactId: 1.5,
		});
		expect(result.success).toBe(false);
	});

	it("rejects missing displayName", () => {
		const { displayName, ...rest } = validSummary;
		const result = ContactResolutionSummary.safeParse(rest);
		expect(result.success).toBe(false);
	});

	describe("ImportantDate schema", () => {
		it("parses a valid ImportantDate", () => {
			const result = ImportantDate.safeParse({
				label: "birthdate",
				date: "1990-01-15",
				isYearUnknown: false,
			});
			expect(result.success).toBe(true);
		});

		it("parses with isYearUnknown true", () => {
			const result = ImportantDate.safeParse({
				label: "birthdate",
				date: "0000-06-20",
				isYearUnknown: true,
			});
			expect(result.success).toBe(true);
		});

		it("rejects missing label", () => {
			const result = ImportantDate.safeParse({
				date: "1990-01-15",
				isYearUnknown: false,
			});
			expect(result.success).toBe(false);
		});
	});
});

describe("MatchReason schema", () => {
	it("accepts valid match reasons", () => {
		for (const reason of [
			"exact_display_name",
			"exact_first_name",
			"alias_match",
			"relationship_label_match",
			"partial_match",
		]) {
			expect(MatchReason.safeParse(reason).success).toBe(true);
		}
	});

	it("rejects invalid match reason", () => {
		expect(MatchReason.safeParse("unknown_reason").success).toBe(false);
	});
});

describe("ResolutionOutcome schema", () => {
	it("accepts valid outcomes", () => {
		for (const outcome of ["resolved", "ambiguous", "no_match"]) {
			expect(ResolutionOutcome.safeParse(outcome).success).toBe(true);
		}
	});

	it("rejects invalid outcome", () => {
		expect(ResolutionOutcome.safeParse("maybe").success).toBe(false);
	});
});

describe("ContactMatchCandidate schema", () => {
	const validCandidate = {
		contactId: 42,
		displayName: "John Doe",
		score: 0.95,
		matchReason: "exact_first_name" as const,
	};

	it("parses a valid ContactMatchCandidate", () => {
		const result = ContactMatchCandidate.safeParse(validCandidate);
		expect(result.success).toBe(true);
	});

	it("accepts score of 0", () => {
		const result = ContactMatchCandidate.safeParse({ ...validCandidate, score: 0 });
		expect(result.success).toBe(true);
	});

	it("accepts score of 1", () => {
		const result = ContactMatchCandidate.safeParse({ ...validCandidate, score: 1 });
		expect(result.success).toBe(true);
	});

	it("rejects score above 1", () => {
		const result = ContactMatchCandidate.safeParse({ ...validCandidate, score: 1.1 });
		expect(result.success).toBe(false);
	});

	it("rejects score below 0", () => {
		const result = ContactMatchCandidate.safeParse({ ...validCandidate, score: -0.1 });
		expect(result.success).toBe(false);
	});

	it("rejects non-integer contactId", () => {
		const result = ContactMatchCandidate.safeParse({ ...validCandidate, contactId: 1.5 });
		expect(result.success).toBe(false);
	});

	it("rejects invalid matchReason", () => {
		const result = ContactMatchCandidate.safeParse({
			...validCandidate,
			matchReason: "magic",
		});
		expect(result.success).toBe(false);
	});
});

describe("ContactResolutionResult schema", () => {
	const validSummary = {
		contactId: 42,
		displayName: "John Doe (Johnny)",
		aliases: ["Johnny", "John", "Doe"],
		relationshipLabels: ["partner"],
		importantDates: [],
		lastInteractionAt: "2026-03-10T14:30:00Z",
	};

	it("parses a resolved result", () => {
		const result = ContactResolutionResult.safeParse({
			outcome: "resolved",
			resolved: validSummary,
			candidates: [],
			query: "John",
		});
		expect(result.success).toBe(true);
	});

	it("parses an ambiguous result with candidates", () => {
		const result = ContactResolutionResult.safeParse({
			outcome: "ambiguous",
			resolved: null,
			candidates: [
				{
					contactId: 42,
					displayName: "John Doe",
					score: 0.8,
					matchReason: "alias_match",
				},
				{
					contactId: 43,
					displayName: "John Smith",
					score: 0.8,
					matchReason: "alias_match",
				},
			],
			query: "John",
		});
		expect(result.success).toBe(true);
	});

	it("parses a no_match result", () => {
		const result = ContactResolutionResult.safeParse({
			outcome: "no_match",
			resolved: null,
			candidates: [],
			query: "Xavier",
		});
		expect(result.success).toBe(true);
	});

	it("rejects missing query", () => {
		const result = ContactResolutionResult.safeParse({
			outcome: "no_match",
			resolved: null,
			candidates: [],
		});
		expect(result.success).toBe(false);
	});

	it("rejects invalid outcome", () => {
		const result = ContactResolutionResult.safeParse({
			outcome: "maybe",
			resolved: null,
			candidates: [],
			query: "test",
		});
		expect(result.success).toBe(false);
	});
});

describe("ContactResolutionRequest schema", () => {
	const validRequest = {
		contactRef: "Mom",
		correlationId: "corr-123",
	};

	it("parses a valid request", () => {
		const result = ContactResolutionRequest.safeParse(validRequest);
		expect(result.success).toBe(true);
	});

	it("rejects empty contactRef", () => {
		const result = ContactResolutionRequest.safeParse({
			...validRequest,
			contactRef: "",
		});
		expect(result.success).toBe(false);
	});

	it("rejects contactRef exceeding 500 chars", () => {
		const result = ContactResolutionRequest.safeParse({
			...validRequest,
			contactRef: "a".repeat(501),
		});
		expect(result.success).toBe(false);
	});

	it("rejects empty correlationId", () => {
		const result = ContactResolutionRequest.safeParse({
			...validRequest,
			correlationId: "",
		});
		expect(result.success).toBe(false);
	});

	it("rejects missing correlationId", () => {
		const { correlationId, ...rest } = validRequest;
		const result = ContactResolutionRequest.safeParse(rest);
		expect(result.success).toBe(false);
	});
});

describe("ContactResolutionSummary mapping from Monica contact", () => {
	it("can extract ContactResolutionSummary fields from a full contact shape", () => {
		// Simulates the mapping that monica-integration will perform
		const monicaContact = {
			id: 42,
			complete_name: "John Doe (Johnny)",
			first_name: "John",
			last_name: "Doe",
			nickname: "Johnny",
			information: {
				relationships: {
					love: {
						total: 1,
						contacts: [
							{
								relationship: { id: 1, uuid: "r-uuid-1", name: "partner" },
								contact: { id: 2 },
							},
						],
					},
					family: { total: 0, contacts: [] },
					friend: {
						total: 1,
						contacts: [
							{
								relationship: { id: 2, uuid: "r-uuid-2", name: "friend" },
								contact: { id: 3 },
							},
						],
					},
					work: { total: 0, contacts: [] },
				},
				dates: {
					birthdate: {
						is_age_based: false,
						is_year_unknown: false,
						date: "1990-01-15T00:00:00Z",
					},
				},
			},
			last_activity_together: "2026-03-10T14:30:00Z",
		};

		// Extract aliases from name fields
		const aliases = [
			monicaContact.nickname,
			monicaContact.first_name,
			monicaContact.last_name,
		].filter((a): a is string => a !== null && a !== undefined);

		// Extract relationship labels
		const relationshipLabels = Object.values(monicaContact.information.relationships).flatMap(
			(group) =>
				(group.contacts as Array<{ relationship: { name: string } }>).map(
					(c) => c.relationship.name,
				),
		);

		// Extract important dates
		const importantDates: Array<{
			label: string;
			date: string;
			isYearUnknown: boolean;
		}> = [];
		const birthdate = monicaContact.information.dates.birthdate;
		if (birthdate.date) {
			importantDates.push({
				label: "birthdate",
				date: birthdate.date.split("T")[0],
				isYearUnknown: birthdate.is_year_unknown ?? false,
			});
		}

		const summary = {
			contactId: monicaContact.id,
			displayName: monicaContact.complete_name,
			aliases,
			relationshipLabels,
			importantDates,
			lastInteractionAt: monicaContact.last_activity_together,
		};

		const result = ContactResolutionSummary.safeParse(summary);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.contactId).toBe(42);
			expect(result.data.displayName).toBe("John Doe (Johnny)");
			expect(result.data.aliases).toEqual(["Johnny", "John", "Doe"]);
			expect(result.data.relationshipLabels).toEqual(["partner", "friend"]);
			expect(result.data.importantDates).toHaveLength(1);
			expect(result.data.importantDates[0].label).toBe("birthdate");
			expect(result.data.lastInteractionAt).toBe("2026-03-10T14:30:00Z");
		}
	});
});
