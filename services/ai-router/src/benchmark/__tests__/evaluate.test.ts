import type {
	BenchmarkCase,
	ContactResolutionBenchmarkCase,
	ContactResolutionSummary,
	IntentBenchmarkCase,
} from "@monica-companion/types";
import { describe, expect, it } from "vitest";
import {
	type Classifier,
	evaluateBenchmark,
	evaluateContactResolutionCase,
	evaluateIntentCase,
} from "../evaluate.js";

const makeContact = (
	overrides: Partial<ContactResolutionSummary> & { contactId: number },
): ContactResolutionSummary => ({
	displayName: `Contact ${overrides.contactId}`,
	aliases: [],
	relationshipLabels: [],
	importantDates: [],
	lastInteractionAt: null,
	...overrides,
});

describe("evaluateContactResolutionCase", () => {
	it("returns passed: true for a correct exact-match resolved case", () => {
		const benchmarkCase: ContactResolutionBenchmarkCase = {
			id: "cr-test-001",
			category: "contact_resolution",
			status: "active",
			description: "Exact match test",
			input: {
				query: "John Doe",
				contacts: [
					makeContact({
						contactId: 42,
						displayName: "John Doe",
						aliases: ["John", "Doe"],
					}),
				],
			},
			expected: {
				outcome: "resolved",
				resolvedContactId: 42,
				candidateContactIds: [],
			},
		};

		const result = evaluateContactResolutionCase(benchmarkCase);

		expect(result.id).toBe("cr-test-001");
		expect(result.passed).toBe(true);
		expect(result.category).toBe("contact_resolution");
		expect(result.durationMs).toBeGreaterThanOrEqual(0);
	});

	it("returns passed: false when expected outcome does not match actual", () => {
		const benchmarkCase: ContactResolutionBenchmarkCase = {
			id: "cr-test-002",
			category: "contact_resolution",
			status: "active",
			description: "Deliberately wrong expectation",
			input: {
				query: "Xavier",
				contacts: [
					makeContact({
						contactId: 42,
						displayName: "John Doe",
						aliases: ["John", "Doe"],
					}),
				],
			},
			expected: {
				outcome: "resolved",
				resolvedContactId: 42,
				candidateContactIds: [],
			},
		};

		const result = evaluateContactResolutionCase(benchmarkCase);

		expect(result.id).toBe("cr-test-002");
		expect(result.passed).toBe(false);
		expect(result.error).toBeDefined();
	});

	it("returns passed: true for a correct no_match case", () => {
		const benchmarkCase: ContactResolutionBenchmarkCase = {
			id: "cr-test-003",
			category: "contact_resolution",
			status: "active",
			description: "No match test",
			input: {
				query: "Xavier",
				contacts: [
					makeContact({
						contactId: 42,
						displayName: "John Doe",
						aliases: ["John", "Doe"],
					}),
				],
			},
			expected: {
				outcome: "no_match",
				resolvedContactId: null,
				candidateContactIds: [],
			},
		};

		const result = evaluateContactResolutionCase(benchmarkCase);

		expect(result.passed).toBe(true);
	});

	it("returns passed: true for a correct ambiguous case", () => {
		const benchmarkCase: ContactResolutionBenchmarkCase = {
			id: "cr-test-004",
			category: "contact_resolution",
			status: "active",
			description: "Ambiguous test",
			input: {
				query: "Alex",
				contacts: [
					makeContact({
						contactId: 10,
						displayName: "Alex Torres",
						aliases: ["Alex", "Torres"],
						lastInteractionAt: "2026-03-05T10:00:00Z",
					}),
					makeContact({
						contactId: 11,
						displayName: "Alex Kim",
						aliases: ["Alex", "Kim"],
					}),
				],
			},
			expected: {
				outcome: "ambiguous",
				resolvedContactId: null,
				candidateContactIds: [10, 11],
			},
		};

		const result = evaluateContactResolutionCase(benchmarkCase);

		expect(result.passed).toBe(true);
	});
});

