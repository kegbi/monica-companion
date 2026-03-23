/**
 * Threshold-checking wrapper for promptfoo eval.
 *
 * Runs `npx promptfoo eval`, parses the JSON results, groups by
 * metadata.category, and enforces per-category accuracy thresholds.
 *
 * Thresholds (from acceptance-criteria.md):
 * - Read accuracy >= 92%
 * - Write accuracy >= 90%
 * - Contact-resolution precision >= 95%
 * - False-positive mutation rate < 1%
 *
 * When LLM_API_KEY is missing or starts with "sk-fake", the script
 * prints a skip message and exits 0 (CI compatibility).
 *
 * Uses Zod schema validation for promptfoo's JSON output
 * to detect format changes early rather than failing silently.
 *
 * Total expected cases: ~225 (102 write + 60 read + 33 clarification
 * + 25 guardrails + 5 multi-turn).
 *
 * Pinned to promptfoo 0.121.2 output format.
 */

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { z } from "zod";

// ── Zod schema for promptfoo JSON output (pinned to 0.121.2) ──────────

/**
 * Schema for a single promptfoo test result.
 *
 * We validate only the fields we consume. Additional fields from
 * promptfoo are allowed and ignored (passthrough).
 */
const PromptfooTestResultSchema = z
	.object({
		success: z.boolean(),
		vars: z.record(z.unknown()).optional(),
		metadata: z
			.object({
				id: z.string().optional(),
				category: z.string().optional(),
			})
			.passthrough()
			.optional(),
		namedScores: z.record(z.number()).optional(),
		response: z
			.object({
				output: z.string().optional(),
			})
			.passthrough()
			.optional(),
	})
	.passthrough();

const PromptfooOutputSchema = z
	.object({
		results: z
			.object({
				results: z.array(PromptfooTestResultSchema),
			})
			.passthrough(),
	})
	.passthrough();

type PromptfooTestResult = z.infer<typeof PromptfooTestResultSchema>;

// ── Thresholds ─────────────────────────────────────────────────────────

const READ_ACCURACY_THRESHOLD = 0.92;
const WRITE_ACCURACY_THRESHOLD = 0.9;
const FALSE_POSITIVE_MUTATION_THRESHOLD = 0.01;
const CONTACT_RESOLUTION_THRESHOLD = 0.95;

// ── Main ───────────────────────────────────────────────────────────────

const LLM_API_KEY = process.env.LLM_API_KEY ?? "";

if (!LLM_API_KEY || LLM_API_KEY.startsWith("sk-fake")) {
	console.log("Skipping promptfoo eval (no real API key)");
	process.exit(0);
}

const RESULTS_PATH = "promptfoo/results.json";

console.log("Running promptfoo eval...");

try {
	execSync(`npx promptfoo eval --no-cache --output ${RESULTS_PATH}`, {
		stdio: "inherit",
		timeout: 900_000, // 15 minute timeout for ~225 LLM calls
	});
} catch {
	console.error("promptfoo eval failed");
	process.exit(1);
}

console.log("\nParsing results...\n");

let rawJson: unknown;
try {
	const fileContent = readFileSync(RESULTS_PATH, "utf-8");
	rawJson = JSON.parse(fileContent);
} catch {
	console.error(`Failed to read or parse ${RESULTS_PATH}`);
	process.exit(1);
}

// Validate against Zod schema
const parseResult = PromptfooOutputSchema.safeParse(rawJson);
if (!parseResult.success) {
	console.error("promptfoo output format does not match expected schema.");
	console.error("This may indicate a promptfoo version change. Expected format pinned to 0.121.2.");
	console.error("Validation errors:", JSON.stringify(parseResult.error.issues, null, 2));
	process.exit(1);
}

const { results } = parseResult.data.results;

// ── Group by category ──────────────────────────────────────────────────

function groupByCategory(results: PromptfooTestResult[]): Map<string, PromptfooTestResult[]> {
	const groups = new Map<string, PromptfooTestResult[]>();
	for (const r of results) {
		const category = r.metadata?.category ?? "unknown";
		const group = groups.get(category) ?? [];
		group.push(r);
		groups.set(category, group);
	}
	return groups;
}

const groups = groupByCategory(results);

// ── Compute metrics ────────────────────────────────────────────────────

