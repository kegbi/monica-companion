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
 * Iterates over all cases, skips pending ones, evaluates active ones,
 * and computes aggregate metrics. Per-category active counts are used
 * for skip logic (MEDIUM-3 fix) so metrics for categories with zero
 * active cases are reported as 0 rather than producing NaN.
 */
export function evaluateBenchmark(cases: BenchmarkCase[]): EvaluationReport {
	const caseResults: CaseResult[] = [];

	const activeCases = cases.filter((c) => c.status === "active");
	const pendingCases = cases.filter((c) => c.status === "pending");

	// Per-category active counts (MEDIUM-3 fix)
	const activeCrCases = activeCases.filter((c) => c.category === "contact_resolution");
	const activeReadCases = activeCases.filter((c) => c.category === "read_intent");
	const activeWriteCases = activeCases.filter((c) => c.category === "write_intent");

	for (const benchmarkCase of activeCases) {
		if (benchmarkCase.category === "contact_resolution") {
			const result = evaluateContactResolutionCase(benchmarkCase);
			caseResults.push(result);
		} else {
			// Intent cases: not implemented yet. This path should not be
			// reached in V1 since all intent cases are pending.
			caseResults.push({
				id: benchmarkCase.id,
				category: benchmarkCase.category,
				passed: false,
				expected: benchmarkCase.expected,
				actual: null,
				error: "Intent evaluation not implemented (awaits LangGraph pipeline)",
				durationMs: 0,
			});
		}
	}

	const passedCases = caseResults.filter((r) => r.passed).length;
	const failedCases = caseResults.filter((r) => !r.passed).length;

	// Compute per-category metrics using per-category active counts
	const crPassed = caseResults.filter(
		(r) => r.category === "contact_resolution" && r.passed,
	).length;
	const contactResolutionPrecision = activeCrCases.length > 0 ? crPassed / activeCrCases.length : 0;

	const readPassed = caseResults.filter((r) => r.category === "read_intent" && r.passed).length;
	const readAccuracy = activeReadCases.length > 0 ? readPassed / activeReadCases.length : 0;

	const writePassed = caseResults.filter((r) => r.category === "write_intent" && r.passed).length;
	const writeAccuracy = activeWriteCases.length > 0 ? writePassed / activeWriteCases.length : 0;

	// False-positive mutation rate: cases where the system produced a mutating
	// action when the expected outcome was non-mutating. Only meaningful once
	// intent classification is active. For contact-resolution-only benchmarks,
	// this is always 0.
	const falsePositiveMutationRate = 0;

	const metrics: BenchmarkMetrics = {
		readAccuracy,
		writeAccuracy,
		contactResolutionPrecision,
		falsePositiveMutationRate,
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
		`Read Accuracy:                ${(report.metrics.readAccuracy * 100).toFixed(1)}%`,
		`Write Accuracy:               ${(report.metrics.writeAccuracy * 100).toFixed(1)}%`,
		`False Positive Mutation Rate:  ${(report.metrics.falsePositiveMutationRate * 100).toFixed(1)}%`,
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
