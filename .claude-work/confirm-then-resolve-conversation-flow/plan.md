# Implementation Plan: Confirm-Then-Resolve Conversation Flow

## Objective

Restructure the LangGraph conversation graph so that for mutating commands with an unresolved contact reference, the system first confirms the ACTION (command type + payload) with Yes/Edit/Cancel buttons. Only after the user confirms does contact resolution run. This prevents wasted disambiguation effort when the user wants to edit or cancel the action itself.

When the contact resolves unambiguously after action confirmation, execute immediately with no extra step. When the contact is ambiguous, enter the progressive narrowing flow (clarification or buttons depending on candidate count).

## Current Flow Analysis

### Graph Topology
```
START -> loadContext -> classifyIntent -> resolveContactRef -> executeAction -> formatResponse -> deliverResponse -> persistTurn -> END
```

### Current Mutating Command Flow (resolve-then-confirm)

1. User sends "add a note to mom about the park"
2. `classifyIntent`: LLM produces `mutating_command`, `contactRef: "mom"`, `commandPayload: { body: "park" }`
3. `resolveContactRef`: Fetches contact summaries, runs `matchContacts("mom", summaries)`:
   - **Resolved** (single match): Injects `contactId` into `commandPayload`, sets `needsClarification: false`
   - **Ambiguous** (2-5 matches): Sets `needsClarification: true`, `disambiguationOptions` with buttons
   - **Ambiguous** (>5 matches): Sets `needsClarification: true`, triggers progressive narrowing
   - **No match**: Sets `needsClarification: true`
4. `executeAction`:
   - If `needsClarification: true`: Creates pending command in `draft`, returns `edit_draft`
   - If `needsClarification: false`: Creates pending command, transitions `draft -> pending_confirmation`, returns `pending_created` with Yes/Edit/Cancel
5. User confirms -> contact was already resolved, command executes

### Problem

When the contact is ambiguous, the user must go through disambiguation BEFORE seeing the action confirmation. If they then want to cancel or edit the action, the disambiguation effort was wasted.

## Proposed Flow (confirm-then-resolve)

### New Mutating Command Flow

**Invocation 1** (user sends "add a note to mom about the park"):
1. `classifyIntent`: Same as before - `mutating_command`, `contactRef: "mom"`
2. `resolveContactRef`: **NEW** - Detects `mutating_command` with `contactRef`. Instead of resolving, DEFERS resolution by setting `unresolvedContactRef: "mom"` in state. Does NOT run matcher, does NOT set `needsClarification`.
3. `executeAction`: Creates pending command WITHOUT `contactId` in payload. Stores `unresolvedContactRef` in new DB column. Transitions `draft -> pending_confirmation`. Returns `pending_created`.
4. `formatResponse`: Produces `confirmation_prompt` with the LLM's `userFacingText` (describes the action).
5. User sees: "Add note: 'Went to park today'?" [Yes] [Edit] [Cancel]

**Invocation 2a** (user clicks Yes - unambiguous contact):
1. `loadContext`: Loads pending command (status: `pending_confirmation`). Extracts `unresolvedContactRef: "mom"` into state.
2. `classifyIntent`: LLM processes synthetic confirm callback message.
3. `resolveContactRef`: **NEW** - Detects `unresolvedContactRef` in state AND confirm callback. NOW runs contact resolution using "mom". Contact resolves unambiguously: injects `contactId` into state, clears `unresolvedContactRef`.
4. `executeAction`: `handleConfirm` detects resolved contact from state. Updates the pending command payload with `contactId`. Transitions `pending_confirmation -> confirmed`. Sends to scheduler.
5. User sees success message.

**Invocation 2b** (user clicks Yes - ambiguous contact):
1-3. Same as 2a, but `resolveContactRef` finds ambiguous contacts. Sets `needsClarification: true` with disambiguation options. Clears `unresolvedContactRef`.
4. `executeAction`: `handleConfirm` detects that `needsClarification` is true. Transitions `pending_confirmation -> draft` for disambiguation. Returns `edit_draft`.
5. User sees disambiguation prompt (buttons or narrowing question).
6. Disambiguation proceeds normally from here (existing flow).

