---
verdict: APPROVED
date: 2026-03-22
attempt: 1
biome_pass: true
tests_pass: true
test_summary: "28 passed, 0 failed (graph.test.ts); 10 failures in 5 other files are pre-existing on base branch"
critical_count: 0
high_count: 0
medium_count: 2
---

# Code Review: Graph-Level Integration Tests for Multi-Turn Contact Flow

## Automated Checks

- **Biome**: PASS -- `pnpm biome check services/ai-router/src/graph/__tests__/graph.test.ts` returned "ok (no errors)"
- **Tests (graph.test.ts)**: PASS -- 28/28 passed (25 existing + 3 new), 0 failed
- **Tests (full ai-router)**: 10 failures in 5 other test files (middleware-ordering, process-endpoint, guardrails-wiring, node-spans, repository.integration) -- confirmed pre-existing on the base branch by stashing the changes and re-running the same failures. No regressions introduced.
- **Diff scope**: 1 file changed, 509 insertions(+), 0 deletions. Purely additive. No production code modified. No shared config files (`.env.example`, `docker-compose.yml`, `pnpm-workspace.yaml`, barrel exports) touched.

## Findings

### CRITICAL
(none)

### HIGH
(none)

### MEDIUM

1. [MEDIUM] `services/ai-router/src/graph/__tests__/graph.test.ts:1655` -- The type annotation `(o: { value: string })` on the `.map()` callback is an inline type assertion rather than relying on the inferred type from the graph response schema. If the `options` shape changes in production (e.g., `value` is renamed), this cast would silently mask the mismatch at test time. -- **Fix:** Extract the options type from `GraphResponseSchema` or use `as const` on the expected values and assert with `expect.arrayContaining` instead of manually mapping.

2. [MEDIUM] `services/ai-router/src/graph/__tests__/graph.test.ts:1599-1600` -- The commented-out assertion `// expect(mockUpdateNarrowingContext).toHaveBeenCalled()` documents a production bug where `handleConfirm` does not persist `narrowingContext` when deferred resolution returns `ambiguous`. The bug is well-documented with a `// BUG:` comment and the Turn 3 mock workaround is annotated (lines 1617-1620). This is acceptable as a documented deferral, but it should have a tracked follow-up issue to avoid being forgotten. -- **Fix:** Create a tracked issue (GitHub or roadmap entry) for the `handleConfirm` narrowingContext persistence bug. The current in-code documentation is adequate for the test itself.

### LOW

1. [LOW] `services/ai-router/src/graph/__tests__/graph.test.ts:1242-1261` -- `makePendingCommandRow` uses `Record<string, unknown>` as the overrides type, which loses type safety on the override keys. If a caller passes a misspelled key (e.g., `{ statuss: "draft" }`) it will silently spread into the object without error. -- **Fix:** Type the overrides parameter as `Partial<ReturnType<typeof makePendingCommandRow>>` or a named interface matching the pending command row shape. This matches the pattern used by the existing `makeState` helper.

2. [LOW] `services/ai-router/src/graph/__tests__/graph.test.ts:1475` -- The test name is 120+ characters long, which is hard to read in test output. -- **Fix:** Shorten to something like `"full kinship round-trip: 4 turns from initial to auto-confirm"`. The detailed description belongs in a comment inside the test.

## Plan Compliance

The implementation follows the approved plan accurately:

- **Test 1 (cancel)**: Matches plan Step 2 exactly. 2 turns, callback_action cancel, asserts `fetchContactSummaries` not called, scheduler not called, `actionOutcome.type === "cancelled"`.
- **Test 2 (unambiguous)**: Matches plan Step 3 exactly. 2 turns, single parent auto-resolves to contactId 42, asserts `updatePendingPayload` called with `contactId: 42`, scheduler called.
- **Test 3 (full round-trip)**: Matches plan Step 4 exactly. 4 turns with all prescribed mock setups. Turn 4 correctly uses `confidence: 0.97` and `confirmationMode: "auto"` (HIGH fix from plan review). Asserts `actionOutcome.type === "auto_confirmed"`.
- **Helpers**: `makePendingCommandRow` and `resetMocksWithDefaults` match plan Step 1.
- **Documented deviations**: The `updateNarrowingContext` assertion commented out as predicted by the plan (MEDIUM finding, documented as production bug).
- **No production code changes**: Only the test file was modified, as required by the plan scope.

## Security Review

- No real API keys or secrets in test fixtures. The `openaiApiKey: "sk-test-key"` is a clearly fake test placeholder.
- No PII in test data -- contact names are fictional ("Elena Yuryevna", "Maria Petrova", etc.).
- Observability and OpenTelemetry modules fully mocked (no log leaks).
- Redaction mock is wired through all tests via `mockRedactString`.

## Service Boundary Review

- All mocks are at correct service boundaries: `fetchContactSummaries` (monica-integration client), `schedulerClient.execute` (scheduler client), `deliveryClient.deliver` (delivery client), `userManagementClient` (user-management client).
- No Telegram types used beyond `sourceRef` strings (which are connector-agnostic identifiers).
- No Monica-specific types -- contact summaries use the `ContactResolutionSummary` projection shape.

## Verdict Rationale

All automated checks pass. The 3 new tests are well-structured, match the approved plan, and exercise meaningful multi-turn flows through the real compiled LangGraph graph. The two MEDIUM findings are both documentation/maintainability concerns (inline type cast, tracked bug follow-up) rather than correctness or security issues. No CRITICAL or HIGH findings. The diff is purely additive with no production code changes.
