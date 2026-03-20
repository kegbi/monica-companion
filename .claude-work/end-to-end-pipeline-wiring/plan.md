# Implementation Plan: End-to-End Pipeline Wiring

## Current State

The previous implementation phase (commit `92cfe8f` and earlier) built most of the individual pipeline pieces. Here is what is already implemented vs. what remains.

### Already Implemented

| Roadmap Sub-item | Status | Evidence |
|---|---|---|
| Connect intent classification output to pending command creation (mutating) or direct delivery response (read-only/greeting/out-of-scope) | Partially done | `execute-action.ts` handles `mutating_command` (creates draft, transitions to `pending_confirmation`), `read_query` (`read_through`), `greeting`/`out_of_scope` (`passthrough`). `format-response.ts` maps these to `GraphResponse`. `deliver-response.ts` sends to delivery. |
| Connect confirmed commands to scheduler via `POST /internal/execute` | Done | `handleConfirm` in `execute-action.ts` calls `deps.schedulerClient.execute(payload)`. |
| Implement auto-confirmation logic | Done | `checkAutoConfirm` + `autoConfirm` in `execute-action.ts`. |
| Route read-only queries directly from ai-router to delivery, bypassing scheduler | Done | `read_query` intent returns `read_through` outcome; `deliver-response.ts` delivers all responses; scheduler is never called for read-only. |
| Handle stale/expired/version-mismatched confirmations | Partially done | Version mismatch and terminal-state checks exist in `handleCallbackAction`. Missing: TTL expiry check at callback time (relies on sweep having run). |
| Wire callback actions (confirm/edit/cancel from Telegram buttons) through LangGraph graph | Partially done | `confirm`/`cancel`/`edit` callbacks work. Missing: `select` callback is unreachable due to version mismatch (see Step 4). `clarification_response` text follow-ups do not update drafts (see Step 3). |

### Remaining Gaps (this plan)

1. **Conditional payload validation** at pending-command creation time (strict when payload is complete, lenient for drafts needing clarification).
2. **TTL expiry check** at callback handling time (not just via periodic sweep).
3. **Draft payload updates** when clarification responses resolve missing fields.
4. **Select callback wiring** (disambiguation) -- currently unreachable due to version mismatch.
5. **Integration tests** proving the full round-trip through the compiled graph.
6. **Smoke test extension** to cover delivery and scheduler contract validation.

## Objective

Close the remaining gaps between the implemented LangGraph pipeline and the full end-to-end command lifecycle. The previous phases built all the individual pieces. This task group validates they work together correctly and fills the specific gaps listed above.

## Scope

### In Scope

- Validate `commandPayload` against `MutatingCommandPayloadSchema` at pending-command creation time, but only when `needsClarification` is false (payload is supposed to be complete). Allow incomplete payloads when `needsClarification` is true.
- Add TTL-based expiry check at callback handling time in `execute-action.ts`.
- Wire `updateDraftPayload` for clarification responses that update an existing draft.
- Restructure `handleCallbackAction` so `select` callbacks are handled before the version check, fixing the unreachable code path.
- Add integration tests for the compiled graph covering the full round-trip.
- Extend the existing `tests/smoke/e2e-pipeline-wiring.mjs` with delivery and scheduler contract validation checks.

### Out of Scope

- LLM smoke tests against real OpenAI (that is the next roadmap item "LLM Smoke Tests & Benchmark Activation").
- Read-query execution against real Monica data (read queries currently return LLM-generated text; executing them requires monica-integration wiring that is a separate concern).
- Changes to telegram-bridge outbound renderer, delivery service, or scheduler internals.
- Benchmark evaluation pipeline activation (separate roadmap item).
- Changes to the LLM prompt or structured output schema.

## Affected Services & Packages

