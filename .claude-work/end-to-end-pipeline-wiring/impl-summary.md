# Implementation Summary: End-to-End Pipeline Wiring

## Files Changed

| File | Action | Description |
|------|--------|-------------|
| `services/ai-router/src/graph/nodes/execute-action.ts` | modified | Added conditional payload validation (Step 1), TTL expiry check at callback time (Step 2), `handleClarificationResponse` for draft updates (Step 3), `handleSelect` for disambiguation callbacks (Step 4), shared `transitionToConfirmationAndCheckAutoConfirm` helper (MEDIUM-1 review), `updateDraftPayload` to `ExecuteActionDeps` interface |
| `services/ai-router/src/graph/graph.ts` | modified | Added `updateDraftPayload` to `ConversationGraphConfig` interface and wired it to `createExecuteActionNode` deps |
| `services/ai-router/src/app.ts` | modified | Imported `updateDraftPayload` from repository and passed it to `createConversationGraph` config |
| `services/ai-router/src/graph/nodes/__tests__/execute-action.test.ts` | modified | Added 14 new test cases for Steps 1-4, updated existing fixtures to use valid payloads and future-dated `expiresAt` |
| `services/ai-router/src/graph/__tests__/graph.test.ts` | modified | Added 8 new compiled graph integration tests for Step 5 (auto-confirm, confirm/cancel/edit/stale callbacks, read-only, out-of-scope, 3-step clarification flow), wired `updateDraftPayload` mock |
| `tests/smoke/e2e-pipeline-wiring.mjs` | modified | Added Section 9 (delivery contract validation) and Section 10 (scheduler contract validation) |

## Tests Added

| Test File | What It Tests |
|-----------|---------------|
| `services/ai-router/src/graph/nodes/__tests__/execute-action.test.ts` | **Step 1**: rejects invalid complete payload, allows incomplete draft payload, accepts valid complete payload. **Step 2**: rejects TTL-expired command at callback time. **Step 3**: updates draft + transitions on resolved clarification, stays in draft on incomplete clarification, passthrough when no active command, passthrough when no commandPayload. **Step 4**: select not stale-rejected with version 0, select updates draft + transitions, select stays in draft when needsClarification, select rejects without active draft, select guards against LLM fallback. |
| `services/ai-router/src/graph/__tests__/graph.test.ts` | **Step 5**: Auto-confirm round-trip, confirm callback round-trip, cancel callback round-trip, edit callback round-trip, stale version rejection, read-only query bypass, out-of-scope rejection, 3-step clarification->resolution->confirm flow. |
| `tests/smoke/e2e-pipeline-wiring.mjs` | **Step 6**: Delivery contract validation (POST /internal/deliver with valid OutboundMessageIntent), Scheduler contract validation (POST /internal/execute with valid ConfirmedCommandPayload). |

## Verification Results

- **Biome**: `pnpm check:fix` completed. 0 errors in modified production files. 4 pre-existing `any` warnings in test files (unchanged pattern from before). Zero new warnings introduced.
- **Tests**:
  - `execute-action.test.ts`: 27/27 passed (14 new + 13 existing)
  - `graph.test.ts`: 21/21 passed (8 new + 13 existing)
  - Full `src/graph/` directory: 151/151 passed (11 test files)
  - Full `ai-router` test suite: 238/238 unit tests passed. 6 integration test files skipped (require PostgreSQL, expected without Docker).

## Review Findings Addressed

| Finding | How Addressed |
|---------|---------------|
| MEDIUM-1: Extract shared helper for DRY | Created `transitionToConfirmationAndCheckAutoConfirm()` used by `handleMutatingCommand`, `handleClarificationResponse`, and `handleSelect` |
| LOW-1: Log structured warning on payload validation failure | Added `console.warn` with commandType and correlationId (no PII) when `MutatingCommandPayloadSchema.safeParse` fails |
| LOW-2: Guard against LLM fallback in handleSelect | Added check for `intent === "out_of_scope"` or `intent === "greeting"` at the top of `handleSelect`, returning passthrough instead of attempting state transition |

## Plan Deviations

- **Test fixture updates**: Updated existing test fixtures (`mutatingClassification`, `mutatingResult`) to include `contactId: 42` in `commandPayload` so they pass the new Step 1 payload validation. Updated `expiresAt: new Date()` to `expiresAt: new Date(Date.now() + 30 * 60 * 1000)` across all callback test fixtures to prevent flaky failures from the new Step 2 TTL check.
- **No standalone RED-GREEN-REFACTOR for Step 5**: The Step 5 graph integration tests are testing existing + new behavior together through the compiled graph. I wrote them all as new tests (they validate the newly wired behaviors from Steps 1-4) and confirmed they pass on first run since Steps 1-4 were already implemented. This is consistent with the plan's intent: "Add comprehensive integration tests that prove the full pipeline works end-to-end."

## Residual Risks

1. **Smoke tests (Section 9-10) not verified against live stack**: The Docker Compose smoke tests require running `docker compose up` which was not done in this implementation session. The smoke test code has been written and is ready to run via `docker exec monica-project-ai-router-1 node /app/tests/smoke/e2e-pipeline-wiring.mjs`.
2. **Integration tests requiring PostgreSQL**: 6 integration test files are skipped without a running PostgreSQL instance. These are pre-existing tests for the repository layer and are not related to this change.
3. **LLM output quality**: The clarification and select flows depend on the LLM correctly producing updated command payloads. This will be validated in the "LLM Smoke Tests & Benchmark Activation" roadmap item.
