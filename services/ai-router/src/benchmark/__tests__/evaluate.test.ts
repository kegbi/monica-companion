import type {
	BenchmarkCase,
	ContactResolutionBenchmarkCase,
	ContactResolutionSummary,
	IntentBenchmarkCase,
} from "@monica-companion/types";
import { describe, expect, it } from "vitest";
import { evaluateBenchmark, evaluateContactResolutionCase } from "../evaluate.js";

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
	it("counts pending cases correctly and skips them", () => {
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

		const report = evaluateBenchmark(cases);

		expect(report.metrics.totalCases).toBe(2);
		expect(report.metrics.activeCases).toBe(1);
		expect(report.metrics.pendingCases).toBe(1);
		expect(report.caseResults).toHaveLength(1);
	});

	it("computes contactResolutionPrecision correctly", () => {
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

		const report = evaluateBenchmark(cases);

		expect(report.metrics.contactResolutionPrecision).toBe(1.0);
		expect(report.metrics.passedCases).toBe(2);
		expect(report.metrics.failedCases).toBe(0);
	});

	it("returns null metrics (0) for categories with zero active cases", () => {
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

		const report = evaluateBenchmark(cases);

		// With only contact_resolution cases active, read/write accuracy
		// should be 0 (no active cases in those categories)
		expect(report.metrics.readAccuracy).toBe(0);
		expect(report.metrics.writeAccuracy).toBe(0);
		expect(report.metrics.falsePositiveMutationRate).toBe(0);
		expect(report.metrics.contactResolutionPrecision).toBe(1.0);
	});

	it("handles empty dataset", () => {
		const report = evaluateBenchmark([]);

		expect(report.metrics.totalCases).toBe(0);
		expect(report.metrics.activeCases).toBe(0);
		expect(report.metrics.pendingCases).toBe(0);
		expect(report.metrics.contactResolutionPrecision).toBe(0);
		expect(report.metrics.readAccuracy).toBe(0);
		expect(report.metrics.writeAccuracy).toBe(0);
		expect(report.caseResults).toHaveLength(0);
	});

	it("includes a timestamp in the report", () => {
		const report = evaluateBenchmark([]);
		expect(report.timestamp).toBeDefined();
		expect(typeof report.timestamp).toBe("string");
	});
});
