---
verdict: APPROVED
attempt: 1
biome_pass: true
tests_pass: true
test_summary: "601 passed, 35 skipped, 1 failed (pre-existing PostgreSQL integration test)"
critical_count: 0
high_count: 0
medium_count: 1
low_count: 2
---

# Code Review: Stage 5 -- Testing & Acceptance Parity

## Automated Checks

- **Biome**: PASS. 0 errors, 126 pre-existing warnings, 6 infos. No new errors introduced.
- **Tests**: 601 passed, 35 skipped across 48 passing test files. 1 failed file (`src/pending-command/__tests__/repository.integration.test.ts`) is a pre-existing failure requiring a running PostgreSQL instance -- unrelated to Stage 5 changes.

## Findings

### CRITICAL
(none)

### HIGH
(none)

### MEDIUM
1. [MEDIUM] `services/ai-router/promptfoo/provider.ts:62` -- `JSON.parse(rawHistory)` has no try-catch. If a malformed `conversationHistory` value is placed in a YAML dataset, the provider will throw an unhandled error with a raw stack trace rather than returning a descriptive error to promptfoo. **Fix:** Wrap the `JSON.parse` in a try-catch and return `{ output: JSON.stringify({ error: "Invalid conversationHistory JSON" }) }` on failure, or use Zod validation on the parsed array to match the project's contract validation rule.

### LOW
1. [LOW] `services/ai-router/promptfoo/provider.ts:68-73` -- The plan (Step 5, line 194) specifies `timeout: 60_000` on the `openai.chat.completions.create()` call, but the implementation omits it. The OpenAI SDK default timeout (600s) applies. While this is test-only code and promptfoo's `check-thresholds.ts` enforces a 15-minute outer timeout, the explicit timeout from the plan should be included for consistency with the reliability rules. **Fix:** Add `timeout: 60_000` to the create options at line 72.

2. [LOW] `scripts/orchestrate-runner/run.ts` -- 305 insertions and 51 deletions to the orchestration runner are included in the working tree diff but are not part of the Stage 5 plan or implementation summary. These changes should be committed separately to keep the diff focused on Stage 5. **Fix:** Stage and commit orchestrate-runner changes in a separate commit, or explicitly exclude from the Stage 5 commit.

## Plan Compliance

The implementation follows the approved plan closely. All 11 gaps identified in Step 1 of the plan are addressed:

| Gap | Status |
|-----|--------|
| G1: query_phone/query_last_note loop tests | Done (4 tests in loop.test.ts) |
| G2: Multi-turn disambiguation integration test | Done (2 scenarios in multi-turn-disambiguation.integration.test.ts) |
| G3: History truncation content verification | Done (3 tests in history-repository.test.ts) |
| G4: Promptfoo provider rewrite | Done (provider.ts uses OpenAI SDK) |
| G5: 210 promptfoo assertions migrated | Done (all 210 original cases updated) |
| G6: Multi-turn eval cases | Done (5 cases in multi-turn.yaml) |
| G7: False-positive eval cases | Done (10 cases, fp-001 to fp-010) |
| G8: vitest.bench.config.ts alias cleanup | Done (2 LangChain aliases removed) |
| G9: vitest.config.ts alias cleanup | Deferred (documented -- alias still needed) |
| G10: OPENAI_API_KEY -> LLM_API_KEY | Done (check-thresholds.ts and provider.ts) |
| G11: contactResolution metric | Done (0.95 threshold in check-thresholds.ts) |

**Documented deviations from plan:**
1. `vitest.config.ts` `@langchain/core/messages` alias retained -- justified (imports still exist in production code).
2. Clarification Group B/C `conversationHistory` content uses natural user language instead of meta-summaries -- improvement over plan spec, acceptable.
3. Group C search queries corrected to use kinship terms instead of verbs -- improvement over plan spec, acceptable.

**Case counts verified:**
- write-intents.yaml: 102 cases (matches plan)
- read-intents.yaml: 60 cases (matches plan)
- clarification.yaml: 33 cases (matches plan)
- guardrails.yaml: 25 cases (15 original + 10 false-positive, total matches plan's 15+10)
- multi-turn.yaml: 5 cases (matches plan)
- Total: 225 cases

## Verdict Rationale

All automated checks pass (Biome: 0 errors; Tests: 601 passed, 1 pre-existing failure unrelated to Stage 5). No CRITICAL or HIGH findings. The single MEDIUM finding (unguarded JSON.parse in the promptfoo provider) is a test-tooling robustness issue -- the input is controlled YAML authored by the team, not user-supplied data, so the risk of actual failure is low. It does not represent a security or production reliability concern.

The implementation is thorough and well-structured:
- New Vitest tests cover the identified gaps with proper mock choreography
- The Artillery Park multi-turn integration test directly validates the regression that motivated the tool-calling migration
- Promptfoo datasets are comprehensive with consistent assertion patterns
- Security: all data is synthetic, API keys are read from env vars only, no credentials in test fixtures
- Service boundaries: all changes are within ai-router, no cross-boundary leaks
- The check-thresholds.ts properly uses Zod validation for promptfoo output format

APPROVED
