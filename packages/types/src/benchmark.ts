import { z } from "zod/v4";
import { ContactResolutionSummary, ResolutionOutcome } from "./contact-resolution.js";

/** Categories of benchmark test cases. */
export const BenchmarkCaseCategory = z.enum([
	"write_intent",
	"read_intent",
	"clarification",
	"contact_resolution",
]);
export type BenchmarkCaseCategory = z.infer<typeof BenchmarkCaseCategory>;

/** Whether a benchmark case is active (evaluated) or pending (skipped). */
export const BenchmarkCaseStatus = z.enum(["active", "pending"]);
export type BenchmarkCaseStatus = z.infer<typeof BenchmarkCaseStatus>;

/** A benchmark case that tests contact resolution accuracy. */
export const ContactResolutionBenchmarkCase = z.object({
	id: z.string().min(1),
	category: z.literal("contact_resolution"),
	status: BenchmarkCaseStatus,
	description: z.string(),
	input: z.object({
		query: z.string(),
		contacts: z.array(ContactResolutionSummary),
	}),
	expected: z.object({
		outcome: ResolutionOutcome,
		resolvedContactId: z.number().int().nullable(),
		candidateContactIds: z.array(z.number().int()),
	}),
});
export type ContactResolutionBenchmarkCase = z.infer<typeof ContactResolutionBenchmarkCase>;

/** A benchmark case that tests intent classification (write, read, or clarification). */
export const IntentBenchmarkCase = z.object({
	id: z.string().min(1),
	category: z.enum(["write_intent", "read_intent", "clarification"]),
	status: BenchmarkCaseStatus,
	description: z.string(),
	input: z.object({
		utterance: z.string(),
		voiceSamplePath: z.string().nullable(),
		contactContext: z.array(ContactResolutionSummary),
	}),
	expected: z.object({
		commandType: z.string().nullable(),
		contactRef: z.string().nullable(),
		resolvedContactId: z.number().int().nullable(),
		isMutating: z.boolean(),
	}),
});
export type IntentBenchmarkCase = z.infer<typeof IntentBenchmarkCase>;

/**
 * Union of all benchmark case types.
 * Uses z.union (not z.discriminatedUnion) because IntentBenchmarkCase
 * covers three category values.
 */
export const BenchmarkCase = z.union([ContactResolutionBenchmarkCase, IntentBenchmarkCase]);
export type BenchmarkCase = z.infer<typeof BenchmarkCase>;

/**
 * Aggregate metrics produced by the benchmark evaluation runner.
 * Note: caseResults belongs to EvaluationReport wrapper, not this schema.
 */
export const BenchmarkMetrics = z.object({
	readAccuracy: z.number().min(0).max(1),
	writeAccuracy: z.number().min(0).max(1),
	contactResolutionPrecision: z.number().min(0).max(1),
	falsePositiveMutationRate: z.number().min(0).max(1),
	totalCases: z.number().int().nonnegative(),
	activeCases: z.number().int().nonnegative(),
	pendingCases: z.number().int().nonnegative(),
	passedCases: z.number().int().nonnegative(),
	failedCases: z.number().int().nonnegative(),
});
export type BenchmarkMetrics = z.infer<typeof BenchmarkMetrics>;

/**
 * Result of evaluating a single benchmark case.
 * Defined as a Zod schema per LOW-1 review finding: single source of truth.
 */
export const CaseResult = z.object({
	id: z.string().min(1),
	category: BenchmarkCaseCategory,
	passed: z.boolean(),
	expected: z.unknown(),
	actual: z.unknown(),
	error: z.string().optional(),
	durationMs: z.number().nonnegative(),
});
export type CaseResult = z.infer<typeof CaseResult>;
