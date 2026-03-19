import type {
	BenchmarkCase,
	BenchmarkMetrics,
	CaseResult,
	ContactResolutionBenchmarkCase,
	IntentBenchmarkCase,
} from "@monica-companion/types";
import { matchContacts } from "../contact-resolution/matcher.js";
import {
	AMBIGUITY_GAP_THRESHOLD,
	MINIMUM_MATCH_THRESHOLD,
	RESOLVED_THRESHOLD,
} from "../contact-resolution/resolver.js";
import type { IntentClassificationResult } from "../graph/intent-schemas.js";
import { buildSystemPrompt } from "../graph/system-prompt.js";

/**
 * Classifier interface for intent evaluation.
 *
 * Reuses the same shape as the Classifier interface in classify-intent.ts
 * (per review LOW-5). Exported so tests can reference the type.
 */
export interface Classifier {
	invoke(messages: unknown[]): Promise<IntentClassificationResult>;
}

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
 * Evaluate a single intent benchmark case against the classifier.
 *
 * This evaluates intent classification and command-type accuracy only
 * (per MEDIUM-3 review finding). It does NOT assert on resolvedContactId
 * because contact resolution is covered by the existing 45 contact-resolution
 * benchmark cases. The contactRef check is a surface-level text extraction
 * check (case-insensitive substring match), not a resolution check.
 */
export async function evaluateIntentCase(
	benchmarkCase: IntentBenchmarkCase,
	classifier: Classifier,
): Promise<CaseResult> {
	const start = performance.now();
	const { utterance } = benchmarkCase.input;
	const { commandType: expectedCommandType, contactRef: expectedContactRef } =
		benchmarkCase.expected;

	try {
		const { HumanMessage, SystemMessage } = await import("@langchain/core/messages");
		const systemPrompt = buildSystemPrompt();
		const messages = [new SystemMessage(systemPrompt), new HumanMessage(utterance)];

		const result = await classifier.invoke(messages);
		const durationMs = performance.now() - start;

		const errors: string[] = [];

		// Check intent classification
		if (benchmarkCase.category === "write_intent") {
			if (result.intent !== "mutating_command") {
				errors.push(`intent: expected "mutating_command" but got "${result.intent}"`);
			}
			if (result.commandType !== expectedCommandType) {
				errors.push(
					`commandType: expected "${expectedCommandType}" but got "${result.commandType}"`,
				);
			}
		} else if (benchmarkCase.category === "read_intent") {
			if (result.intent !== "read_query") {
				errors.push(`intent: expected "read_query" but got "${result.intent}"`);
			}
			if (result.commandType !== expectedCommandType) {
				errors.push(
					`commandType: expected "${expectedCommandType}" but got "${result.commandType}"`,
				);
			}
		} else if (benchmarkCase.category === "clarification") {
			if (result.intent !== "clarification_response") {
				errors.push(`intent: expected "clarification_response" but got "${result.intent}"`);
			}
		}

		// Surface-level contactRef check (case-insensitive substring match)
		if (expectedContactRef && result.contactRef) {
			const normalizedExpected = expectedContactRef.toLowerCase();
			const normalizedActual = result.contactRef.toLowerCase();
			if (
				!normalizedActual.includes(normalizedExpected) &&
				!normalizedExpected.includes(normalizedActual)
			) {
				errors.push(`contactRef: expected "${expectedContactRef}" but got "${result.contactRef}"`);
			}
		}

		const passed = errors.length === 0;

		return {
			id: benchmarkCase.id,
			category: benchmarkCase.category,
			passed,
			expected: benchmarkCase.expected,
			actual: {
				intent: result.intent,
				commandType: result.commandType,
				contactRef: result.contactRef,
				confidence: result.confidence,
			},
			...(errors.length > 0 ? { error: errors.join("; ") } : {}),
			durationMs,
		};
	} catch (_error) {
		const durationMs = performance.now() - start;
		return {
			id: benchmarkCase.id,
			category: benchmarkCase.category,
			passed: false,
			expected: benchmarkCase.expected,
			actual: null,
			error: "Classifier error: failed to invoke classifier",
			durationMs,
		};
	}
}

/**
 * Run the full benchmark evaluation suite.
 *
 * Iterates over all cases, skips pending ones, evaluates active ones,
 * and computes aggregate metrics. Per-category active counts are used
 * for skip logic (MEDIUM-3 fix) so metrics for categories with zero
 * active cases are reported as 0 rather than producing NaN.
 *
 * When a classifier is provided, active intent cases (write_intent,
 * read_intent, clarification) are evaluated against it. When absent
 * (e.g., in CI without a real OpenAI key), intent cases are skipped
 * entirely and their metrics report as 0.
 */
export async function evaluateBenchmark(
	cases: BenchmarkCase[],
	classifier?: Classifier,
): Promise<EvaluationReport> {
	const caseResults: CaseResult[] = [];

	const activeCases = cases.filter((c) => c.status === "active");
	const pendingCases = cases.filter((c) => c.status === "pending");

	// Per-category active counts
	const activeCrCases = activeCases.filter((c) => c.category === "contact_resolution");

	for (const benchmarkCase of activeCases) {
		if (benchmarkCase.category === "contact_resolution") {
			const result = evaluateContactResolutionCase(benchmarkCase);
			caseResults.push(result);
		} else if (classifier) {
			// Intent case with classifier provided: evaluate against the LLM
			const result = await evaluateIntentCase(benchmarkCase as IntentBenchmarkCase, classifier);
			caseResults.push(result);
		}
		// When no classifier is provided, intent cases are silently skipped.
		// They are not counted as passed or failed -- just unevaluated.
	}

	const passedCases = caseResults.filter((r) => r.passed).length;
	const failedCases = caseResults.filter((r) => !r.passed).length;

	// Compute per-category metrics using per-category active counts
	const crPassed = caseResults.filter(
		(r) => r.category === "contact_resolution" && r.passed,
	).length;
	const contactResolutionPrecision = activeCrCases.length > 0 ? crPassed / activeCrCases.length : 0;

	// For intent metrics, use evaluated case counts (not active counts)
	// since intent cases may be skipped when no classifier is provided.
	const evaluatedReadResults = caseResults.filter((r) => r.category === "read_intent");
	const readPassed = evaluatedReadResults.filter((r) => r.passed).length;
	const readAccuracy =
		evaluatedReadResults.length > 0 ? readPassed / evaluatedReadResults.length : 0;

	const evaluatedWriteResults = caseResults.filter((r) => r.category === "write_intent");
	const writePassed = evaluatedWriteResults.filter((r) => r.passed).length;
	const writeAccuracy =
		evaluatedWriteResults.length > 0 ? writePassed / evaluatedWriteResults.length : 0;

	// False-positive mutation rate: cases where the system produced a mutating
	// action when the expected outcome was non-mutating.
	// Count evaluated cases where expected.isMutating === false
	const nonMutatingResults = caseResults.filter((r) => {
		// Find the original case to check expected.isMutating
		const original = cases.find((c) => c.id === r.id);
		if (!original || original.category === "contact_resolution") return false;
		return (original as IntentBenchmarkCase).expected.isMutating === false;
	});

	let falsePositiveCount = 0;
	for (const r of nonMutatingResults) {
		const actual = r.actual as { intent?: string } | null;
		if (actual?.intent === "mutating_command") {
			falsePositiveCount++;
		}
	}

	const falsePositiveMutationRate =
		nonMutatingResults.length > 0 ? falsePositiveCount / nonMutatingResults.length : 0;

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
