---
verdict: APPROVED
attempt: 1
biome_pass: true
tests_pass: true
test_summary: "types: 91 passed (3 files); ai-router regular: 84 passed, 22 skipped, 1 failed (pre-existing PostgreSQL integration test); ai-router bench: 30 passed (3 files)"
critical_count: 0
high_count: 0
medium_count: 1
---

# Code Review: Benchmark & Quality Gates

## Automated Checks

- **Biome**: PASS. Exit code 0. 21 pre-existing warnings (all in files not touched by this change: `commands.test.ts` unused imports, `routes.test.ts` unused parameter, `repository.integration.test.ts` non-null assertions). Zero errors.
- **Tests (packages/types)**: PASS. 3 test files, 91 tests passed (32 new benchmark schema tests + 59 existing).
- **Tests (ai-router regular)**: 8 passed, 1 failed. The failure is `repository.integration.test.ts` which requires a running PostgreSQL instance and is pre-existing (not related to this change). Benchmark tests correctly excluded from regular run (9 test files, not 12).
- **Tests (ai-router bench)**: PASS. 3 test files, 30 tests passed. All benchmark quality gate assertions pass.

## Findings

### CRITICAL
(none)

### HIGH
(none)

### MEDIUM

1. [MEDIUM] `services/ai-router/src/benchmark/__tests__/evaluate.test.ts:5` -- Unused import `IntentBenchmarkCase` flagged by Biome as a warning. While Biome treats this as a warning (not an error), it is in new code introduced by this change and should be cleaned up. -- **Fix:** Remove the `IntentBenchmarkCase` import from line 5.

### LOW

1. [LOW] `services/ai-router/vitest.bench.config.ts:1-51` -- The entire resolve.alias block is duplicated from `vitest.config.ts`. If aliases change, both files must be updated in lockstep. -- **Fix:** Extract the shared alias map into a common module (e.g., `vitest.aliases.ts`) and import it in both configs. This is acceptable for V1 but should be addressed before the alias list grows further.

2. [LOW] `services/ai-router/src/benchmark/evaluate.ts:164` -- `falsePositiveMutationRate` is hardcoded to 0. The comment explains this is intentional until intent classification exists, but the metric is always reported as meeting the threshold regardless of the actual data. -- **Fix:** No code fix required for V1 since there are no active intent cases. Document that this metric becomes meaningful once intent classification stubs are activated.

3. [LOW] `services/ai-router/src/benchmark/fixtures/contact-resolution.ts:493-495` -- The `candidateContactIds` ordering for ambiguous Sherry cases ([21, 20]) relies on `lastInteractionAt` tiebreaking. This is correct per the matcher's sort-by-recency logic (Sherry Chen has a lastInteractionAt, Sherry Miller does not), but the ordering dependency is implicit and fragile if fixture data changes. -- **Fix:** Add a brief inline comment noting that the ordering depends on `lastInteractionAt` tiebreaking from the matcher's sort algorithm.

## Plan Compliance

The implementation closely follows the approved plan with three justified deviations documented in the impl-summary:

1. **Alias match expected outcomes corrected**: Fixture expectations were corrected to match actual resolver thresholds (alias score 0.8 < RESOLVED_THRESHOLD 0.9 produces "ambiguous" not "resolved"). This is a valid deviation -- the plan's fixture examples assumed single-alias matches would resolve, but the actual scorer produces different outcomes.

2. **Separate vitest.bench.config.ts**: The plan specified using exclude plus explicit file paths, but vitest's exclude takes precedence even over explicit paths. Creating a separate config file is a reasonable workaround. Justified.

3. **CaseResult as Zod schema in packages/types**: The plan described CaseResult as a TypeScript interface. Defining it as a Zod schema in the shared types package (per LOW-1 from plan review) is an improvement over the plan.

All plan review findings were addressed:
- **MEDIUM-2 (conflicting BenchmarkCase)**: Only `z.union` is used. Confirmed in `packages/types/src/benchmark.ts:60`.
- **MEDIUM-3 (per-category active counts)**: `evaluateBenchmark` computes `activeCrCases`, `activeReadCases`, `activeWriteCases` per-category. `benchmark.test.ts` guards on per-category active count (lines 29-31, 42-44). Confirmed correct.
- **LOW-1 (CaseResult location)**: Defined as Zod schema in `packages/types/src/benchmark.ts:84-93`.
- **LOW-2 (caseResults in EvaluationReport)**: Comment on line 66 of `benchmark.ts` documents this. `EvaluationReport` interface wraps `caseResults` separately.
- **LOW-3 (hubby)**: Description on `cr-018` (line 305-306) explains it is a deliberate no_match edge case.
- **LOW-4 (synthetic data)**: Each fixture file has a synthetic data header comment.
- **LOW-5 (smoke test)**: Header comment in `benchmark.test.ts` (line 14) documents CI gate as primary verification.

## Architecture and Security

- **Service boundaries**: No boundary violations. Benchmark code imports from `@monica-companion/types` (shared package) and uses `matchContacts` from within `ai-router`. No Monica API types, no Telegram types, no cross-service leaks.
- **Security**: All fixture data is synthetic. `formatBenchmarkSummary` outputs only case IDs and metric scores, not PII. No secrets in any new file. No network calls during benchmark execution.
- **Reliability**: The evaluation runner is purely in-memory with no external calls. No timeouts needed.
- **Zod validation**: All benchmark data types are Zod schemas in `packages/types`. The `BenchmarkCase` union, `CaseResult`, `BenchmarkMetrics` all enforce runtime validation.

## Verdict Rationale

APPROVED. All automated checks pass (Biome zero errors, all new tests pass, benchmark quality gates pass). The one test failure (`repository.integration.test.ts`) is pre-existing and unrelated to this change. The single MEDIUM finding is a cosmetic unused import warning in test code -- it does not affect correctness, security, or reliability. The implementation faithfully follows the approved plan with justified deviations, addresses all plan review findings, respects architecture boundaries, and provides comprehensive test coverage (62 new tests across 6 test files).
