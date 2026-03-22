# Implementation Plan: Graph-Level Integration Tests for Multi-Turn Contact Flow

## Objective

Add three graph-level integration tests that exercise the full multi-turn confirm-then-resolve flow through the compiled LangGraph graph. These tests validate that kinship disambiguation, cancellation at action confirmation, and unambiguous kinship resolution work end-to-end across multiple graph invocations, not just at the individual node level.

The existing `graph.test.ts` has single-step and some multi-step tests (e.g., the "clarification -> resolution -> confirm" three-step flow at line 782), plus isolated narrowing tests (9a-9d at lines 931-1237). However, none of those tests simulate the full kinship round-trip through the **confirm-then-resolve** path with progressive narrowing across multiple graph invocations. These three new tests close that gap.

## Review Findings Addressed

### [HIGH] Turn 4 auto-confirm fix

The original plan's Turn 4 of the full round-trip test had `confidence: 0.9` (below the `autoConfirmConfidenceThreshold` of 0.95) and `resetMocksWithDefaults()` set `confirmationMode: "explicit"`. Both conditions prevented `checkAutoConfirm` from returning `true`, so `transitionToConfirmationAndCheckAutoConfirm` would stop at `pending_confirmation` without calling `autoConfirm`. The scheduler would never execute.

**Fix applied (Option A):** Turn 4 now sets `confidence: 0.97` (above 0.95 threshold) in the mock LLM result, and overrides `mockGetPreferences` to return `{ confirmationMode: "auto", language: "en", timezone: "UTC" }`. This triggers the auto-confirm path inside `transitionToConfirmationAndCheckAutoConfirm` -> `checkAutoConfirm` -> `autoConfirm`, which calls `transitionStatus(pending_confirmation -> confirmed)` and then `schedulerClient.execute`. The test remains at 4 turns.

**Verification against source code:**
- `transitionToConfirmationAndCheckAutoConfirm` (execute-action.ts line 164) calls `checkAutoConfirm` with `state.intentClassification?.confidence ?? 0`.
- `checkAutoConfirm` (execute-action.ts line 394) checks `confidence < deps.autoConfirmConfidenceThreshold` (0.95), then fetches preferences and checks `prefs.confirmationMode === "auto"`.
- `autoConfirm` (execute-action.ts line 457) calls `transitionStatus(pending_confirmation -> confirmed)` then `schedulerClient.execute`.
- The `actionOutcome.type` from `autoConfirm` is `"auto_confirmed"` (not `"confirmed"`), so the Turn 4 assertion on `actionOutcome.type` must use `"auto_confirmed"`.

### [MEDIUM] NarrowingContext DB persistence assertion

The original plan listed `mockUpdateNarrowingContext resolves` in Turn 2 mock setup but did NOT assert it was called. In production, `handleConfirm` in `execute-action.ts` transitions the command back to `draft` when deferred resolution returns `ambiguous` (lines 669-700), but it never calls `updateNarrowingContext`. The narrowingContext is set in graph state by `resolveContactRef` (the `resolveDeferredContact` function at line 517-539) but is not persisted to the DB by `handleConfirm`. Between invocations, `loadContext` reads narrowingContext from the DB row returned by `getActivePendingCommandForUser`. Since it was never written, the real flow would lose it. The test masks this because Turn 3's `mockGetActivePendingCommandForUser` manually includes `narrowingContext` in the returned row.

**Fix applied:** Turn 2 now includes an explicit assertion: `expect(mockUpdateNarrowingContext).toHaveBeenCalled()`. Based on code analysis, this assertion is expected to fail, confirming a production bug. When it fails during implementation:
1. Document the finding as a production bug for follow-up with its own TDD cycle.
2. Comment out the assertion with `// BUG: handleConfirm ambiguous path does not call updateNarrowingContext`.
3. Add a comment on the Turn 3 mock setup explaining that `narrowingContext` on the row is a workaround for this bug.

## Scope

### In Scope

- Test 1: Full kinship disambiguation round-trip spanning 4 graph invocations (initial message, action confirm triggers deferred resolution and narrowing, user answers with name, user selects from buttons and command auto-confirms and executes)
- Test 2: Confirm-then-resolve cancel spanning 2 graph invocations (initial message with contactRef, user cancels at action confirmation before contact resolution)
- Test 3: Unambiguous kinship auto-resolve spanning 2 graph invocations (initial message, action confirm triggers deferred resolution that resolves single match and command executes)
- All tests use mocked LLM, mocked external services, and the real compiled LangGraph graph

