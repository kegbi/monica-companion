---
verdict: REJECTED
date: 2026-03-22
attempt: 1
critical_count: 0
high_count: 1
medium_count: 1
---

# Plan Review: Graph-Level Integration Tests for Multi-Turn Contact Flow

## Findings

### HIGH

1. [HIGH] **Turn 4 of the full round-trip test (Step 4) will not execute the command as planned.** The plan specifies `mockTransitionStatus` with two sequential calls (draft -> pending_confirmation, pending_confirmation -> confirmed) and asserts `mockSchedulerExecute` was called. However, the `handleSelect` function in `execute-action.ts` (line 919) calls `transitionToConfirmationAndCheckAutoConfirm`, which only auto-confirms when BOTH conditions are met: (a) `confidence >= autoConfirmConfidenceThreshold` (0.95 from `makeConfig()`), AND (b) `confirmationMode === "auto"`. The plan's Turn 4 mock LLM result has `confidence: 0.9` (below 0.95), and `resetMocksWithDefaults()` sets `confirmationMode: "explicit"`. Neither condition is met, so `checkAutoConfirm` returns `false` before even fetching preferences. The command will stay in `pending_confirmation`, the second `mockTransitionStatus` call will never happen, `mockSchedulerExecute` will never be called, and the response will be `confirmation_prompt` rather than `text`. The test as written will fail on at least three of its four assertions.

   **Fix:** Choose one of:
   - **(A)** Change the Turn 4 mock to set `confidence: 0.97` (above threshold) and override `mockGetPreferences` to return `{ confirmationMode: "auto", language: "en", timezone: "UTC" }`. This triggers auto-confirm after the select callback resolves the contact.
   - **(B)** Split Turn 4 into two turns: Turn 4 (select callback) asserts `result.response.type === "confirmation_prompt"`, then Turn 5 (confirm callback with `data: "cmd-narrow-rt:<version>"`) asserts `mockSchedulerExecute` was called and `result.response.type === "text"`. This is more realistic but makes the test 5 turns instead of 4.
   - Option (A) is simpler and keeps the test at 4 turns. Recommended.

### MEDIUM

1. [MEDIUM] **NarrowingContext DB persistence gap masked by mock setup in Turn 2-3 boundary.** The plan's Turn 2 of the full round-trip test lists `mockUpdateNarrowingContext resolves` in the mock setup but does NOT assert it was called. In production, `handleConfirm` in `execute-action.ts` transitions the command back to `draft` when deferred resolution returns `ambiguous`, but it never calls `updateNarrowingContext`. The narrowingContext is set in graph state by `resolveContactRef` but is NOT persisted to the DB. Between invocations, `loadContext` extracts `narrowingContext` from the DB row returned by `getActivePendingCommandForUser`. Since the narrowingContext was never written to DB, the real flow would lose it. The test masks this because Turn 3's `mockGetActivePendingCommandForUser` manually includes `narrowingContext` on the returned row. Adding an assertion that `mockUpdateNarrowingContext` was called during Turn 2 would either confirm the production code is correct or reveal a bug that should be filed and fixed separately.

   **Fix:** In Turn 2 assertions, add: `expect(mockUpdateNarrowingContext).toHaveBeenCalled()`. If this assertion fails during implementation, document the finding as a production bug to be fixed in a follow-up ticket with its own TDD cycle.

### LOW

1. [LOW] **Test file size approaching maintainability threshold.** The plan acknowledges that `graph.test.ts` will grow to approximately 1550 lines. While acceptable for now, a future split should be considered if additional multi-turn tests are added.

2. [LOW] **`resetMocksWithDefaults()` re-sets implementations that are preserved by `vi.clearAllMocks()`.** Redundant but harmless and consistent with existing patterns at lines 528-540, 823-835, and 875-887.

## Plan Correctness Summary

**Verified as correct:**
- The graph node names and topology match `graph.ts`
- The mock infrastructure matches the existing test file exactly
- The confirm-then-resolve flow description matches production code
- The cancel flow correctly identifies that `resolveContactRef` clears `unresolvedContactRef` without calling `fetchContactSummaries` for cancel/edit callbacks
- The select callback data format matches `parseCallbackData`
- The narrowing threshold (>5 triggers clarification) and round cap (3) match constants
- The state machine allows `pending_confirmation -> draft`
- Test 2 (cancel) and Test 3 (unambiguous auto-resolve) mock setups and assertions are correct

## Verdict Rationale

The plan is **REJECTED** due to one HIGH finding. Turn 4 of the full round-trip test has incorrect mock setup and assertions: the auto-confirm path will not trigger. This requires a plan revision before implementation.