const readResults = groups.get("read_intent") ?? [];
const writeResults = groups.get("write_intent") ?? [];
const guardrailResults = groups.get("guardrails") ?? [];

const readPassed = readResults.filter((r) => r.success).length;
const readAccuracy = readResults.length > 0 ? readPassed / readResults.length : 0;

const writePassed = writeResults.filter((r) => r.success).length;
const writeAccuracy = writeResults.length > 0 ? writePassed / writeResults.length : 0;

// False-positive mutation rate: count guardrail cases where
// isMutating score is 0 (meaning the assertion failed -- a mutating tool WAS called)
let fpMutationCount = 0;
for (const r of guardrailResults) {
	const isMutatingScore = r.namedScores?.isMutating;
	if (isMutatingScore !== undefined && isMutatingScore === 0) {
		fpMutationCount++;
	}
}
const fpMutationRate = guardrailResults.length > 0 ? fpMutationCount / guardrailResults.length : 0;

// Contact-resolution precision: cases with contactResolution named score
// The contactResolution metric appears on write-intent, read-intent, clarification,
// and multi-turn cases that have a contact reference to validate.
const contactResolutionResults = results.filter(
	(r) => r.namedScores?.contactResolution !== undefined,
);
const crPassed = contactResolutionResults.filter(
	(r) => (r.namedScores?.contactResolution ?? 0) > 0,
).length;
const crAccuracy =
	contactResolutionResults.length > 0 ? crPassed / contactResolutionResults.length : 0;

// ── Report ─────────────────────────────────────────────────────────────

console.log("=== promptfoo Quality Gates Report ===");
console.log("");
console.log("--- Per-Category Results ---");

for (const [category, categoryResults] of groups) {
	const passed = categoryResults.filter((r) => r.success).length;
	const total = categoryResults.length;
	const pct = total > 0 ? ((passed / total) * 100).toFixed(1) : "N/A";
	console.log(`  ${category}: ${passed}/${total} (${pct}%)`);

	// Print failed case IDs (no PII)
	const failed = categoryResults.filter((r) => !r.success);
	for (const f of failed) {
		const caseId = f.metadata?.id ?? "unknown";
		console.log(`    FAIL: ${caseId}`);
	}
}

console.log("");
console.log("--- Threshold Checks ---");
console.log(
	`  Read accuracy:     ${(readAccuracy * 100).toFixed(1)}% (threshold: >= ${(READ_ACCURACY_THRESHOLD * 100).toFixed(0)}%) ${readAccuracy >= READ_ACCURACY_THRESHOLD ? "PASS" : "FAIL"}`,
);
console.log(
	`  Write accuracy:    ${(writeAccuracy * 100).toFixed(1)}% (threshold: >= ${(WRITE_ACCURACY_THRESHOLD * 100).toFixed(0)}%) ${writeAccuracy >= WRITE_ACCURACY_THRESHOLD ? "PASS" : "FAIL"}`,
);
console.log(
	`  FP mutation rate:  ${(fpMutationRate * 100).toFixed(1)}% (threshold: < ${(FALSE_POSITIVE_MUTATION_THRESHOLD * 100).toFixed(0)}%) ${fpMutationRate < FALSE_POSITIVE_MUTATION_THRESHOLD ? "PASS" : "FAIL"}`,
);
console.log(
	`  Contact resolution: ${(crAccuracy * 100).toFixed(1)}% (threshold: >= ${(CONTACT_RESOLUTION_THRESHOLD * 100).toFixed(0)}%) ${crAccuracy >= CONTACT_RESOLUTION_THRESHOLD ? "PASS" : "FAIL"}`,
);
console.log("");
console.log("=== End Report ===");

// ── Exit code ──────────────────────────────────────────────────────────

const allPass =
	readAccuracy >= READ_ACCURACY_THRESHOLD &&
	writeAccuracy >= WRITE_ACCURACY_THRESHOLD &&
	fpMutationRate < FALSE_POSITIVE_MUTATION_THRESHOLD &&
	crAccuracy >= CONTACT_RESOLUTION_THRESHOLD;

if (!allPass) {
	console.error("\nThreshold check FAILED. See report above.");
	process.exit(1);
}

console.log("\nAll thresholds passed.");
process.exit(0);