### Out of Scope

- Changes to any production code (graph nodes, state, schemas, matchers)
- New test files (all tests go into the existing `graph.test.ts`)
- Docker Compose smoke tests for these specific flows (existing smoke suite covers the live stack)
- LLM integration tests, promptfoo datasets, or benchmark fixtures
- Fixing the narrowingContext persistence bug (documented for follow-up)

## Affected Services & Packages

| Package/Service | Changes |
|-----------------|---------|
| `services/ai-router` | Add 3 test cases to `src/graph/__tests__/graph.test.ts` |

No new files are created. All three tests belong in the existing `graph.test.ts` file (`services/ai-router/src/graph/__tests__/graph.test.ts`), which already contains the mock infrastructure (`makeConfig()`, `makeState()`, mock declarations for OpenTelemetry, observability, the LLM module, and the contact-resolution client).

## Implementation Steps

### Step 1: Add shared test helpers for multi-turn kinship flows

**File:** `services/ai-router/src/graph/__tests__/graph.test.ts`

**What to do:** Add two small helper functions near the top of the `describe("createConversationGraph", ...)` block (after the existing `makeState` helper on line 154) to reduce repetition across the three new tests.

1. `makePendingCommandRow(overrides)` -- returns a PendingCommandRow-shaped object with sensible defaults for multi-turn tests (id, userId, commandType, payload, status, version, dates, narrowingContext, unresolvedContactRef). The existing tests inline these objects; a helper reduces error-prone duplication for 4-turn flows.

2. `resetMocksWithDefaults()` -- calls `vi.clearAllMocks()` and re-sets the defaults that every turn needs (`mockGetPreferences`, `mockGetDeliveryRouting`, `mockDeliveryDeliver`, `mockInsertTurnSummary`, `mockRedactString`). The existing multi-turn tests duplicate this 6-line pattern on every turn boundary; a helper makes the multi-turn tests readable.

**Expected outcome:** The two helpers exist and are used by the three new test cases. They do not change the behavior of any existing test.

### Step 2: Add test -- Confirm-then-resolve cancel (contact resolution never runs)

**File:** `services/ai-router/src/graph/__tests__/graph.test.ts`

**Test name:** `"confirm-then-resolve: user cancels at action confirmation, contact resolution never runs"`

This is the simplest of the three tests (2 graph invocations). Write it first per TDD ordering.

**Turn 1 -- Initial message ("add a note to mom about dinner"):**
- `mockInvoke` returns: `{ intent: "mutating_command", commandType: "create_note", contactRef: "mom", commandPayload: { body: "dinner plans" }, confidence: 0.85, detectedLanguage: "en", userFacingText: "I'll add a note about dinner plans.", needsClarification: false }`
- `mockFetchContactSummaries` returns 8 contacts with `relationshipLabels: ["parent"]` (would trigger narrowing IF resolution ran)
- `mockCreatePendingCommand` returns a draft row (id: "cmd-cancel-test", version: 1)
- `mockSetUnresolvedContactRef` resolves
- `mockTransitionStatus` returns `{ ...draftRow, status: "pending_confirmation", version: 2 }`
- Invoke graph with `text_message` event
- **Assert:**
  - `result.response.type === "confirmation_prompt"`
  - `result.unresolvedContactRef === "mom"`
  - `mockFetchContactSummaries` was NOT called (resolution deferred)
  - `result.response.pendingCommandId` and `result.response.version` are set

**Turn 2 -- User cancels (callback_action: cancel):**
- Call `resetMocksWithDefaults()`
- `mockInvoke` returns: `{ intent: "clarification_response", commandType: null, contactRef: null, commandPayload: null, confidence: 1.0, detectedLanguage: "en", userFacingText: "Command cancelled." }`
- `mockGetActivePendingCommandForUser` returns the pending_confirmation row with `unresolvedContactRef: "mom"`
- `mockGetPendingCommand` returns the pending_confirmation row (non-expired)
- `mockTransitionStatus` returns `{ ...pendingRow, status: "cancelled", version: 3 }`
- Invoke graph with `callback_action` event: `{ action: "cancel", data: "cmd-cancel-test:2" }`
- **Assert:**
  - `mockFetchContactSummaries` was NOT called (cancel clears unresolvedContactRef in resolveContactRef node without fetching summaries)
  - `mockSchedulerExecute` was NOT called
  - `result.response.type === "text"` (cancellation message)
  - `result.actionOutcome.type === "cancelled"`