**Invocation 2c** (user clicks Cancel):
1. `loadContext`: Loads pending command.
2-3. `resolveContactRef` skips (cancel callback, no resolution needed).
4. `executeAction`: `handleCancel` transitions to `cancelled`. No contact resolution ever ran.
5. User sees cancellation message. No wasted disambiguation effort.

**Invocation 2d** (user clicks Edit):
1. `loadContext`: Loads pending command.
2-3. `resolveContactRef` skips (edit callback).
4. `executeAction`: `handleEdit` transitions to `draft`.
5. User can provide changes. No wasted disambiguation effort.

### Read-Only Queries (unchanged)
Read-only queries (`read_query` intent) still resolve contacts immediately because they bypass the pending-command lifecycle and execute synchronously.

### create_contact Commands (unchanged)
`create_contact` commands have no contactRef to resolve. No change.

### Commands Without contactRef (unchanged)
If the LLM does not extract a contactRef, no contact resolution runs. No change.

## Scope

### In Scope

- Adding `unresolved_contact_ref` TEXT column to `pending_commands` table
- Adding `unresolvedContactRef: string | null` to graph state (Annotation + ConversationStateSchema)
- New `updatePendingPayload` repository function (updates payload in `pending_confirmation` status)
- Modifying `resolveContactRef` node to defer resolution for mutating commands and run deferred resolution on confirm callbacks
- Modifying `executeAction` node: `handleMutatingCommand` stores unresolvedContactRef; `handleConfirm` handles deferred resolution outcomes; payload validation skip for deferred resolution
- Modifying `loadContext` node to extract unresolvedContactRef from pending command
- Unit tests for all new/modified behavior
- Graph-level integration tests for the new flow
- Updating existing tests that break due to the flow change

### Out of Scope

