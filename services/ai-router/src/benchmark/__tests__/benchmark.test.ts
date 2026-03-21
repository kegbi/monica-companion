/**
 * Benchmark Quality Gates
 *
 * This test file runs the full benchmark evaluation against all fixture
 * cases and asserts that contact-resolution precision meets the
 * acceptance-criteria threshold (>= 95%).
 *
 * Intent classification thresholds (read accuracy, write accuracy,
 * false-positive mutation rate) have been migrated to promptfoo and
 * are enforced by promptfoo/check-thresholds.ts.
 *
 * The CI quality gate (pnpm bench:ai) is the primary verification mechanism.
 * The Docker smoke test is a regression guard only (LOW-5 review finding).
 */
import { beforeAll, describe, expect, it } from "vitest";
import type { EvaluationReport } from "../evaluate.js";
import { evaluateBenchmark, formatBenchmarkSummary } from "../evaluate.js";
import { allBenchmarkCases } from "../fixtures/index.js";

let report: EvaluationReport;

beforeAll(async () => {
	report = await evaluateBenchmark(allBenchmarkCases);
});

describe("Benchmark Quality Gates", () => {
	it("contact-resolution precision meets threshold (>= 95%)", () => {
		expect(report.metrics.contactResolutionPrecision).toBeGreaterThanOrEqual(0.95);
	});

	it("has at least the minimum number of active contact-resolution cases", () => {
		const activeCrCases = allBenchmarkCases.filter(
			(c) => c.category === "contact_resolution" && c.status === "active",
		).length;
		expect(activeCrCases).toBeGreaterThanOrEqual(40);
	});

	it("all evaluated cases pass", () => {
		const failed = report.caseResults.filter((r) => !r.passed);
		// Print failed case IDs for debugging
		expect(failed.map((f) => `${f.id}: ${f.error}`)).toEqual([]);
	});

	it("prints benchmark summary for CI output", () => {
		console.log(formatBenchmarkSummary(report));
	});
});
