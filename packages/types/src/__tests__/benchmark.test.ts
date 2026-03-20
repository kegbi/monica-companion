import { describe, expect, it } from "vitest";
import {
	BenchmarkCase,
	BenchmarkCaseCategory,
	BenchmarkCaseStatus,
	BenchmarkMetrics,
	CaseResult,
	ContactResolutionBenchmarkCase,
	IntentBenchmarkCase,
} from "../benchmark.js";

describe("BenchmarkCaseCategory schema", () => {
	it("accepts valid categories", () => {
		for (const cat of [
			"write_intent",
			"read_intent",
			"clarification",
			"contact_resolution",
			"out_of_scope",
			"greeting",
		]) {
			expect(BenchmarkCaseCategory.safeParse(cat).success).toBe(true);
		}
	});

	it("rejects invalid category", () => {
		expect(BenchmarkCaseCategory.safeParse("unknown").success).toBe(false);
	});
});

describe("BenchmarkCaseStatus schema", () => {
	it("accepts active and pending", () => {
		expect(BenchmarkCaseStatus.safeParse("active").success).toBe(true);
		expect(BenchmarkCaseStatus.safeParse("pending").success).toBe(true);
	});

	it("rejects invalid status", () => {
		expect(BenchmarkCaseStatus.safeParse("disabled").success).toBe(false);
	});
});

describe("ContactResolutionBenchmarkCase schema", () => {
	const validCase = {
		id: "cr-001",
		category: "contact_resolution" as const,
		status: "active" as const,
		description: "Exact display name match",
		input: {
			query: "John Doe",
			contacts: [
				{
					contactId: 42,
					displayName: "John Doe",
					aliases: ["John", "Doe"],
					relationshipLabels: [],
					importantDates: [],
					lastInteractionAt: null,
				},
			],
		},
		expected: {
			outcome: "resolved" as const,
			resolvedContactId: 42,
			candidateContactIds: [],
		},
	};

	it("parses a valid contact resolution case", () => {
		const result = ContactResolutionBenchmarkCase.safeParse(validCase);
		expect(result.success).toBe(true);
	});

	it("accepts pending status", () => {
		const result = ContactResolutionBenchmarkCase.safeParse({
			...validCase,
			status: "pending",
		});
		expect(result.success).toBe(true);
	});

	it("rejects wrong category", () => {
		const result = ContactResolutionBenchmarkCase.safeParse({
			...validCase,
			category: "write_intent",
		});
		expect(result.success).toBe(false);
	});

	it("rejects empty id", () => {
		const result = ContactResolutionBenchmarkCase.safeParse({
			...validCase,
			id: "",
		});
		expect(result.success).toBe(false);
	});

	it("rejects null resolvedContactId must be nullable", () => {
		const result = ContactResolutionBenchmarkCase.safeParse({
			...validCase,
			expected: {
				outcome: "no_match",
				resolvedContactId: null,
				candidateContactIds: [],
			},
		});
		expect(result.success).toBe(true);
	});

	it("rejects non-integer resolvedContactId", () => {
		const result = ContactResolutionBenchmarkCase.safeParse({
			...validCase,
			expected: {
				...validCase.expected,
				resolvedContactId: 1.5,
			},
		});
		expect(result.success).toBe(false);
	});

	it("rejects invalid outcome", () => {
		const result = ContactResolutionBenchmarkCase.safeParse({
			...validCase,
			expected: {
				...validCase.expected,
				outcome: "maybe",
			},
		});
		expect(result.success).toBe(false);
	});
});

describe("IntentBenchmarkCase schema", () => {
	const validCase = {
		id: "wi-001",
		category: "write_intent" as const,
		status: "pending" as const,
		description: "Add a note to a contact",
		input: {
			utterance: "Add a note to Mom about her garden project",
			voiceSamplePath: null,
			contactContext: [
				{
					contactId: 1,
					displayName: "Mary Johnson",
					aliases: ["Mary"],
					relationshipLabels: ["parent"],
					importantDates: [],
					lastInteractionAt: null,
				},
			],
		},
		expected: {
			commandType: "create_note",
			contactRef: "Mom",
			resolvedContactId: 1,
			isMutating: true,
		},
	};

	it("parses a valid write intent case", () => {
		const result = IntentBenchmarkCase.safeParse(validCase);
		expect(result.success).toBe(true);
	});

	it("parses a valid read intent case", () => {
		const result = IntentBenchmarkCase.safeParse({
			...validCase,
			id: "ri-001",
			category: "read_intent",
			expected: {
				commandType: "get_birthday",
				contactRef: "Mom",
				resolvedContactId: 1,
				isMutating: false,
			},
		});
		expect(result.success).toBe(true);
	});

	it("parses a valid clarification case", () => {
		const result = IntentBenchmarkCase.safeParse({
			...validCase,
			id: "cl-001",
			category: "clarification",
			expected: {
				commandType: null,
				contactRef: null,
				resolvedContactId: null,
				isMutating: false,
			},
		});
		expect(result.success).toBe(true);
	});

	it("parses a valid out_of_scope case", () => {
		const result = IntentBenchmarkCase.safeParse({
			...validCase,
			id: "oos-001",
			category: "out_of_scope",
			expected: {
				commandType: null,
				contactRef: null,
				resolvedContactId: null,
				isMutating: false,
			},
		});
		expect(result.success).toBe(true);
	});

	it("parses a valid greeting case", () => {
		const result = IntentBenchmarkCase.safeParse({
			...validCase,
			id: "gr-001",
			category: "greeting",
			expected: {
				commandType: null,
				contactRef: null,
				resolvedContactId: null,
				isMutating: false,
			},
		});
		expect(result.success).toBe(true);
	});

	it("rejects contact_resolution category", () => {
		const result = IntentBenchmarkCase.safeParse({
			...validCase,
			category: "contact_resolution",
		});
		expect(result.success).toBe(false);
	});

	it("rejects missing utterance field", () => {
		const { utterance, ...inputWithout } = validCase.input;
		const result = IntentBenchmarkCase.safeParse({
			...validCase,
			input: inputWithout,
		});
		expect(result.success).toBe(false);
	});

	it("accepts null voiceSamplePath", () => {
		const result = IntentBenchmarkCase.safeParse(validCase);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.input.voiceSamplePath).toBeNull();
		}
	});

	it("accepts string voiceSamplePath", () => {
		const result = IntentBenchmarkCase.safeParse({
			...validCase,
			input: {
				...validCase.input,
				voiceSamplePath: "samples/voice-001.ogg",
			},
		});
		expect(result.success).toBe(true);
	});
});

