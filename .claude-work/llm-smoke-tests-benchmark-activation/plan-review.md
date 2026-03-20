---
verdict: APPROVED
attempt: 1
critical_count: 0
high_count: 0
medium_count: 3
---

# Plan Review: LLM Smoke Tests & Benchmark Activation

## Findings

### CRITICAL
(none)

### HIGH
(none)

### MEDIUM

1. [MEDIUM] **Roadmap path wording vs. actual test path.** The roadmap sub-item for command parsing smoke tests says "through the live `telegram-bridge -> ai-router` path," but the plan bypasses `telegram-bridge` entirely and sends HTTP requests directly to `ai-router /internal/process`. The plan acknowledges this in the Out of Scope section with a valid rationale (LLM smoke tests target AI behavior, not webhook handling), and `testing-strategy.md` already describes this approach. However, the `testing-strategy.md` itself (line 87) also says "through the live `telegram-bridge -> ai-router` path," creating a documentation inconsistency. -- **Fix:** During Step 11, update `testing-strategy.md` line 87 to say "through the live `ai-router /internal/process` endpoint (bypassing `telegram-bridge`, which has its own smoke tests)" so the documentation matches the actual implementation. Optionally add a brief note in the plan's Step 11 about reconciling this wording.

2. [MEDIUM] **GitHub Actions workflow service list inconsistency.** Step 10's `.github/workflows/llm-smoke.yml` lists services to start as "ai-router, user-management, delivery, scheduler" but omits `monica-integration`. The Test Strategy section (Docker Compose services to start) correctly includes `monica-integration` as a required service because `ai-router` calls it for contact resolution. If `monica-integration` is not running, contact resolution calls from the LangGraph pipeline will fail, potentially causing smoke test failures or masking real behavior. -- **Fix:** Add `monica-integration` to the service list in Step 10's GA workflow YAML and ensure `MONICA_INTEGRATION_URL` (or equivalent) is provided in the environment.

3. [MEDIUM] **Benchmark `evaluateIntentCase` does not use fixture `contactContext`.** Step 7 proposes calling the classifier directly with `buildSystemPrompt()` (no conversation history) and the utterance. The `IntentBenchmarkCase` schema includes `input.contactContext` (an array of `ContactResolutionSummary`), but `buildSystemPrompt()` does not accept or inject a contact list. This means the `contactRef` and `resolvedContactId` assertions in `evaluateIntentCase` will depend solely on what the LLM extracts from the utterance text, not on matching against provided contacts. -- **Fix:** In Step 7, document explicitly that `evaluateIntentCase` evaluates **intent classification and command-type accuracy only**. Skip `resolvedContactId` assertions entirely (contact resolution is covered by the existing 45 contact-resolution benchmark cases). The `contactRef` check should be documented as a surface-level text extraction check, not a resolution check.

### LOW

1. [LOW] **Fixture count test thresholds need explicit mention.** Step 6 TDD says "Update `fixtures.test.ts` first to assert the new minimum counts (4 read, 8 write, 4 clarification, all active)." The existing `fixtures.test.ts` asserts `>= 10` write stubs and `>= 6` read stubs. After the planned cleanup, there will be 8 write and 4 read. The TDD step should explicitly state: "Lower the `fixtures.test.ts` assertions from `>= 10` write / `>= 6` read to `>= 8` write / `>= 4` read to match the post-cleanup case counts."

2. [LOW] **Direct DB queries in smoke tests.** Steps 3 and 4 query the `pending_commands` table directly via a Postgres client from smoke test code. Technically acceptable since smoke tests are external verification code, not another service. Add a brief comment in the `helpers.ts` DB query function noting this is test-only verification code.

3. [LOW] **Module-level `evaluateBenchmark` call becomes async.** Already addressed in Step 9. No additional action needed.

4. [LOW] **Smoke test flakiness mitigation.** Consider adding a Vitest `retry` option (e.g., `retry: 1`) to the smoke test config for individual test-level retries.

5. [LOW] **`Classifier` interface reuse.** Export the existing `Classifier` interface from `classify-intent.ts` and reuse it in `evaluate.ts` rather than re-declaring it inline.

## Architecture Boundary Compliance

- **Service boundaries respected:** All smoke test code within `services/ai-router/src/__smoke__/`.
- **Caller allowlists:** Smoke tests authenticate as `telegram-bridge` (the legitimate caller of `ai-router /internal/process`).
- **DRY:** Reuses `@monica-companion/auth`, `@monica-companion/types`, follows existing patterns.

## Security Compliance

- OpenAI API key from env, never hardcoded
- JWT signing via shared auth package
- Random UUID test user IDs, no real PII
- No raw LLM responses in logs
- Redaction preserved

## Completeness Check

All 7 roadmap sub-items are covered:
1. Command parsing smoke tests -- Step 2
2. Multi-stage dialog smoke tests -- Step 4
3. Context preservation smoke tests -- Step 5
4. Out-of-scope rejection smoke tests -- Step 3
5. Activate pending intent benchmark cases + intent evaluation -- Steps 6-7
6. False-positive mutation rate tracking -- Step 8
7. Release gate enforcement -- Steps 9-10

## Verdict Rationale

The plan is well-structured, appropriately scoped, and aligned with the roadmap requirements. The three MEDIUM findings are documentation/consistency issues and a design clarification -- none represent architectural mistakes or security gaps. No CRITICAL or HIGH issues were found.
