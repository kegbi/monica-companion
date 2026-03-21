---
verdict: APPROVED
attempt: 1
critical_count: 0
high_count: 0
medium_count: 2
---

# Plan Review: Migrate LLM Evaluation to promptfoo

## Findings

### CRITICAL
(none)

### HIGH
(none)

### MEDIUM

1. [MEDIUM] **TS intent fixture files and `fixtures.test.ts` become partially dead code after migration.** After the migration, the TS intent fixture files (`write-intents.ts`, `read-intents.ts`, `clarification-turns.ts`, `out-of-scope-turns.ts`, `greeting-turns.ts`) remain in the codebase. They continue to be imported by `fixtures/index.ts` into `allBenchmarkCases`, loaded at test time, and validated by `fixtures.test.ts`. However, no evaluation code path consumes them after `evaluateIntentCase()` is deleted -- promptfoo uses its own YAML datasets. This creates two copies of the same data (TS and YAML) that can drift silently. — **Fix:** Delete the TS intent fixture files, remove their imports from `fixtures/index.ts`, slim `allBenchmarkCases` to contact-resolution cases only, and slim `fixtures.test.ts` to contact-resolution validation only. YAML becomes the source of truth.

2. [MEDIUM] **`check-thresholds.ts` creates a fragile coupling to promptfoo's JSON output format.** The wrapper script reads `promptfoo/results.json`, groups results by `metadata.category`, and extracts pass/fail status. This depends on promptfoo's specific JSON output structure, which is not a documented stable API contract. — **Fix:** Define a small Zod schema in the script that validates the expected promptfoo output shape before parsing. Document the expected JSON structure inline referencing the pinned promptfoo version.

### LOW

1. [LOW] `BenchmarkMetrics` in `@monica-companion/types` retains intent fields set to 0. Documented as follow-up.
2. [LOW] Missing YAML language server schema directive in `promptfooconfig.yaml`. Add it.
3. [LOW] YAML test entries should include a `description` field for promptfoo reporting.
4. [LOW] Provider must use ESM default export syntax (not CommonJS). Verify at implementation.
5. [LOW] After migration, `allBenchmarkCases` still loads intent fixtures but skips them. Resolve via MEDIUM-1.

## Completeness Check

All 9 roadmap sub-items are covered by the plan steps.

## Architecture & Security

- All changes scoped to `services/ai-router` dev tooling. No boundary violations.
- Promptfoo is dev-only, excluded from production builds.
- API key handled via environment, never hardcoded or logged.
- YAML datasets contain only synthetic data.
- `results.json` gitignored.

## Verdict Rationale

Well-structured plan covering all roadmap sub-items. Two MEDIUM findings have clear mitigation paths. No CRITICAL or HIGH issues.