describe("evaluateBenchmark", () => {
	it("counts pending cases correctly and skips them", async () => {
		const cases: BenchmarkCase[] = [
			{
				id: "cr-active",
				category: "contact_resolution",
				status: "active",
				description: "Active case",
				input: {
					query: "John Doe",
					contacts: [
						makeContact({
							contactId: 42,
							displayName: "John Doe",
							aliases: ["John", "Doe"],
						}),
					],
				},
				expected: {
					outcome: "resolved",
					resolvedContactId: 42,
					candidateContactIds: [],
				},
			},
			{
				id: "wi-pending",
				category: "write_intent",
				status: "pending",
				description: "Pending write intent",
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
			},
		];

		const report = await evaluateBenchmark(cases);

		expect(report.metrics.totalCases).toBe(2);
		expect(report.metrics.activeCases).toBe(1);
		expect(report.metrics.pendingCases).toBe(1);
		expect(report.caseResults).toHaveLength(1);
	});

	it("computes contactResolutionPrecision correctly", async () => {
		const contacts = [
			makeContact({ contactId: 1, displayName: "John Doe", aliases: ["John", "Doe"] }),
			makeContact({ contactId: 2, displayName: "Jane Smith", aliases: ["Jane", "Smith"] }),
		];

		const cases: BenchmarkCase[] = [
			{
				id: "cr-pass-1",
				category: "contact_resolution",
				status: "active",
				description: "Pass",
				input: { query: "John Doe", contacts },
				expected: { outcome: "resolved", resolvedContactId: 1, candidateContactIds: [] },
			},
			{
				id: "cr-pass-2",
				category: "contact_resolution",
				status: "active",
				description: "Pass",
				input: { query: "Jane Smith", contacts },
				expected: { outcome: "resolved", resolvedContactId: 2, candidateContactIds: [] },
			},
		];

		const report = await evaluateBenchmark(cases);

		expect(report.metrics.contactResolutionPrecision).toBe(1.0);
		expect(report.metrics.passedCases).toBe(2);
		expect(report.metrics.failedCases).toBe(0);
	});

	it("returns null metrics (0) for categories with zero active cases", async () => {
		// MEDIUM-3 fix: per-category active counts used for skip logic
		const cases: BenchmarkCase[] = [
			{
				id: "cr-001",
				category: "contact_resolution",
				status: "active",
				description: "Active CR case",
				input: {
					query: "John Doe",
					contacts: [
						makeContact({
							contactId: 1,
							displayName: "John Doe",
							aliases: ["John", "Doe"],
						}),
					],
				},
				expected: { outcome: "resolved", resolvedContactId: 1, candidateContactIds: [] },
			},
		];

		const report = await evaluateBenchmark(cases);

		// With only contact_resolution cases active, read/write accuracy
		// should be 0 (no active cases in those categories)
		expect(report.metrics.readAccuracy).toBe(0);
		expect(report.metrics.writeAccuracy).toBe(0);
		expect(report.metrics.falsePositiveMutationRate).toBe(0);
		expect(report.metrics.contactResolutionPrecision).toBe(1.0);
	});

	it("handles empty dataset", async () => {
		const report = await evaluateBenchmark([]);

		expect(report.metrics.totalCases).toBe(0);
		expect(report.metrics.activeCases).toBe(0);
		expect(report.metrics.pendingCases).toBe(0);
		expect(report.metrics.contactResolutionPrecision).toBe(0);
		expect(report.metrics.readAccuracy).toBe(0);
		expect(report.metrics.writeAccuracy).toBe(0);
		expect(report.caseResults).toHaveLength(0);
	});

	it("includes a timestamp in the report", async () => {
		const report = await evaluateBenchmark([]);
		expect(report.timestamp).toBeDefined();
		expect(typeof report.timestamp).toBe("string");
	});

	it("skips intent cases when no classifier is provided", async () => {
		const cases: BenchmarkCase[] = [
			{
				id: "wi-001",
				category: "write_intent",
				status: "active",
				description: "Active write intent without classifier",
				input: {
					utterance: "Add a note to Mom",
					voiceSamplePath: null,
					contactContext: [],
				},
				expected: {
					commandType: "create_note",
					contactRef: "Mom",
					resolvedContactId: null,
					isMutating: true,
				},
			},
		];

		// No classifier provided -- intent cases should be skipped (not evaluated)
		const report = await evaluateBenchmark(cases);

		// Intent case is active but not evaluated (no classifier), so no caseResult
		expect(report.caseResults).toHaveLength(0);
		expect(report.metrics.writeAccuracy).toBe(0);
	});

	it("evaluates intent cases when classifier is provided", async () => {
		const mockClassifier: Classifier = {
			invoke: async () => ({
				intent: "mutating_command" as const,
				detectedLanguage: "en",
				userFacingText: "I'll add a note to Mom.",
				commandType: "create_note",
				contactRef: "Mom",
				commandPayload: { body: "garden project" },
				confidence: 0.95,
			}),
		};

		const cases: BenchmarkCase[] = [
			{
				id: "wi-test-001",
				category: "write_intent",
				status: "active",
				description: "Write intent with mock classifier",
				input: {
					utterance: "Add a note to Mom about her garden project",
					voiceSamplePath: null,
					contactContext: [],
				},
				expected: {
					commandType: "create_note",
					contactRef: "Mom",
					resolvedContactId: null,
					isMutating: true,
				},
			},
		];

		const report = await evaluateBenchmark(cases, mockClassifier);

		expect(report.caseResults).toHaveLength(1);
		expect(report.caseResults[0].passed).toBe(true);
		expect(report.metrics.writeAccuracy).toBe(1.0);
	});
});