describe("BenchmarkCase union schema", () => {
	it("parses a contact resolution case", () => {
		const result = BenchmarkCase.safeParse({
			id: "cr-001",
			category: "contact_resolution",
			status: "active",
			description: "Test",
			input: {
				query: "John",
				contacts: [],
			},
			expected: {
				outcome: "no_match",
				resolvedContactId: null,
				candidateContactIds: [],
			},
		});
		expect(result.success).toBe(true);
	});

	it("parses an intent case", () => {
		const result = BenchmarkCase.safeParse({
			id: "wi-001",
			category: "write_intent",
			status: "pending",
			description: "Test",
			input: {
				utterance: "Add a note",
				voiceSamplePath: null,
				contactContext: [],
			},
			expected: {
				commandType: "create_note",
				contactRef: null,
				resolvedContactId: null,
				isMutating: true,
			},
		});
		expect(result.success).toBe(true);
	});
});

describe("BenchmarkMetrics schema", () => {
	const validMetrics = {
		readAccuracy: 0.92,
		writeAccuracy: 0.9,
		contactResolutionPrecision: 0.95,
		falsePositiveMutationRate: 0.005,
		totalCases: 200,
		activeCases: 150,
		pendingCases: 50,
		passedCases: 145,
		failedCases: 5,
	};

	it("parses valid metrics", () => {
		const result = BenchmarkMetrics.safeParse(validMetrics);
		expect(result.success).toBe(true);
	});

	it("accepts boundary values (0 and 1)", () => {
		const result = BenchmarkMetrics.safeParse({
			...validMetrics,
			readAccuracy: 0,
			writeAccuracy: 1,
		});
		expect(result.success).toBe(true);
	});

	it("rejects accuracy above 1", () => {
		const result = BenchmarkMetrics.safeParse({
			...validMetrics,
			readAccuracy: 1.1,
		});
		expect(result.success).toBe(false);
	});

	it("rejects negative accuracy", () => {
		const result = BenchmarkMetrics.safeParse({
			...validMetrics,
			writeAccuracy: -0.1,
		});
		expect(result.success).toBe(false);
	});

	it("rejects negative case counts", () => {
		const result = BenchmarkMetrics.safeParse({
			...validMetrics,
			totalCases: -1,
		});
		expect(result.success).toBe(false);
	});

	it("rejects non-integer case counts", () => {
		const result = BenchmarkMetrics.safeParse({
			...validMetrics,
			activeCases: 1.5,
		});
		expect(result.success).toBe(false);
	});

	it("does not include caseResults (belongs to EvaluationReport only)", () => {
		// Per LOW-2: caseResults belongs to EvaluationReport wrapper, not BenchmarkMetrics
		const result = BenchmarkMetrics.safeParse(validMetrics);
		expect(result.success).toBe(true);
		if (result.success) {
			expect("caseResults" in result.data).toBe(false);
		}
	});
});

describe("CaseResult schema", () => {
	const validCaseResult = {
		id: "cr-001",
		category: "contact_resolution",
		passed: true,
		expected: { outcome: "resolved", resolvedContactId: 42 },
		actual: { outcome: "resolved", resolvedContactId: 42 },
		durationMs: 1.5,
	};

	it("parses a valid case result", () => {
		const result = CaseResult.safeParse(validCaseResult);
		expect(result.success).toBe(true);
	});

	it("parses with optional error field", () => {
		const result = CaseResult.safeParse({
			...validCaseResult,
			passed: false,
			error: "Expected resolved but got no_match",
		});
		expect(result.success).toBe(true);
	});

	it("parses without error field", () => {
		const result = CaseResult.safeParse(validCaseResult);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.error).toBeUndefined();
		}
	});

	it("rejects missing id", () => {
		const { id, ...rest } = validCaseResult;
		const result = CaseResult.safeParse(rest);
		expect(result.success).toBe(false);
	});

	it("rejects invalid category", () => {
		const result = CaseResult.safeParse({
			...validCaseResult,
			category: "unknown",
		});
		expect(result.success).toBe(false);
	});
});