| Package/Service | Changes |
|---|---|
| `services/ai-router/src/graph/nodes/execute-action.ts` | Add conditional payload validation, TTL expiry check, draft update for clarification, restructure `handleCallbackAction` for select callbacks |
| `services/ai-router/src/graph/graph.ts` | Add `updateDraftPayload` to `ConversationGraphConfig`, pass it to `createExecuteActionNode` |
| `services/ai-router/src/app.ts` | Import `updateDraftPayload` from repository, pass to graph config |
| `services/ai-router/src/graph/nodes/__tests__/execute-action.test.ts` | New test cases for all changes |
| `services/ai-router/src/graph/__tests__/graph.test.ts` | Integration tests for full pipeline round-trips |
| `tests/smoke/e2e-pipeline-wiring.mjs` | Extend with delivery and scheduler contract checks |

## Implementation Steps

### Step 1: Add conditional MutatingCommandPayload validation at pending-command creation

**What**: In `execute-action.ts`, the `handleMutatingCommand` function (line 110-113) casts `intentClassification.commandPayload` as `MutatingCommandPayload` without Zod validation. This violates the "strict payload validation on all inbound/outbound contracts" rule. Add `MutatingCommandPayloadSchema.safeParse()` validation, but only when `needsClarification` is false (the LLM claims the payload is complete).

When `needsClarification` is true, the LLM intentionally produces an incomplete payload (e.g., `create_note` with `body` but missing the required `contactId`). Strict validation would reject these legitimate draft payloads, preventing the draft from being stored in the DB. The subsequent clarification response (Step 3) would then find no `activePendingCommand` to update, breaking the entire clarification round-trip.