### Step 3: Add test -- Unambiguous kinship auto-resolve and execute

**File:** `services/ai-router/src/graph/__tests__/graph.test.ts`

**Test name:** `"unambiguous kinship: single parent candidate -> action confirm -> auto-resolve -> execute"`

This is the second simplest (2 graph invocations, happy path).

**Turn 1 -- Initial message ("add a note to mom about garden"):**
- `mockInvoke` returns: `{ intent: "mutating_command", commandType: "create_note", contactRef: "mom", commandPayload: { body: "garden project" }, confidence: 0.85, detectedLanguage: "en", userFacingText: "I'll add a note about the garden project.", needsClarification: false }`
- `mockFetchContactSummaries` returns 1 contact: `{ contactId: 42, displayName: "Elena Yuryevna (Mama)", aliases: ["Elena", "Mama", "Yuryevna"], relationshipLabels: ["parent"], importantDates: [], lastInteractionAt: null }`
- `mockCreatePendingCommand` returns draft row (id: "cmd-unambig", version: 1)
- `mockSetUnresolvedContactRef` resolves
- `mockTransitionStatus` returns `{ ...draftRow, status: "pending_confirmation", version: 2 }`
- Invoke graph with `text_message` event
- **Assert:**
  - `result.response.type === "confirmation_prompt"` (action confirmed first, contact deferred)
  - `result.unresolvedContactRef === "mom"`
  - `mockFetchContactSummaries` NOT called (deferred)

**Turn 2 -- User confirms (callback_action: confirm):**
- Call `resetMocksWithDefaults()`
- `mockInvoke` returns: `{ intent: "clarification_response", commandType: "create_note", contactRef: null, commandPayload: null, confidence: 1.0, detectedLanguage: "en", userFacingText: "Done! Note created." }`
- `mockGetActivePendingCommandForUser` returns pending_confirmation row with `unresolvedContactRef: "mom"`
- `mockFetchContactSummaries` returns the single parent contact (deferred resolution now runs)
- `mockGetPendingCommand` returns pending_confirmation row (non-expired)
- `mockUpdatePendingPayload` returns updated row: `{ ...pendingRow, payload: { type: "create_note", contactId: 42, body: "garden project" }, version: 3 }`
- `mockTransitionStatus` returns confirmed row: `{ ...updatedRow, status: "confirmed", version: 4, confirmedAt: new Date() }`
- `mockSchedulerExecute` resolves
- Invoke graph with `callback_action` event: `{ action: "confirm", data: "cmd-unambig:2" }`
- **Assert:**
  - `mockFetchContactSummaries` was called (deferred resolution ran)
  - `mockUpdatePendingPayload` was called with payload including `contactId: 42`
  - `mockTransitionStatus` was called (pending_confirmation -> confirmed)
  - `mockSchedulerExecute` was called (command executed)
  - `result.response.type === "text"` (success message)
  - No disambiguation prompt shown, no narrowing context created

### Step 4: Add test -- Full kinship disambiguation round-trip

**File:** `services/ai-router/src/graph/__tests__/graph.test.ts`

**Test name:** `"multi-turn kinship disambiguation: initial -> action confirm -> narrowing clarification -> user answers -> buttons -> select -> auto-confirm -> execute"`

This is the most complex test (4 graph invocations).

**Contact summaries fixture (used across all turns):**
8 contacts, 2 of which have "Elena" in their aliases:
```
contactId 1: displayName "Elena Yuryevna", aliases ["Elena", "Yuryevna"], relationshipLabels ["parent"]
contactId 2: displayName "Maria Petrova", aliases ["Maria", "Petrova"], relationshipLabels ["parent"]
contactId 3: displayName "Elena Smirnova", aliases ["Elena", "Smirnova"], relationshipLabels ["parent"]
contactId 4-8: displayName "Other Contact N", aliases ["OtherN"], relationshipLabels ["parent"]
```

