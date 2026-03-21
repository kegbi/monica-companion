import type {
	BenchmarkCase,
	BenchmarkMetrics,
	CaseResult,
	ContactResolutionBenchmarkCase,
} from "@monica-companion/types";
import { matchContacts } from "../contact-resolution/matcher.js";
import {
	AMBIGUITY_GAP_THRESHOLD,
	MINIMUM_MATCH_THRESHOLD,
	RESOLVED_THRESHOLD,
} from "../contact-resolution/resolver.js";

/**
 * The full evaluation report, combining aggregate metrics and
 * per-case results. caseResults is part of this wrapper only,
 * not part of BenchmarkMetrics (per LOW-2 review finding).
 */
export interface EvaluationReport {
	metrics: BenchmarkMetrics;
	caseResults: CaseResult[];
	timestamp: string;
}

/**
 * Evaluate a single contact-resolution benchmark case.
 *
 * Calls matchContacts() from the existing deterministic matcher
 * and applies the resolver's threshold logic to determine the
 * outcome, matching exactly what resolveContact() would produce
 * (but without the HTTP client call).
 */
export function evaluateContactResolutionCase(
	benchmarkCase: ContactResolutionBenchmarkCase,
): CaseResult {
	const start = performance.now();
	const { query, contacts } = benchmarkCase.input;
	const {
		outcome: expectedOutcome,
		resolvedContactId,
		candidateContactIds,
	} = benchmarkCase.expected;

	const candidates = matchContacts(query, contacts);

	// Apply resolver threshold logic
	let actualOutcome: "resolved" | "ambiguous" | "no_match";
	let actualResolvedId: number | null = null;
	let actualCandidateIds: number[] = [];

	if (candidates.length === 0) {
		actualOutcome = "no_match";
	} else {
		const topScore = candidates[0].score;
		const secondScore = candidates.length > 1 ? candidates[1].score : 0;

		if (topScore >= RESOLVED_THRESHOLD && topScore - secondScore >= AMBIGUITY_GAP_THRESHOLD) {
			actualOutcome = "resolved";
			actualResolvedId = candidates[0].contactId;
		} else if (topScore >= MINIMUM_MATCH_THRESHOLD) {
			actualOutcome = "ambiguous";
			actualCandidateIds = candidates.slice(0, 5).map((c) => c.contactId);
		} else {
			actualOutcome = "no_match";
		}
	}

	const durationMs = performance.now() - start;

	const actual = {
		outcome: actualOutcome,
		resolvedContactId: actualResolvedId,
		candidateContactIds: actualCandidateIds,
	};

	const errors: string[] = [];

	if (actualOutcome !== expectedOutcome) {
		errors.push(`outcome: expected "${expectedOutcome}" but got "${actualOutcome}"`);
	}

	if (expectedOutcome === "resolved" && actualResolvedId !== resolvedContactId) {
		errors.push(`resolvedContactId: expected ${resolvedContactId} but got ${actualResolvedId}`);
	}

	if (expectedOutcome === "ambiguous") {
		const expectedIds = JSON.stringify(candidateContactIds);
		const actualIds = JSON.stringify(actualCandidateIds);
		if (expectedIds !== actualIds) {
			errors.push(`candidateContactIds: expected ${expectedIds} but got ${actualIds}`);
		}
	}

	const passed = errors.length === 0;

	return {
		id: benchmarkCase.id,
		category: "contact_resolution",
		passed,
		expected: benchmarkCase.expected,
		actual,
		...(errors.length > 0 ? { error: errors.join("; ") } : {}),
		durationMs,
	};
}

/**
 * Run the full benchmark evaluation suite.
 *
 * Iterates over all contact-resolution cases, skips pending ones,
 * evaluates active ones, and computes aggregate metrics.
 *
 * Intent classification evaluation has been migrated to promptfoo.
 * Intent metric fields (readAccuracy, writeAccuracy, falsePositiveMutationRate)
 * are set to 0 to maintain type compatibility with BenchmarkMetrics.
 */
export async function evaluateBenchmark(cases: BenchmarkCase[]): Promise<EvaluationReport> {
	const caseResults: CaseResult[] = [];

	const activeCases = cases.filter((c) => c.status === "active");
	const pendingCases = cases.filter((c) => c.status === "pending");

	// Only evaluate contact-resolution cases (intent cases migrated to promptfoo)
	const activeCrCases = activeCases.filter((c) => c.category === "contact_resolution");

	for (const benchmarkCase of activeCrCases) {
		const result = evaluateContactResolutionCase(benchmarkCase);
		caseResults.push(result);
	}

	const passedCases = caseResults.filter((r) => r.passed).length;
	const failedCases = caseResults.filter((r) => !r.passed).length;

	const contactResolutionPrecision =
		activeCrCases.length > 0 ? passedCases / activeCrCases.length : 0;

	const metrics: BenchmarkMetrics = {
		// Intent metrics set to 0 -- evaluation migrated to promptfoo
		readAccuracy: 0,
		writeAccuracy: 0,
		falsePositiveMutationRate: 0,
		contactResolutionPrecision,
		totalCases: cases.length,
		activeCases: activeCases.length,
		pendingCases: pendingCases.length,
		passedCases,
		failedCases,
	};

	return {
		metrics,
		caseResults,
		timestamp: new Date().toISOString(),
	};
}

/**
 * Format a human-readable benchmark summary for CI output.
 *
 * Outputs case IDs and metric scores only. Does NOT include
 * contact names, utterance text, or other potentially PII-bearing
 * fields from the fixture data.
 */
export function formatBenchmarkSummary(report: EvaluationReport): string {
	const lines: string[] = [
		"=== Benchmark Quality Gates Report ===",
		`Timestamp: ${report.timestamp}`,
		"",
		"--- Metrics ---",
		`Contact Resolution Precision: ${(report.metrics.contactResolutionPrecision * 100).toFixed(1)}%`,
		"(Intent metrics migrated to promptfoo -- run 'tsx promptfoo/check-thresholds.ts' separately)",
		"",
		"--- Case Counts ---",
		`Total:   ${report.metrics.totalCases}`,
		`Active:  ${report.metrics.activeCases}`,
		`Pending: ${report.metrics.pendingCases}`,
		`Passed:  ${report.metrics.passedCases}`,
		`Failed:  ${report.metrics.failedCases}`,
	];

	const failed = report.caseResults.filter((r) => !r.passed);
	if (failed.length > 0) {
		lines.push("", "--- Failed Cases ---");
		for (const f of failed) {
			lines.push(`  ${f.id}: ${f.error ?? "unknown error"}`);
		}
	}

	lines.push("", "=== End Report ===");
	return lines.join("\n");
}