describe("evaluateIntentCase", () => {
	const makeWriteIntentCase = (overrides?: Partial<IntentBenchmarkCase>): IntentBenchmarkCase => ({
		id: "wi-test",
		category: "write_intent",
		status: "active",
		description: "Test write intent",
		input: {
			utterance: "Add a note to Mom about her garden project",
			voiceSamplePath: null,
			contactContext: [],
		},
		expected: {
			commandType: "create_note",
			contactRef: "Mom",
			resolvedContactId: null,
			isMutating: true,
		},
		...overrides,
	});

	const makeReadIntentCase = (overrides?: Partial<IntentBenchmarkCase>): IntentBenchmarkCase => ({
		id: "ri-test",
		category: "read_intent",
		status: "active",
		description: "Test read intent",
		input: {
			utterance: "What's Sarah's birthday?",
			voiceSamplePath: null,
			contactContext: [],
		},
		expected: {
			commandType: "query_birthday",
			contactRef: "Sarah",
			resolvedContactId: null,
			isMutating: false,
		},
		...overrides,
	});

	const makeClarificationCase = (
		overrides?: Partial<IntentBenchmarkCase>,
	): IntentBenchmarkCase => ({
		id: "cl-test",
		category: "clarification",
		status: "active",
		description: "Test clarification",
		input: {
			utterance: "Which Sherry?",
			voiceSamplePath: null,
			contactContext: [],
		},
		expected: {
			commandType: null,
			contactRef: null,
			resolvedContactId: null,
			isMutating: false,
		},
		...overrides,
	});

	it("returns passed: true for correct write intent classification", async () => {
		const classifier: Classifier = {
			invoke: async () => ({
				intent: "mutating_command" as const,
				detectedLanguage: "en",
				userFacingText: "I'll add a note to Mom.",
				commandType: "create_note",
				contactRef: "Mom",
				commandPayload: { body: "garden project" },
				confidence: 0.95,
			}),
		};

		const result = await evaluateIntentCase(makeWriteIntentCase(), classifier);

		expect(result.passed).toBe(true);
		expect(result.category).toBe("write_intent");
		expect(result.durationMs).toBeGreaterThanOrEqual(0);
	});

	it("returns passed: false when intent mismatches for write case", async () => {
		const classifier: Classifier = {
			invoke: async () => ({
				intent: "read_query" as const,
				detectedLanguage: "en",
				userFacingText: "Looking up...",
				commandType: "query_birthday",
				contactRef: "Mom",
				commandPayload: null,
				confidence: 0.8,
			}),
		};

		const result = await evaluateIntentCase(makeWriteIntentCase(), classifier);

		expect(result.passed).toBe(false);
		expect(result.error).toContain("intent");
	});

	it("returns passed: false when commandType mismatches for write case", async () => {
		const classifier: Classifier = {
			invoke: async () => ({
				intent: "mutating_command" as const,
				detectedLanguage: "en",
				userFacingText: "I'll create a contact.",
				commandType: "create_contact",
				contactRef: "Mom",
				commandPayload: null,
				confidence: 0.85,
			}),
		};

		const result = await evaluateIntentCase(makeWriteIntentCase(), classifier);

		expect(result.passed).toBe(false);
		expect(result.error).toContain("commandType");
	});

	it("returns passed: true for correct read intent classification", async () => {
		const classifier: Classifier = {
			invoke: async () => ({
				intent: "read_query" as const,
				detectedLanguage: "en",
				userFacingText: "Looking up Sarah's birthday...",
				commandType: "query_birthday",
				contactRef: "Sarah",
				commandPayload: null,
				confidence: 0.95,
			}),
		};

		const result = await evaluateIntentCase(makeReadIntentCase(), classifier);

		expect(result.passed).toBe(true);
	});

	it("returns passed: true for correct clarification classification", async () => {
		const classifier: Classifier = {
			invoke: async () => ({
				intent: "clarification_response" as const,
				detectedLanguage: "en",
				userFacingText: "Which Sherry do you mean?",
				commandType: null,
				contactRef: null,
				commandPayload: null,
				confidence: 0.9,
			}),
		};

		const result = await evaluateIntentCase(makeClarificationCase(), classifier);

		expect(result.passed).toBe(true);
	});

	it("checks contactRef with case-insensitive substring match", async () => {
		const classifier: Classifier = {
			invoke: async () => ({
				intent: "mutating_command" as const,
				detectedLanguage: "en",
				userFacingText: "Adding note.",
				commandType: "create_note",
				contactRef: "mom",
				commandPayload: null,
				confidence: 0.9,
			}),
		};

		const result = await evaluateIntentCase(makeWriteIntentCase(), classifier);

		// "mom" should match expected "Mom" (case-insensitive)
		expect(result.passed).toBe(true);
	});

	it("returns passed: true for correct out_of_scope classification", async () => {
		const classifier: Classifier = {
			invoke: async () => ({
				intent: "out_of_scope" as const,
				detectedLanguage: "en",
				userFacingText: "I can only help with contact management.",
				commandType: null,
				contactRef: null,
				commandPayload: null,
				confidence: 0.95,
			}),
		};

		const oosCase: IntentBenchmarkCase = {
			id: "oos-test",
			category: "out_of_scope",
			status: "active",
			description: "Out of scope test",
			input: {
				utterance: "What is the weather today?",
				voiceSamplePath: null,
				contactContext: [],
			},
			expected: {
				commandType: null,
				contactRef: null,
				resolvedContactId: null,
				isMutating: false,
			},
		};

		const result = await evaluateIntentCase(oosCase, classifier);

		expect(result.passed).toBe(true);
		expect(result.category).toBe("out_of_scope");
	});

	it("returns passed: false when out_of_scope is misclassified as mutating", async () => {
		const classifier: Classifier = {
			invoke: async () => ({
				intent: "mutating_command" as const,
				detectedLanguage: "en",
				userFacingText: "Adding note...",
				commandType: "create_note",
				contactRef: null,
				commandPayload: null,
				confidence: 0.6,
			}),
		};

		const oosCase: IntentBenchmarkCase = {
			id: "oos-test-fail",
			category: "out_of_scope",
			status: "active",
			description: "Out of scope misclassified",
			input: {
				utterance: "What is 2 + 2?",
				voiceSamplePath: null,
				contactContext: [],
			},
			expected: {
				commandType: null,
				contactRef: null,
				resolvedContactId: null,
				isMutating: false,
			},
		};

		const result = await evaluateIntentCase(oosCase, classifier);

		expect(result.passed).toBe(false);
		expect(result.error).toContain("intent");
	});

	it("returns passed: true for correct greeting classification", async () => {
		const classifier: Classifier = {
			invoke: async () => ({
				intent: "greeting" as const,
				detectedLanguage: "en",
				userFacingText: "Hello! How can I help you?",
				commandType: null,
				contactRef: null,
				commandPayload: null,
				confidence: 0.99,
			}),
		};

		const grCase: IntentBenchmarkCase = {
			id: "gr-test",
			category: "greeting",
			status: "active",
			description: "Greeting test",
			input: {
				utterance: "Hello",
				voiceSamplePath: null,
				contactContext: [],
			},
			expected: {
				commandType: null,
				contactRef: null,
				resolvedContactId: null,
				isMutating: false,
			},
		};

		const result = await evaluateIntentCase(grCase, classifier);

		expect(result.passed).toBe(true);
		expect(result.category).toBe("greeting");
	});

	it("returns passed: false when greeting is misclassified as mutating", async () => {
		const classifier: Classifier = {
			invoke: async () => ({
				intent: "mutating_command" as const,
				detectedLanguage: "en",
				userFacingText: "Creating...",
				commandType: "create_contact",
				contactRef: null,
				commandPayload: null,
				confidence: 0.5,
			}),
		};

		const grCase: IntentBenchmarkCase = {
			id: "gr-test-fail",
			category: "greeting",
			status: "active",
			description: "Greeting misclassified",
			input: {
				utterance: "Hi there",
				voiceSamplePath: null,
				contactContext: [],
			},
			expected: {
				commandType: null,
				contactRef: null,
				resolvedContactId: null,
				isMutating: false,
			},
		};

		const result = await evaluateIntentCase(grCase, classifier);

		expect(result.passed).toBe(false);
		expect(result.error).toContain("intent");
	});

	it("handles classifier errors gracefully", async () => {
		const classifier: Classifier = {
			invoke: async () => {
				throw new Error("API timeout");
			},
		};

		const result = await evaluateIntentCase(makeWriteIntentCase(), classifier);

		expect(result.passed).toBe(false);
		expect(result.error).toContain("Classifier error");
	});
});