**Turn 1 -- Initial message ("add a note to mom about the park"):**
- `mockInvoke` returns: `{ intent: "mutating_command", commandType: "create_note", contactRef: "mom", commandPayload: { body: "went to park" }, confidence: 0.85, detectedLanguage: "en", userFacingText: "I'll add a note about the park.", needsClarification: false }`
- `mockFetchContactSummaries` returns the 8 contacts above
- `mockCreatePendingCommand` returns draft row (id: "cmd-narrow-rt", version: 1)
- `mockSetUnresolvedContactRef` resolves
- `mockTransitionStatus` returns `{ ...draftRow, status: "pending_confirmation", version: 2 }`
- Invoke graph with `text_message` event
- **Assert:**
  - `result.response.type === "confirmation_prompt"`
  - `result.unresolvedContactRef === "mom"`
  - `mockFetchContactSummaries` NOT called

**Turn 2 -- User confirms action (callback_action: confirm) -- triggers deferred resolution which enters narrowing:**
- Call `resetMocksWithDefaults()`
- `mockInvoke` returns: `{ intent: "clarification_response", commandType: "create_note", contactRef: null, commandPayload: null, confidence: 1.0, detectedLanguage: "en", userFacingText: "Confirmed" }`
- `mockGetActivePendingCommandForUser` returns pending_confirmation row with `unresolvedContactRef: "mom"`
- `mockFetchContactSummaries` returns the 8 contacts (deferred resolution runs, finds 8 kinship matches > 5 threshold -> enters narrowing)
- `mockGetPendingCommand` returns pending_confirmation row
- `mockTransitionStatus` returns draft row (pending_confirmation -> draft for disambiguation)
- `mockUpdateNarrowingContext` resolves
- Invoke graph with `callback_action` event: `{ action: "confirm", data: "cmd-narrow-rt:2" }`
- **Assert:**
  - `mockFetchContactSummaries` was called
  - `result.response.type === "text"` (clarification question about narrowing)
  - The narrowingContext is set in the graph state (round: 0, 8 candidate IDs)
  - `result.activePendingCommand.status === "draft"` (transitioned back to draft)
  - **[MEDIUM fix]** `expect(mockUpdateNarrowingContext).toHaveBeenCalled()` -- If this assertion fails (expected based on code analysis), document as production bug, comment out with `// BUG: handleConfirm ambiguous path does not call updateNarrowingContext`, and annotate Turn 3 mock setup.

**Turn 3 -- User answers ("Elena") -- narrowing produces 2 candidates, shows buttons:**
- Call `resetMocksWithDefaults()`
- `mockInvoke` returns: `{ intent: "clarification_response", commandType: "create_note", contactRef: "Elena", commandPayload: { body: "went to park" }, confidence: 0.8, detectedLanguage: "en", userFacingText: "Elena", needsClarification: true }`
- `mockGetActivePendingCommandForUser` returns draft row with `narrowingContext: { originalContactRef: "mom", clarifications: [], round: 0, narrowingCandidateIds: [1,2,3,4,5,6,7,8] }` (Note: narrowingContext on the row is a workaround for the MEDIUM bug)
- `mockFetchContactSummaries` returns the 8 summaries
- `mockUpdateDraftPayload` returns updated row (version bumped)
- `mockUpdateNarrowingContext` resolves
- Invoke graph with `text_message` event: `{ text: "Elena" }`
- **Assert:**
  - `result.response.type === "disambiguation_prompt"` (2 Elena contacts <= 5 threshold -> buttons)
  - `result.response.options.length === 2`
  - Options contain labels for Elena Yuryevna (contactId 1) and Elena Smirnova (contactId 3)
  - `result.narrowingContext === null` (cleared when presenting buttons)

**Turn 4 -- User selects Elena Yuryevna (callback_action: select) -- auto-confirms and executes:**

**[HIGH fix applied]:** This turn uses `confidence: 0.97` (above the 0.95 threshold) and `confirmationMode: "auto"` to trigger the auto-confirm path.

- Call `resetMocksWithDefaults()`
- `mockInvoke` returns: `{ intent: "clarification_response", commandType: "create_note", contactRef: null, commandPayload: { body: "went to park" }, confidence: 0.97, detectedLanguage: "en", userFacingText: "Done! Note added to Elena Yuryevna.", needsClarification: false }`
  - **Key change:** `confidence: 0.97` (above `autoConfirmConfidenceThreshold: 0.95`)
- `mockGetPreferences` override: `{ language: "en", confirmationMode: "auto", timezone: "UTC" }`
  - **Key change:** `confirmationMode: "auto"` (overrides the "explicit" default)
