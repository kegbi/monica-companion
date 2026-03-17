/**
 * Benchmark Quality Gates
 *
 * This test file runs the full benchmark evaluation against all fixture
 * cases and asserts that metrics meet the acceptance-criteria thresholds.
 *
 * Thresholds are derived from context/product/acceptance-criteria.md:
 * - Read accuracy >= 92%
 * - Write accuracy >= 90%
 * - Contact-resolution precision >= 95%
 * - False-positive mutation rate < 1%
 *
 * The CI quality gate (pnpm bench:ai) is the primary verification mechanism.
 * The Docker smoke test is a regression guard only (LOW-5 review finding).
 */
import { describe, expect, it } from "vitest";
import { evaluateBenchmark, formatBenchmarkSummary } from "../evaluate.js";
import { allBenchmarkCases } from "../fixtures/index.js";

const report = evaluateBenchmark(allBenchmarkCases);

describe("Benchmark Quality Gates", () => {
	it("contact-resolution precision meets threshold (>= 95%)", () => {
		expect(report.metrics.contactResolutionPrecision).toBeGreaterThanOrEqual(0.95);
	});

	it("read accuracy meets threshold (>= 92%) when active read cases exist", () => {
		// MEDIUM-3 fix: guard on per-category active count, not total activeCases
		const activeReadCount = allBenchmarkCases.filter(
			(c) => c.category === "read_intent" && c.status === "active",
		).length;
		if (activeReadCount === 0) {
			// No active read cases yet; skip threshold assertion
			expect(report.metrics.readAccuracy).toBe(0);
			return;
		}
		expect(report.metrics.readAccuracy).toBeGreaterThanOrEqual(0.92);
	});

	it("write accuracy meets threshold (>= 90%) when active write cases exist", () => {
		// MEDIUM-3 fix: guard on per-category active count, not total activeCases
		const activeWriteCount = allBenchmarkCases.filter(
			(c) => c.category === "write_intent" && c.status === "active",
		).length;
		if (activeWriteCount === 0) {
			// No active write cases yet; skip threshold assertion
			expect(report.metrics.writeAccuracy).toBe(0);
			return;
		}
		expect(report.metrics.writeAccuracy).toBeGreaterThanOrEqual(0.9);
	});

	it("false-positive mutation rate stays below threshold (< 1%)", () => {
		expect(report.metrics.falsePositiveMutationRate).toBeLessThan(0.01);
	});

	it("has at least the minimum number of active contact-resolution cases", () => {
		const activeCrCases = allBenchmarkCases.filter(
			(c) => c.category === "contact_resolution" && c.status === "active",
		).length;
		expect(activeCrCases).toBeGreaterThanOrEqual(40);
	});

	it("all active cases pass", () => {
		const failed = report.caseResults.filter((r) => !r.passed);
		// Print failed case IDs for debugging
		expect(failed.map((f) => `${f.id}: ${f.error}`)).toEqual([]);
	});

	it("prints benchmark summary for CI output", () => {
		console.log(formatBenchmarkSummary(report));
	});
});
