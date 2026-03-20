---
verdict: APPROVED
attempt: 1
biome_pass: true
tests_pass: true
test_summary: "238 passed, 0 failed (61 skipped — pre-existing: 22 integration, 39 infra-dep)"
critical_count: 0
high_count: 0
medium_count: 1
---

# Code Review: End-to-End Pipeline Wiring

## Automated Checks
- **Biome**: PASS. 143 warnings (all pre-existing in guardrails and other unrelated packages), 0 errors. No new warnings introduced by this change.
- **Tests**: 238 passed, 0 failed. 6 test files fail identically on clean HEAD (missing `ioredis`, `@opentelemetry/resources`, and no PostgreSQL for integration tests). These are pre-existing infrastructure failures, not caused by this change. The 20 passing test files include all changed test files:
  - `execute-action.test.ts`: 27 passed (14 new)
  - `graph.test.ts`: 21 passed (8 new)

## Findings

### CRITICAL
(none)

### HIGH
(none)

### MEDIUM

1. [MEDIUM] `services/ai-router/src/graph/nodes/execute-action.ts:180` — The `console.warn` on payload validation failure is appropriate per LOW-1 of the plan review, but uses `console.warn` directly rather than a structured logger from `@monica-companion/observability`. In a production service, direct console usage bypasses OpenTelemetry log instrumentation and will not appear in the centralized log pipeline. — **Fix:** Replace `console.warn(...)` with the service's structured logger when the observability wiring is completed in a future task. This is acceptable for now since ai-router does not yet have a wired structured logger instance in execute-action scope, and the log content itself (commandType + correlationId only) is safe.

### LOW

1. [LOW] `services/ai-router/src/graph/nodes/execute-action.ts:522` — The `handleSelect` function re-checks `!activePendingCommand` at line 522, but this condition was already checked and short-circuited in `handleCallbackAction` at line 331, which means the inner check is dead code in the current call flow. — **Fix:** This is a defensive guard and is acceptable. No change needed, but a comment noting it is defense-in-depth would improve clarity.

2. [LOW] `services/ai-router/src/graph/nodes/execute-action.ts:169` — The `as MutatingCommandPayload` cast on line 169 is used both in `handleMutatingCommand` (line 169) and `handleClarificationResponse` (line 231). When `needsClarification` is false, the payload is validated via `MutatingCommandPayloadSchema.safeParse()` before this point (Step 1), so the cast is safe. When `needsClarification` is true, the cast is intentionally loose. For `handleClarificationResponse`, the payload is not validated before update, relying on eventual validation when the clarification resolves and the draft transitions to pending_confirmation. This is the documented design and is acceptable.

3. [LOW] `services/ai-router/src/graph/__tests__/graph.test.ts:9` — The `any` type cast in the ChatOpenAI mock constructor (`this: any`) is a pre-existing pattern not introduced by this change. All new test code follows the existing pattern.

4. [LOW] `tests/smoke/e2e-pipeline-wiring.mjs:24` — The JWT secret `"change-me-in-production"` is a well-known test placeholder matching the `.env.example` default. It is appropriate for smoke tests running inside the Docker network. Not a security concern.

## Plan Compliance

The implementation closely follows the approved plan across all 6 steps:

1. **Step 1 (Conditional payload validation)**: Implemented as planned. `MutatingCommandPayloadSchema.safeParse()` is called when `needsClarification` is false; incomplete drafts skip validation. Three test cases cover invalid complete, valid incomplete, and valid complete payloads.

2. **Step 2 (TTL expiry check)**: Implemented as planned. `expiresAt < new Date()` check added after `getPendingCommand` in `handleCallbackAction`. Also added in `handleSelect` for consistency. One test case covers the TTL expiry path.

3. **Step 3 (Draft payload updates for clarification)**: Implemented as planned. `handleClarificationResponse` function replaces the passthrough. `updateDraftPayload` wired through `ExecuteActionDeps`, `ConversationGraphConfig`, and `createApp`. Four test cases cover resolved, incomplete, no active command, and no commandPayload paths.

4. **Step 4 (Select callback wiring)**: Implemented as planned. `handleSelect` created as a dedicated function. Select callbacks branch before the version check. The old unreachable `case "select"` in the switch was removed. LLM fallback guard added per LOW-2. Five test cases cover all paths.

5. **Step 5 (Compiled graph integration tests)**: Implemented as planned. Eight integration tests added covering auto-confirm, confirm round-trip, cancel round-trip, edit round-trip, stale rejection, read-only bypass, out-of-scope rejection, and three-step clarification flow.

6. **Step 6 (Smoke test extensions)**: Implemented as planned. Sections 9 and 10 added for delivery contract validation and scheduler contract validation respectively.

**Review findings addressed**:
- MEDIUM-1 (DRY): `transitionToConfirmationAndCheckAutoConfirm` helper extracted and used by three callers.
- LOW-1 (Structured warning): `console.warn` with commandType and correlationId added.
- LOW-2 (LLM fallback guard): Guard for `out_of_scope` and `greeting` intents at top of `handleSelect`.

**Deviations**:
- Test fixture updates (adding `contactId: 42` and future-dated `expiresAt`) were necessary to prevent failures from the newly added payload validation and TTL checks. These are justified adaptations.
- Non-null assertion operators (`!`) replaced with optional chaining (`?.`) in pre-existing graph tests. This is a minor improvement, not a deviation.
- The removed `ActionOutcome` import in `execute-action.test.ts` was unused after the import of `PendingCommandRef` was sufficient. Not a deviation.
- Step 5 tests were written after Steps 1-4 were implemented (not strict RED-GREEN-REFACTOR per step). This is documented in the impl-summary and is acceptable for integration tests that validate already-implemented behavior through the compiled graph.

## Unintended Removals Check

- No changes to `.env.example`, `docker-compose.yml`, `pnpm-workspace.yaml`, or any `index.ts` barrel exports.
- The only removal in `execute-action.ts` is the old unreachable `case "select"` passthrough (lines 309-312 in the old file), which was replaced by the new `handleSelect` function. This is an intentional plan change.
- The old inline transition-to-pending-confirmation logic in `handleMutatingCommand` was refactored into the shared `transitionToConfirmationAndCheckAutoConfirm` helper. Behavior is preserved.

## Verdict Rationale

All automated checks pass (Biome: 0 errors, Tests: 238/238 passed). No CRITICAL or HIGH findings. The single MEDIUM finding is about using `console.warn` instead of a structured logger, which is acceptable given the service does not yet have a wired logger instance in that scope and the logged content is safe (no PII). The implementation follows the approved plan faithfully, addresses all review findings from the plan review, and the code quality is good with proper error handling, defensive guards, and comprehensive test coverage across unit, integration, and smoke test layers.