- `mockGetActivePendingCommandForUser` returns draft row (from turn 3)
- `mockGetPendingCommand` returns draft row with non-expired TTL
- `mockUpdateDraftPayload` returns updated row with `contactId: 1` merged into payload
- `mockTransitionStatus` sequential return values:
  - First call (draft -> pending_confirmation): returns pending_confirmation row
  - Second call (pending_confirmation -> confirmed): returns confirmed row (confirmedAt set)
  - Wire with: `mockTransitionStatus.mockResolvedValueOnce(pendingRow).mockResolvedValueOnce(confirmedRow)`
- `mockSchedulerExecute` resolves
- Invoke graph with `callback_action` event: `{ action: "select", data: "1:0" }` (contactId 1, version 0 per select callback convention)
- **Assert:**
  - `mockUpdateDraftPayload` was called with payload including `contactId: 1`
  - `mockTransitionStatus` was called exactly twice (draft -> pending_confirmation, then pending_confirmation -> confirmed)
  - `mockGetPreferences` was called (auto-confirm path fetches user preferences)
  - `mockSchedulerExecute` was called (command executed via auto-confirm path)
  - `result.actionOutcome.type === "auto_confirmed"` (not `"confirmed"`)
  - `result.response.type === "text"` (success message)

## Test Strategy

### Unit Tests (Vitest)

**What to test:**
- All three tests are graph-level integration tests that compile the real LangGraph StateGraph, invoke it multiple times simulating a conversation, and verify the end-to-end state transitions
- The real compiled graph is used (all 7 nodes: loadContext, classifyIntent, resolveContactRef, executeAction, formatResponse, deliverResponse, persistTurn)

**What to mock (all pre-existing in `graph.test.ts`):**
- `@langchain/openai` (ChatOpenAI) -- prevents real OpenAI API calls
- `@opentelemetry/api` -- prevents real tracing
- `@monica-companion/observability` -- prevents real logging
- `../../contact-resolution/client.js` (fetchContactSummaries) -- prevents real monica-integration HTTP calls
- All DB repository functions via config injection
- Service clients via config injection

**What runs as real code:**
- LangGraph StateGraph compilation and invocation
- All 7 graph node functions (with injected mocked deps)
- `matchContacts` deterministic contact matcher
- `resolveFromCandidates` threshold logic
- `buildConfirmedPayload` function
- `MutatingCommandPayloadSchema` Zod validation
- `formatResponseNode` response formatting
- `NarrowingContextSchema` Zod validation in `loadContextNode`

### TDD Sequence

1. **RED:** Write Step 1 helpers + Step 2 (cancel test) -- run tests
2. **GREEN:** Adjust mock setup if assertions fail
3. **RED:** Write Step 3 (unambiguous test) -- run tests
4. **GREEN:** Adjust if needed
5. **RED:** Write Step 4 (full round-trip test) -- run tests
6. **GREEN:** Adjust if needed. For Turn 2 MEDIUM assertion: if `expect(mockUpdateNarrowingContext).toHaveBeenCalled()` fails, document bug, comment out assertion.
7. **REFACTOR:** Review all three tests for common patterns

## Smoke Test Strategy

1. Run unit tests: `pnpm --filter @monica-companion/ai-router test`
2. Run full monorepo tests: `pnpm test`
3. Start Docker Compose stack and run existing smoke tests
4. Tear down

## Security Considerations

- No secrets in test fixtures (mocked API key is fake)
- Redaction tested via `mockRedactString` wired through graph config
- No PII in test data (fictional contact names)
- Observability module fully mocked (no log leaks)

## Risks & Open Questions

1. **Mock version tracking across turns:** Careful version tracking required. `makePendingCommandRow` helper centralizes this.
2. **Turn 2 deferred resolution -> narrowing:** Most complex mock interaction between `resolveContactRef` and `executeAction`.
3. **Select callback version convention:** Data encoded as `"{contactValue}:0"`.
4. **[MEDIUM] NarrowingContext persistence bug (predicted):** `handleConfirm` does not call `updateNarrowingContext` when deferred resolution returns `ambiguous`. Document as follow-up.
5. **Auto-confirm actionOutcome type:** `autoConfirm` returns `"auto_confirmed"`, not `"confirmed"`.
6. **Test file size:** ~1550 lines after changes. Acceptable.