- Promptfoo migration (separate roadmap item)
- Changes to `matchContacts()` scoring algorithm
- Changes to `ContactResolutionSummary` type or monica-integration endpoints
- Changes to telegram-bridge, delivery, scheduler, or other services
- Changes to `@monica-companion/types` (no new outbound content types needed)
- System prompt changes (the LLM's userFacingText already describes the action naturally)

## Affected Services & Packages

| Package/Service | Changes |
|-----------------|---------|
| `services/ai-router` | `src/db/schema.ts` -- add `unresolvedContactRef` TEXT column to `pendingCommands` |
| `services/ai-router` | `drizzle/` -- migration adding column |
| `services/ai-router` | `src/pending-command/repository.ts` -- add `updatePendingPayload` and `setUnresolvedContactRef` functions |
| `services/ai-router` | `src/graph/state.ts` -- add `unresolvedContactRef` to Annotation and ConversationStateSchema |
| `services/ai-router` | `src/graph/nodes/resolve-contact-ref.ts` -- defer resolution for mutating commands; run deferred resolution on confirm callbacks |
| `services/ai-router` | `src/graph/nodes/execute-action.ts` -- store unresolvedContactRef; handle deferred resolution in handleConfirm; skip payload validation for deferred resolution |
| `services/ai-router` | `src/graph/nodes/load-context.ts` -- extract unresolvedContactRef from pending command |
| `services/ai-router` | `src/graph/graph.ts` -- wire `updatePendingPayload` into config and deps |
| `services/ai-router` | `src/app.ts` -- import and wire `updatePendingPayload` |
| `services/ai-router` | Test files for all above |

## Implementation Steps

### Step 1: Add `unresolved_contact_ref` column to pending_commands schema

**File:** `services/ai-router/src/db/schema.ts`

- Add `unresolvedContactRef: text("unresolved_contact_ref")` (nullable, no default) to `pendingCommands` table definition.
- Generate migration adding the column.

### Step 2: Add `updatePendingPayload` repository function

**File:** `services/ai-router/src/pending-command/repository.ts`

Add function that updates the payload of a command in `pending_confirmation` status and clears the `unresolvedContactRef`:

```ts
export async function updatePendingPayload(
    db: Database,
    id: string,
    expectedVersion: number,
    newPayload: MutatingCommandPayload,
): Promise<PendingCommandRow | null>
```

Also add `setUnresolvedContactRef` helper (idempotent set, no version check).

**TDD:** 5 test cases for the new functions.

### Step 3: Add `unresolvedContactRef` to graph state

**File:** `services/ai-router/src/graph/state.ts`

Add to `ConversationAnnotation` and `ConversationStateSchema`.

### Step 4: Load `unresolvedContactRef` from pending command in loadContext

**File:** `services/ai-router/src/graph/nodes/load-context.ts`

Extract `unresolvedContactRef` from active pending command into graph state.

### Step 5: Modify `resolveContactRef` to defer resolution for mutating commands

**File:** `services/ai-router/src/graph/nodes/resolve-contact-ref.ts`

- **5a:** Add deferred resolution branch: confirm callback with unresolvedContactRef triggers actual resolution.
- **5b:** Defer resolution for initial mutating commands (return `unresolvedContactRef` instead of resolving).
- **5c:** Cancel/edit callbacks with unresolvedContactRef clear it without resolving.

**TDD:** 8 new test cases.

### Step 6: Modify `executeAction` to handle deferred resolution

**File:** `services/ai-router/src/graph/nodes/execute-action.ts`

- **6a:** Add `updatePendingPayload` and `setUnresolvedContactRef` to ExecuteActionDeps.
- **6b:** Skip payload validation when unresolvedContactRef is set.
- **6c:** Store unresolvedContactRef after creating pending command.
- **6d:** Modify handleConfirm for deferred resolution (merge contactId, handle ambiguous/no_match).

**TDD:** 7 new test cases.

### Step 7: Wire new deps in graph.ts and app.ts

### Step 8: Update existing tests that break

### Step 9: Graph-level integration tests for the new flow

5 integration tests covering: unambiguous confirm-then-resolve, ambiguous confirm-then-resolve, cancel (no resolution), kinship disambiguation round-trip, unambiguous kinship auto-resolve.

## Test Strategy

### Unit Tests (Vitest)
- Repository functions (updatePendingPayload, setUnresolvedContactRef)
- State schema validation
- loadContext extraction
- resolveContactRef deferral and deferred resolution
- executeAction handling of unresolvedContactRef

### Integration Tests
- Graph-level round-trip tests with mocked LLM and contacts

### TDD Sequence
Steps 1-9 follow RED -> GREEN -> REFACTOR.

## Smoke Test Strategy

**Docker Compose services:** `ai-router`, `postgres`, `redis`

**Checks:**
1. Health check: `curl http://localhost:3002/health` -- 200 OK (migration applied, service starts)
2. Database: Verify `unresolved_contact_ref` column exists
3. Regression: Existing smoke test checks pass

## Security Considerations

- No new endpoints or ingress. All changes internal to ai-router graph.
- `unresolved_contact_ref` column contains natural-language contact reference strings (same class of data as `payload` JSONB). Subject to same retention and redaction rules.
- No new service-to-service calls. Contact resolution timing is deferred, not changed.
- Payload validation is deferred but NOT skipped. Validation runs before confirm.
- No credential or PII handling changes.

## Risks & Mitigations

1. **Existing test breakage:** Several tests assume old flow. Mitigated by explicit Step 8 to update them.
2. **Auto-confirmation with deferred resolution:** When `confirmationMode: "auto"`, skip auto-confirmation if `unresolvedContactRef` is set. User must explicitly confirm so confirm callback triggers resolution.
3. **Version bumps:** `setUnresolvedContactRef` does NOT bump version (idempotent, like `clearNarrowingContext`).
4. **Migration risk:** Nullable TEXT column is non-breaking. No backfill needed.
5. **Progressive narrowing interaction:** When confirm triggers ambiguous resolution with >5 candidates, narrowingContext is stored and unresolvedContactRef is cleared. Clean handoff.