**Files to modify**:
- `services/ai-router/src/graph/nodes/execute-action.ts` -- import `MutatingCommandPayloadSchema` from `@monica-companion/types`. In `handleMutatingCommand`, after assembling the `payload` object:
  - If `intentClassification.needsClarification` is false, run `MutatingCommandPayloadSchema.safeParse(payload)`. If it fails, return a `passthrough` outcome (the LLM's `userFacingText` will be used by `formatResponse`). Do not call `deps.createPendingCommand()`.
  - If `intentClassification.needsClarification` is true, skip strict validation and proceed to create the draft as-is. The incomplete payload will be validated later when the clarification resolves and the draft transitions to `pending_confirmation`.

**Expected outcome**: Complete payloads from the LLM are validated against the Zod schema before being stored. Incomplete draft payloads (needing clarification) are allowed through so the clarification flow can update them later.

**Test (TDD first)**:
1. Write a failing test: "rejects mutating command with invalid complete payload (missing required contactId for create_note when needsClarification is false)" -- the node should return passthrough, `createPendingCommand` should NOT be called.
2. Write a failing test: "allows incomplete payload when needsClarification is true (missing contactId for create_note)" -- the node should create a draft pending command with `edit_draft` outcome. This test already partially exists ("creates draft pending command when clarification needed") but should be extended to verify the incomplete payload is accepted.
3. Then implement the conditional validation.

---

### Step 2: Add TTL expiry check at callback handling time

**What**: Currently `handleCallbackAction` (line 289-300) checks if the command is in a terminal state (expired/cancelled/executed), but this relies on the periodic expiry sweep having run. A command could be past its `expiresAt` but still in `pending_confirmation` status if the sweep hasn't fired. Add an explicit `expiresAt < now` check after fetching the command from the DB.

**Files to modify**:
- `services/ai-router/src/graph/nodes/execute-action.ts` -- in `handleCallbackAction`, after `deps.getPendingCommand()` succeeds (line 277) and before the terminal-state check (line 289), add: if `command.expiresAt` is a Date and `command.expiresAt < new Date()`, return `stale_rejected` with a message like "This command has expired. Please start a new request."

**Expected outcome**: Users get immediate rejection for expired commands even if the sweep hasn't run yet.

**Test (TDD first)**:
- Write a failing test: "rejects callback for command past expiresAt even if status is still pending_confirmation" -- mock `getPendingCommand` returning a command with `status: "pending_confirmation"` but `expiresAt: new Date(Date.now() - 60000)`.
- Then implement the check.

---

### Step 3: Wire `updateDraftPayload` for clarification that resolves to a complete command

**What**: When a user provides a clarification response (text reply, not a button callback) to a draft command, the LLM produces updated command details. Currently, the `clarification_response` intent handler (line 91-93) returns `passthrough`, which means the draft is never updated with the clarified information. The system should:
1. Detect that the intent is `clarification_response` AND there is an `activePendingCommand` in draft status
2. Use `updateDraftPayload` to merge the LLM's new `commandPayload` into the existing draft
3. Read `needsClarification` from `state.intentClassification` to decide the next state: if false, transition to `pending_confirmation` and check auto-confirm eligibility; if true, return `edit_draft` outcome

**Files to modify**:
- `services/ai-router/src/graph/nodes/execute-action.ts`:
  - Add `updateDraftPayload` to the `ExecuteActionDeps` interface with signature matching the repository function: `(db: Database, id: string, expectedVersion: number, newPayload: MutatingCommandPayload, ttlMinutes: number) => Promise<PendingCommandRow | null>`
  - Replace the `clarification_response` passthrough (lines 91-93) with logic that:
    - Checks if `state.activePendingCommand` exists and has `status === "draft"`
    - Checks if the LLM produced a `commandPayload` with a valid `commandType`
    - Assembles the new payload as `{ type: commandType, ...commandPayload }` (same pattern as `handleMutatingCommand`)
    - Calls `deps.updateDraftPayload(deps.db, activePendingCommand.pendingCommandId, activePendingCommand.version, newPayload, deps.pendingCommandTtlMinutes)`
    - If `state.intentClassification.needsClarification` is false, transitions the updated draft to `pending_confirmation` and checks auto-confirm eligibility
    - If `state.intentClassification.needsClarification` is true, returns `edit_draft` outcome with updated `activePendingCommand` (bumped version from the updateDraftPayload return)
    - If `updateDraftPayload` returns null (race condition -- draft was modified concurrently), falls through to `passthrough`
    - If there is no active pending command or no commandPayload from the LLM, falls through to `passthrough` (unchanged behavior)
- `services/ai-router/src/graph/graph.ts`:
  - Add `updateDraftPayload` to `ConversationGraphConfig` interface with the same signature
  - Pass `config.updateDraftPayload` to `createExecuteActionNode` in the deps object
- `services/ai-router/src/app.ts`:
  - Import `updateDraftPayload` from `./pending-command/repository.js`
  - Pass `updateDraftPayload` in the `createConversationGraph` config

**Expected outcome**: After a user answers a clarification question ("What note should I add?"), the draft is updated with the new information and, if complete, transitions to pending_confirmation.

**Test (TDD first)**:
1. Write a failing test: "updates draft payload and transitions to pending_confirmation when clarification resolves the command" -- mock an active pending command in draft status, LLM returns `clarification_response` with a `commandPayload` containing the resolved fields and `needsClarification: false`. Verify `updateDraftPayload` is called and `transitionStatus` is called with `draft` to `pending_confirmation`.
2. Write a failing test: "updates draft payload but stays in draft when clarification is still incomplete" -- same setup but `needsClarification: true`. Verify `updateDraftPayload` is called but `transitionStatus` is NOT called.
3. Write a failing test: "falls through to passthrough when clarification_response has no active pending command" -- verify existing behavior is preserved.
4. Then implement.

---

### Step 4: Restructure `handleCallbackAction` to handle `select` before version check

**What**: Disambiguation buttons encode data as `select:{contactValue}:0` (version hardcoded to 0 in `outbound-renderer.ts` line 53). After `telegram-bridge` strips the action prefix in `callback-query.ts` line 32, ai-router receives `data: "{contactValue}:0"`. The `parseCallbackData` function in `execute-action.ts` returns `{ pendingCommandId: contactValue, version: 0 }`. The version check at line 267 compares `parsed.version` (always 0 for select) against `activePendingCommand.version` (1 for a newly created draft), causing every select callback to be stale-rejected before execution reaches `case "select"` at line 309.

**Fix**: Check for `action === "select"` before the version check and branch to a dedicated `handleSelect` function. This keeps changes within `ai-router` only (in scope) and avoids modifying the callback data encoding in `telegram-bridge`.

**Files to modify**:
- `services/ai-router/src/graph/nodes/execute-action.ts`:
  - In `handleCallbackAction`, after `parseCallbackData(data)` succeeds and `activePendingCommand` is confirmed to exist, add: if `action === "select"`, call `handleSelect(state, deps, parsed)` and return its result. This early return skips the version check entirely for select callbacks.
  - Create a new `handleSelect(state: State, deps: ExecuteActionDeps, parsed: { pendingCommandId: string; version: number })` function:
    - `parsed.pendingCommandId` contains the selected contact value (not a real pending command ID)
    - Use `state.activePendingCommand!.pendingCommandId` to look up the real draft from DB via `deps.getPendingCommand`
    - If the command is not found or not in draft status, return `stale_rejected`
    - Check TTL expiry (same as Step 2)
    - Merge the selected value as `contactId` into the existing draft payload: `{ ...existingPayload, contactId: Number(selectedValue) }` (contact IDs are numeric in Monica)
    - Call `deps.updateDraftPayload` with the merged payload
    - Read `state.intentClassification.needsClarification` to decide:
      - If false, transition to `pending_confirmation` and check auto-confirm eligibility
      - If true, return `edit_draft` outcome
  - Remove the now-unreachable `case "select"` from the switch statement (or keep it with a comment noting the early return makes it dead code)

**Expected outcome**: When a user taps a disambiguation button, the draft gets the selected contactId, version is bumped, and (if complete) transitions to pending_confirmation.

**Test (TDD first)**:
1. Write a failing test: "select callback with version 0 is NOT stale-rejected when an active draft exists" -- mock active draft command (version 1), select callback with data `jane-123:0`, action `select`. Verify the outcome is NOT `stale_rejected`.
2. Write a failing test: "select callback updates draft contactId and transitions to pending_confirmation when needsClarification is false" -- mock active draft command, select callback with contactId data, LLM classification with `needsClarification: false`. Verify `updateDraftPayload` is called with the selected contactId merged into the payload, and `transitionStatus` is called with `draft` to `pending_confirmation`.
3. Write a failing test: "select callback updates draft but stays in draft if LLM classification has needsClarification true" -- same setup but `needsClarification: true`. Verify `updateDraftPayload` is called but `transitionStatus` is NOT called, outcome is `edit_draft`.
4. Then implement.

---

### Step 5: Add compiled graph integration tests for full pipeline round-trips

**What**: The existing `graph.test.ts` covers basic scenarios (greeting, mutating command creation, delivery, callback without active command, LLM errors). Add comprehensive integration tests that prove the full pipeline works end-to-end through the compiled graph, including the new behaviors from Steps 1-4.

**Files to modify**:
- `services/ai-router/src/graph/__tests__/graph.test.ts` -- add test cases:
  1. **Auto-confirm round-trip**: Mock LLM returning high-confidence mutating command + user prefs with `confirmationMode: "auto"`. Verify scheduler client is called, response type is `text` (not confirmation_prompt).
  2. **Confirm callback round-trip**: First invocation creates pending command in pending_confirmation. Second invocation with callback_action "confirm" confirms and sends to scheduler. Verify scheduler is called, response type is `text`.
  3. **Cancel callback round-trip**: Same setup, but cancel callback. Verify command is cancelled, response type is text, scheduler is NOT called.
  4. **Edit callback round-trip**: Confirm callback with "edit" transitions to draft, response prompts for changes.
  5. **Stale version rejection**: Callback with wrong version number produces error response.
  6. **Read-only query bypass**: Mock LLM returning `read_query`. Verify scheduler is NOT called, delivery IS called, response type is `text`.
  7. **Out-of-scope rejection**: Mock LLM returning `out_of_scope`. Verify no pending command created, no scheduler call, delivery is called.
  8. **Clarification -> resolution -> confirm**: Three-step flow: first invocation needs clarification (draft created), second invocation resolves clarification (draft updated, transitions to pending_confirmation), third invocation confirms.

**Expected outcome**: Confidence that the full compiled graph produces correct end-state for all major flows, including the new behaviors.

---

### Step 6: Extend existing smoke test with delivery and scheduler contract checks

**What**: The existing `tests/smoke/e2e-pipeline-wiring.mjs` (244 lines) already covers 8 sections: health checks for ai-router/delivery/scheduler/user-management, auth enforcement (missing and invalid tokens), payload validation (invalid payload and non-UUID userId), graph invocation with a valid text message, service connectivity from ai-router, delivery-routing endpoint reachability and caller allowlist, scheduler execute endpoint validation (invalid payload rejection), and callback action event handling.

Rather than creating a separate file, extend this existing smoke test with two additional contract checks that validate the services accept valid payloads:

1. **Delivery contract**: `POST /internal/deliver` with a valid `OutboundMessageIntent` -- currently the existing test only checks the delivery-routing endpoint on user-management, not the delivery service's own deliver endpoint.
2. **Scheduler contract**: `POST /internal/execute` with a valid `ConfirmedCommandPayload` -- currently the existing test only checks that the scheduler rejects invalid payloads, not that it accepts valid ones.

**Files to modify**:
- `tests/smoke/e2e-pipeline-wiring.mjs` -- add two new test sections after the existing Section 8:
  - Section 9: "Delivery Contract Validation" -- create a JWT with issuer `ai-router`, audience `delivery`. Send `POST` to `${DELIVERY}/internal/deliver` with a valid `OutboundMessageIntent` body (`{ userId, connectorType: "telegram", connectorRoutingId: "12345", correlationId, content: { type: "text", text: "smoke test" } }`). Assert status is not 400/401/403 (200 or 502 depending on whether telegram-bridge is up).
  - Section 10: "Scheduler Contract Validation" -- create a JWT with issuer `ai-router`, audience `scheduler`. Send `POST` to `${SCHEDULER}/internal/execute` with a valid `ConfirmedCommandPayload` body (`{ pendingCommandId: uuid, userId: uuid, commandType: "create_note", payload: { type: "create_note", contactId: 1, body: "smoke" }, idempotencyKey: "...", correlationId: uuid, confirmedAt: isoString }`). Assert status is 202 (queued).

**Expected outcome**: The smoke test proves that the real delivery and scheduler services accept valid payloads over the Docker network with proper JWT auth.

---

## Test Strategy

### Unit Tests (Vitest)

**What to test**:
- `execute-action.ts`: Conditional payload validation (strict when `needsClarification` is false, lenient when true), TTL expiry at callback time, draft update for clarification, select callback handling (bypasses version check, updates draft, transitions correctly)
- `format-response.ts`: Existing tests are comprehensive, no changes needed
- `deliver-response.ts`: Existing tests are comprehensive, no changes needed
- `confirm.ts`: Existing tests cover `buildConfirmedPayload`, no changes needed

**What to mock**:
- `deps.createPendingCommand`, `deps.transitionStatus`, `deps.getPendingCommand`, `deps.updateDraftPayload` -- all DB operations
- `deps.schedulerClient.execute` -- scheduler HTTP call
- `deps.userManagementClient.getPreferences` -- user-management HTTP call
- The LLM classifier (via `vi.mock("@langchain/openai")`)

**TDD sequence for each step**:
1. Write the failing test that exercises the specific gap
2. Run the test, confirm it fails with a clear assertion failure
3. Implement the minimal code change to make it pass
4. Run the full execute-action test suite to verify no regressions

### Integration Tests

**What needs real Postgres/Redis**:
- The `repository.integration.test.ts` already tests pending-command CRUD (including `updateDraftPayload`) against real Postgres. No new integration tests needed for repository operations.
- The graph integration tests in `graph.test.ts` use mocked DB -- they test the graph topology and node interactions, not DB persistence.

### Compiled Graph Tests

- All tests in `graph.test.ts` run the full compiled LangGraph graph with mocked dependencies
- They prove that nodes are wired in the correct order and state flows correctly between them

## Smoke Test Strategy

### Docker Compose Services to Start

```bash
docker compose -f docker-compose.yml -f docker-compose.smoke.yml --profile app up -d \
  postgres redis ai-router delivery scheduler user-management
```

### HTTP Checks to Run

The existing `tests/smoke/e2e-pipeline-wiring.mjs` covers sections 1-8. This plan extends it with:

9. **Delivery contract validation**: `POST /internal/deliver` on delivery (port 3006) with valid JWT (issuer: ai-router, audience: delivery) and valid `OutboundMessageIntent` -- expect not-400/401/403

10. **Scheduler contract validation**: `POST /internal/execute` on scheduler (port 3005) with valid JWT (issuer: ai-router, audience: scheduler) and valid `ConfirmedCommandPayload` -- expect 202 (queued)

### What the Smoke Test Proves

- Services start and are reachable through the Docker network
- Service auth (JWT) works between ai-router and scheduler, ai-router and delivery
- Zod schema validation works on the real endpoints
- The full delivery and scheduler ingress contracts accept valid payloads
- The full reverse proxy and port exposure configuration is correct

## Security Considerations

Per `.claude/rules/security.md`:

1. **Payload validation hardening** (Step 1): Adds defense-in-depth Zod validation of `MutatingCommandPayloadSchema` at the point where LLM output enters the pending-command lifecycle. Validation is conditional: strict when the LLM says the payload is complete (`needsClarification` is false), lenient when the payload is an intentional draft. This prevents malformed complete payloads from being stored and later sent to scheduler/monica-integration, while still allowing the clarification flow to function.

2. **TTL enforcement at callback time** (Step 2): Prevents a timing window where a command past its TTL could be confirmed because the expiry sweep hasn't run yet. This is a reliability and security improvement -- stale commands cannot be resurrected.

3. **Service-to-service auth**: Smoke tests verify that JWT auth is enforced on all internal endpoints. The existing `serviceAuth` middleware and per-endpoint `allowedCallers` configurations are not changed.

4. **Sensitive data redaction**: No new logging is added that could leak sensitive data. The existing `redactString` pipeline in `persistTurn` remains unchanged. Error messages returned for stale rejections do not include payload contents.

5. **Idempotency**: The existing `buildConfirmedPayload` generates deterministic idempotency keys. The scheduler's idempotency check prevents duplicate execution. This is not changed.

## Risks & Open Questions

1. **LLM output quality for clarification responses**: The select-callback and clarification-response flows depend on the LLM correctly interpreting the synthetic callback message and producing an updated command payload. If the LLM fails to do this, the draft will not be properly updated. Mitigation: the existing fallback (passthrough with LLM userFacingText) still provides a reasonable user experience. This will be validated in the "LLM Smoke Tests & Benchmark Activation" roadmap item.

2. **`updateDraftPayload` requires draft status**: The repository function only works on commands in `draft` status. If the command has already transitioned to `pending_confirmation` by the time a clarification arrives (race condition), the update will fail. Mitigation: check the return value and handle gracefully -- fall through to `passthrough` if the update returns null.

3. **Select callback data format divergence**: The disambiguation buttons encode data as `select:{contactValue}:0` (version hardcoded to 0 in `outbound-renderer.ts` line 53). After `telegram-bridge` strips the action prefix, ai-router receives `data: "{contactValue}:0"`. The `parseCallbackData` function returns `{ pendingCommandId: contactValue, version: 0 }`. The plan addresses this by checking for `action === "select"` before the version check (Step 4) and treating `parsed.pendingCommandId` as the selected contact value rather than a real pending command ID. The actual pending command is looked up via `state.activePendingCommand.pendingCommandId`.

4. **Read-only query data accuracy**: Read-only queries currently rely on the LLM's `userFacingText` rather than actually fetching data from Monica via monica-integration. This means the LLM might hallucinate contact information. This is a known architectural gap that is out of scope for this task.

5. **Smoke test without real OpenAI**: The pipeline smoke test cannot exercise the full path through the LLM without a real OpenAI key. The smoke test verifies infrastructure plumbing (auth, routing, schema validation) but not LLM behavior. LLM behavior is validated by the separate "LLM Smoke Tests" roadmap item.

6. **ContactId type in select callback**: Monica contact IDs are integers, but the disambiguation option `value` is a string. The `handleSelect` function must parse the selected value to a number via `Number(selectedValue)` and handle NaN gracefully (return `stale_rejected` if the value is not a valid number).
