# Implementation Summary: Confirm-Then-Resolve Conversation Flow

## Files Changed
| File | Action | Description |
|------|--------|-------------|
| `services/ai-router/src/db/schema.ts` | modified | Added `unresolvedContactRef` TEXT column to `pendingCommands` table |
| `services/ai-router/drizzle/0002_add_unresolved_contact_ref.sql` | created | Migration adding nullable TEXT column |
| `services/ai-router/drizzle/meta/_journal.json` | modified | Added migration entry |
| `services/ai-router/src/pending-command/repository.ts` | modified | Added `updatePendingPayload` and `setUnresolvedContactRef` functions |
| `services/ai-router/src/pending-command/index.ts` | modified | Exported new repository functions |
| `services/ai-router/src/graph/state.ts` | modified | Added `unresolvedContactRef: string | null` to Annotation and ConversationStateSchema |
| `services/ai-router/src/graph/nodes/load-context.ts` | modified | Extract `unresolvedContactRef` from active pending command into graph state |
| `services/ai-router/src/graph/nodes/resolve-contact-ref.ts` | modified | Defer resolution for mutating commands; run deferred resolution on confirm callbacks; clear on cancel/edit |
| `services/ai-router/src/graph/nodes/execute-action.ts` | modified | Added `updatePendingPayload` and `setUnresolvedContactRef` to deps; skip payload validation when deferred; store unresolvedContactRef; handle deferred resolution in handleConfirm; skip auto-confirm when deferred |
| `services/ai-router/src/graph/graph.ts` | modified | Wired `updatePendingPayload` and `setUnresolvedContactRef` into ConversationGraphConfig and node deps |
| `services/ai-router/src/app.ts` | modified | Imported and wired `updatePendingPayload` and `setUnresolvedContactRef` from repository |
| `services/ai-router/src/graph/nodes/__tests__/load-context.test.ts` | modified | Added 3 tests for unresolvedContactRef loading; added field to makeState |
| `services/ai-router/src/graph/nodes/__tests__/resolve-contact-ref.test.ts` | modified | Added 8 new tests for confirm-then-resolve flow; updated 13 existing tests to use clarification_response intent (since mutating_command now defers); added field to makeState |
| `services/ai-router/src/graph/nodes/__tests__/execute-action.test.ts` | modified | Added 5 new tests for deferred resolution handling; added new mock deps; added field to makeState |
| `services/ai-router/src/graph/__tests__/graph.test.ts` | modified | Added new mock deps; updated 3 tests for new flow behavior (deferred resolution, auto-confirm with create_contact, narrowing initiation) |

## Tests Added
| Test File | What It Tests |
|-----------|---------------|
| `load-context.test.ts` | 3 tests: unresolvedContactRef loaded from pending command; null when absent; null when no active command |
| `resolve-contact-ref.test.ts` | 8 tests: mutating_command deferral; read_query immediate resolution; confirm callback deferred resolution (resolved/ambiguous/no_match); cancel/edit callback clearing; callback_action without unresolvedContactRef unchanged |
| `execute-action.test.ts` | 5 tests: skip payload validation with deferred resolution; store unresolvedContactRef in DB; handleConfirm merge contactId; handleConfirm transition to draft on ambiguous; skip auto-confirm when deferred |
| `graph.test.ts` | Updated 3 tests: deferred state verification; auto-confirm with create_contact (no contactRef); narrowing initiation now shows confirmation_prompt |

## Verification Results
- **Biome**: `pnpm check:fix` passes with no errors
- **Tests**: 209 tests pass across 9 relevant test files (load-context: 11, resolve-contact-ref: 36, execute-action: 35, graph: 25, format-response: 16, state-machine: 14, confirm: 3, matcher: 30, resolver: 39). All unit tests pass. Integration tests that require PostgreSQL are expected to fail without a running DB.

## Plan Deviations

1. **Review LOW-3 (rename `updatePendingPayload`)**: Kept the name `updatePendingPayload` as specified in the plan rather than renaming to `updatePendingConfirmationPayload`. The function's doc comment and status constraint (`pending_confirmation` only) make its purpose clear.

2. **`handleConfirm` signature change (Review MEDIUM-1)**: Changed from `(deps, command)` to `(state, deps, command)` as required by the review. This is an internal function signature change with no external API impact.

3. **Auto-confirm suppression**: Added `transitionToConfirmationSkipAutoConfirm` helper to cleanly skip auto-confirm when `unresolvedContactRef` is set. This was identified as a risk in the plan (Risk #2) and is implemented by bypassing the auto-confirm check entirely when the contact is unresolved.

4. **Existing test updates**: Changed 13 resolve-contact-ref tests from `mutating_command` to `clarification_response` intent. This correctly tests the resolution logic (which hasn't changed) while acknowledging that mutating commands now defer. Three graph integration tests were updated similarly.

## Residual Risks

1. **Integration test gap**: The `repository.integration.test.ts` file does not yet test `updatePendingPayload` and `setUnresolvedContactRef` against a real PostgreSQL instance. These functions follow the exact same pattern as existing functions (`updateDraftPayload`, `clearNarrowingContext`) and are tested through mocks in node-level tests.

2. **Smoke tests**: Docker Compose smoke tests have not been run (require running infrastructure). The migration is a simple nullable column addition which is non-breaking.

3. **Progressive narrowing after deferred resolution**: When a confirm callback triggers deferred resolution and finds >5 ambiguous candidates, the command transitions `pending_confirmation -> draft` and enters the progressive narrowing flow. This path is covered by the deferred resolution tests but not yet by an end-to-end graph integration test.