describe("false-positive mutation rate", () => {
	it("is non-zero when a read intent is misclassified as mutating_command", async () => {
		const misclassifyingClassifier: Classifier = {
			invoke: async () => ({
				intent: "mutating_command" as const,
				detectedLanguage: "en",
				userFacingText: "I'll update...",
				commandType: "create_note",
				contactRef: "Sarah",
				commandPayload: null,
				confidence: 0.8,
			}),
		};

		const cases: BenchmarkCase[] = [
			{
				id: "ri-fp",
				category: "read_intent",
				status: "active",
				description: "Read intent that gets misclassified as mutating",
				input: {
					utterance: "What's Sarah's birthday?",
					voiceSamplePath: null,
					contactContext: [],
				},
				expected: {
					commandType: "query_birthday",
					contactRef: "Sarah",
					resolvedContactId: null,
					isMutating: false,
				},
			},
		];

		const report = await evaluateBenchmark(cases, misclassifyingClassifier);

		expect(report.metrics.falsePositiveMutationRate).toBeGreaterThan(0);
		expect(report.metrics.falsePositiveMutationRate).toBe(1.0);
	});

	it("is zero when non-mutating cases are classified correctly", async () => {
		const correctClassifier: Classifier = {
			invoke: async () => ({
				intent: "read_query" as const,
				detectedLanguage: "en",
				userFacingText: "Looking up...",
				commandType: "query_birthday",
				contactRef: "Sarah",
				commandPayload: null,
				confidence: 0.95,
			}),
		};

		const cases: BenchmarkCase[] = [
			{
				id: "ri-correct",
				category: "read_intent",
				status: "active",
				description: "Correctly classified read intent",
				input: {
					utterance: "What's Sarah's birthday?",
					voiceSamplePath: null,
					contactContext: [],
				},
				expected: {
					commandType: "query_birthday",
					contactRef: "Sarah",
					resolvedContactId: null,
					isMutating: false,
				},
			},
		];

		const report = await evaluateBenchmark(cases, correctClassifier);

		expect(report.metrics.falsePositiveMutationRate).toBe(0);
	});
});
