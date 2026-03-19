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
 * When OPENAI_API_KEY is not a real key (e.g., CI with sk-fake-ci-key),
 * the classifier is not provided and intent cases are skipped. Only
 * contact-resolution precision is enforced in that mode.
 *
 * When OPENAI_API_KEY is a real key, all thresholds are enforced.
 *
 * The CI quality gate (pnpm bench:ai) is the primary verification mechanism.
 * The Docker smoke test is a regression guard only (LOW-5 review finding).
 */
import { beforeAll, describe, expect, it } from "vitest";
import type { Classifier, EvaluationReport } from "../evaluate.js";
import { evaluateBenchmark, formatBenchmarkSummary } from "../evaluate.js";
import { allBenchmarkCases } from "../fixtures/index.js";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? "";
const isRealKey = OPENAI_API_KEY.length > 0 && !OPENAI_API_KEY.startsWith("sk-fake");

let report: EvaluationReport;

beforeAll(async () => {
	let classifier: Classifier | undefined;

	if (isRealKey) {
		// Dynamically import the classifier factory only when we have a real key
		const { createIntentClassifier } = await import("../../graph/llm.js");
		classifier = createIntentClassifier({ openaiApiKey: OPENAI_API_KEY });
	}

	report = await evaluateBenchmark(allBenchmarkCases, classifier);
});

describe("Benchmark Quality Gates", () => {
	it("contact-resolution precision meets threshold (>= 95%)", () => {
		expect(report.metrics.contactResolutionPrecision).toBeGreaterThanOrEqual(0.95);
	});

	it("read accuracy meets threshold (>= 92%) when evaluated", () => {
		if (!isRealKey) {
			// No real key: intent cases were skipped, readAccuracy is 0
			expect(report.metrics.readAccuracy).toBe(0);
			return;
		}
		expect(report.metrics.readAccuracy).toBeGreaterThanOrEqual(0.92);
	});

	it("write accuracy meets threshold (>= 90%) when evaluated", () => {
		if (!isRealKey) {
			// No real key: intent cases were skipped, writeAccuracy is 0
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

	it("all evaluated cases pass", () => {
		const failed = report.caseResults.filter((r) => !r.passed);
		// Print failed case IDs for debugging
		expect(failed.map((f) => `${f.id}: ${f.error}`)).toEqual([]);
	});

	it("prints benchmark summary for CI output", () => {
		console.log(formatBenchmarkSummary(report));
	});
});
