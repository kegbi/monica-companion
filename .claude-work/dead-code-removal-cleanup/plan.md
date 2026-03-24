# Implementation Plan: Stage 6 — Dead Code Removal & Cleanup

## Objective

Remove all LangGraph pipeline code, the old intent classification system, the pending command state machine, the `conversationTurns` and `pendingCommands` database tables, and the `@langchain/*` dependencies from `ai-router`. These components were replaced by the tool-calling agent loop in Stages 1-5 but remain in the codebase as dead code. Removing them eliminates approximately 8,000+ lines of unused source and test code, removes three npm dependencies, simplifies the build and test configurations, and brings the acceptance criteria documentation in line with the new architecture.

## Scope

### In Scope

- Delete the entire `services/ai-router/src/graph/` directory (source + tests)
- Delete the entire `services/ai-router/src/pending-command/` directory (source + tests)
- Delete `services/ai-router/src/db/turn-repository.ts` and its test
- Relocate `GraphResponse` and `GraphResponseSchema` from `graph/state.ts` to `agent/types.ts` so that `agent/loop.ts` and downstream consumers keep working
- Create a Drizzle migration (0004) to drop the `pending_commands` and `conversation_turns` tables
- Remove the `conversationTurns` and `pendingCommands` Drizzle schema definitions from `db/schema.ts`
- Update `db/index.ts` to stop exporting turn-repository and pending-command table symbols
- Remove the pending command expiry sweep from `index.ts`
- Remove `@langchain/core`, `@langchain/langgraph`, `@langchain/openai` from `ai-router/package.json` and the pnpm catalog
- Remove `@langchain/*` vitest resolve aliases from `vitest.config.ts` and `vitest.llm-integration.config.ts`
- Remove `@langchain/openai` mocks from app-level test files
- Remove `turn-repository.js` and `pending-command/repository.js` mocks from app-level test files
- Remove `EXPIRY_SWEEP_INTERVAL_MS` from `config.ts` and `docker-compose.yml`
- Update retention cleanup code (`retention/cleanup.ts`, `retention/routes.ts`) to stop purging `conversationTurns` and `pendingCommands`
- Update user purge code (`retention/user-purge.ts`, `retention/user-purge-routes.ts`) to stop purging `conversationTurns` and `pendingCommands`
- Update the `AiRouterRetentionCleanupRequestSchema` in `@monica-companion/types` to remove `pendingCommandsCutoff`
- Update the scheduler retention-cleanup-worker to stop sending `pendingCommandsCutoff`
- Delete the LLM integration test file that depends on the old `@langchain/core/messages` and `graph/` imports
- Update smoke test helpers to remove `pending_commands` table queries
- Update `context/product/acceptance-criteria.md` per roadmap instructions
- Clean up `context/product/acceptance-criteria.md` references to the 6-status lifecycle, narrowingContext, and unresolvedContactRef
- Verify all remaining tests pass
- Run Docker Compose smoke tests
- Run the full promptfoo benchmark

### Out of Scope

- Changes to the agent loop logic (already complete in Stages 1-5)
- Changes to the contact-resolution matcher/resolver (stays as-is, called by search_contacts handler)
- Changes to tool handler implementations
- Changes to the promptfoo provider or datasets (they do not depend on graph code)
- Renaming `pendingCommandTtlMinutes` config field (used by the agent loop for pending tool call TTL; cosmetic rename deferred)
- Removing `PendingCommandStatus`, `PendingCommandRecordSchema`, or other types from `@monica-companion/types` that may be referenced by scheduler or other services (these types have a broader scope)

## Affected Services & Packages

| Package/Service | Changes |
|---|---|
| `services/ai-router` | Delete `src/graph/`, `src/pending-command/`, `src/db/turn-repository.ts`; relocate `GraphResponse`; update `db/schema.ts`, `db/index.ts`, `index.ts`, `config.ts`, `vitest.config.ts`, `vitest.llm-integration.config.ts`; add Drizzle migration 0004; update retention code; update or delete app-level test mocks; delete LLM integration test; update smoke test helpers |
| `packages/types` | Update `AiRouterRetentionCleanupRequestSchema` to remove `pendingCommandsCutoff` |
| `services/scheduler` | Update `retention-cleanup-worker.ts` to stop sending `pendingCommandsCutoff` |
| `docker-compose.yml` | Remove `EXPIRY_SWEEP_INTERVAL_MS` env var for ai-router |
| `pnpm-workspace.yaml` | Remove `@langchain/core`, `@langchain/langgraph`, `@langchain/openai` from catalog |
| `context/product/acceptance-criteria.md` | Update command lifecycle and remove obsolete references |
| `context/product/roadmap.md` | Mark Stage 6 items as complete |

## Implementation Steps

### Step 1: Relocate `GraphResponse` type and schema

**What to do:** The `GraphResponse` type and `GraphResponseSchema` currently live in `graph/state.ts` (which imports `@langchain/langgraph`). The agent loop (`agent/loop.ts`) imports `GraphResponse` from there. Before deleting the graph directory, relocate these two exports.

**Files to create/modify:**
- Create `services/ai-router/src/agent/types.ts` containing `GraphResponseSchema` and `GraphResponse` type (copied from `graph/state.ts` lines 81-89, using only `zod/v4` -- no LangGraph dependency)
- Modify `services/ai-router/src/agent/loop.ts`: change `import type { GraphResponse } from "../graph/state.js"` to `import type { GraphResponse } from "./types.js"`

**Expected outcome:** `agent/loop.ts` no longer has any transitive dependency on `@langchain/langgraph` through `graph/state.ts`. All existing tests and imports for `GraphResponse` in the agent directory work via the new location.

### Step 2: Delete the `graph/` directory

**What to do:** Remove the entire `services/ai-router/src/graph/` directory tree. This includes:

- `graph/index.ts` (barrel export)
- `graph/graph.ts` (StateGraph wiring)
- `graph/state.ts` (ConversationAnnotation, ConversationStateSchema, NarrowingContextSchema, TurnSummarySchema, PendingCommandRefSchema, ActionOutcomeSchema, GraphResponseSchema)
- `graph/intent-schemas.ts` (IntentClassificationResultSchema, 77 lines)
- `graph/system-prompt.ts` (old buildSystemPrompt, replaced by `agent/system-prompt.ts`)
- `graph/llm.ts` (ChatOpenAI wrapper, replaced by OpenAI SDK in `agent/llm-client.ts`)
- `graph/nodes/execute-action.ts` (~980 lines) + `__tests__/execute-action.test.ts` (~2,265 lines)
- `graph/nodes/resolve-contact-ref.ts` (~797 lines) + `__tests__/resolve-contact-ref.test.ts` (~1,408 lines)
- `graph/nodes/format-response.ts` (~141 lines) + `__tests__/format-response.test.ts`
- `graph/nodes/classify-intent.ts` + `__tests__/classify-intent.test.ts`
- `graph/nodes/deliver-response.ts` + `__tests__/deliver-response.test.ts`
- `graph/nodes/persist-turn.ts` + `__tests__/persist-turn.test.ts`
- `graph/nodes/load-context.ts` + `__tests__/load-context.test.ts`
- `graph/__tests__/graph.test.ts`
- `graph/__tests__/state.test.ts`
- `graph/__tests__/system-prompt.test.ts`
- `graph/__tests__/llm.test.ts`
- `graph/__tests__/intent-schemas.test.ts`
- `graph/nodes/__tests__/node-spans.test.ts`

**Expected outcome:** The `src/graph/` directory no longer exists. No production code references it (Step 1 relocated the only live import).

### Step 3: Delete the `pending-command/` directory

**What to do:** Remove the entire `services/ai-router/src/pending-command/` directory tree:

- `pending-command/index.ts` (barrel export)
- `pending-command/repository.ts` (321 lines -- createPendingCommand, transitionStatus, etc.)
- `pending-command/state-machine.ts` (assertTransition, isTerminal, isActive)
- `pending-command/confirm.ts` (buildConfirmedPayload)
- `pending-command/expiry-sweep.ts` (startExpirySweep)
- `pending-command/__tests__/confirm.test.ts`
- `pending-command/__tests__/state-machine.test.ts`
- `pending-command/__tests__/narrowing-context.test.ts`
- `pending-command/__tests__/repository.integration.test.ts`

**Expected outcome:** The `src/pending-command/` directory no longer exists.

### Step 4: Delete `db/turn-repository.ts` and its test

**What to do:** The `turn-repository.ts` module operates on the `conversationTurns` table (being dropped) and imports `TurnSummary` from the deleted `graph/state.ts`. It is no longer used by any production code path (the agent loop uses `history-repository.ts` instead).

**Files to delete:**
- `services/ai-router/src/db/turn-repository.ts`
- `services/ai-router/src/db/__tests__/turn-repository.test.ts`

**Files to modify:**
- `services/ai-router/src/db/index.ts`: Remove the exports of `getRecentTurns`, `insertTurnSummary`, `ConversationTurnRow`, and `InsertTurnParams` from `./turn-repository.js`. Remove the export of `conversationTurns` and `pendingCommands` from `./schema.js`. Keep the export of `createDb`, `Database`, and `conversationHistory`.

**Expected outcome:** `db/index.ts` only exports connection utilities and the `conversationHistory` schema.

### Step 5: Update `db/schema.ts` -- remove old table definitions

**What to do:** Remove the `conversationTurns` and `pendingCommands` table definitions from `services/ai-router/src/db/schema.ts`. Keep only the `conversationHistory` table.

**Files to modify:**
- `services/ai-router/src/db/schema.ts`: Delete the `conversationTurns` table definition and the `pendingCommands` table definition. Keep the `conversationHistory` table and its imports.

**Also update:**
- `services/ai-router/src/db/__tests__/schema.test.ts`: Update or replace with a minimal test for the `conversationHistory` table schema only.

**Expected outcome:** `schema.ts` only defines the `conversationHistory` table.

### Step 6: Create Drizzle migration 0004 to drop old tables

**What to do:** Create a new SQL migration file that drops the `pending_commands` and `conversation_turns` tables.

**File to create:**
- `services/ai-router/drizzle/0004_drop_legacy_tables.sql`:
  ```sql
  DROP TABLE IF EXISTS "pending_commands";
  --> statement-breakpoint
  DROP TABLE IF EXISTS "conversation_turns";
  ```

**Also update:**
- `services/ai-router/drizzle/meta/_journal.json`: Add the entry for migration 0004.
- `services/ai-router/drizzle/meta/0004_snapshot.json`: Generate to reflect only the `conversationHistory` table.

**Expected outcome:** On next service startup, the migration runner drops the `pending_commands` and `conversation_turns` tables.

### Step 7: Remove the pending command expiry sweep from `index.ts`

**What to do:** The service entrypoint (`services/ai-router/src/index.ts`) imports and starts `startExpirySweep` from `pending-command/expiry-sweep.ts`, which no longer exists.

**Files to modify:**
- `services/ai-router/src/index.ts`:
  - Remove the import of `startExpirySweep`
  - Remove the `stopExpirySweep` invocation
  - Remove `stopExpirySweep()` from the shutdown handler

**Expected outcome:** The service starts without the expiry sweep. The history inactivity sweep continues to run.

### Step 8: Clean up `config.ts` -- remove `EXPIRY_SWEEP_INTERVAL_MS`

**What to do:** Remove the `EXPIRY_SWEEP_INTERVAL_MS` config field.

**Files to modify:**
- `services/ai-router/src/config.ts`: Remove `EXPIRY_SWEEP_INTERVAL_MS` from the schema, interface, and mapping
- `services/ai-router/src/__tests__/config.test.ts`: Remove tests for `expirySweepIntervalMs`
- App-level test files: Remove `expirySweepIntervalMs` from mock configs
- `docker-compose.yml`: Remove the `EXPIRY_SWEEP_INTERVAL_MS` env var for ai-router

**Expected outcome:** Config no longer includes expiry sweep interval.

### Step 9: Remove `@langchain/*` dependencies

**Files to modify:**
- `services/ai-router/package.json`: Remove `@langchain/core`, `@langchain/langgraph`, `@langchain/openai` from dependencies
- `pnpm-workspace.yaml`: Remove the three catalog entries

**Expected outcome:** No LangChain packages remain. Run `pnpm install` to update lockfile.

### Step 10: Clean up vitest resolve aliases

**Files to modify:**
- `services/ai-router/vitest.config.ts`: Remove `@langchain/core/messages` alias
- `services/ai-router/vitest.llm-integration.config.ts`: Delete this file entirely

**Expected outcome:** Vitest configs no longer reference LangChain packages.

### Step 11: Remove stale mocks from app-level tests

**Files to modify:**
- `process-endpoint.test.ts`: Remove mocks for `@langchain/openai`, `turn-repository.js`, `pending-command/repository.js`
- `clear-history-endpoint.test.ts`: Same
- `middleware-ordering.test.ts`: Same
- `guardrails-wiring.test.ts`: Same
- `contact-resolution/routes.test.ts`: Remove `@langchain/openai` mock

**Expected outcome:** App-level tests pass without stale mocks.

### Step 12: Delete LLM integration test file

**Files to delete:**
- `services/ai-router/src/__tests__/llm-integration/llm-integration.test.ts` and directory
- `services/ai-router/vitest.llm-integration.config.ts`
- Remove `test:llm-integration` script from `package.json`

### Step 13: Delete the read-only bypass test

**File to delete:**
- `services/ai-router/src/__tests__/read-only-bypass.test.ts`

### Step 14: Update retention cleanup code

**Files to modify:**
- `retention/cleanup.ts`: Remove `purgeExpiredConversationTurns()` and `purgeExpiredPendingCommands()`
- `retention/routes.ts`: Remove calls and update response shape
- `retention/user-purge.ts`: Remove `purgeUserConversationTurns()` and `purgeUserPendingCommands()`
- `retention/user-purge-routes.ts`: Remove calls and update response shape
- Tests: Update retention and user-purge endpoint tests

### Step 15: Update `@monica-companion/types` retention schema

- `packages/types/src/retention.ts`: Remove `pendingCommandsCutoff`, rename `conversationTurnsCutoff` to `conversationHistoryCutoff`
- Update tests

### Step 16: Update scheduler retention-cleanup-worker

- `services/scheduler/src/workers/retention-cleanup-worker.ts`: Remove `pendingCommandCutoff`, update field name
- Update tests

### Step 17: Update smoke test helpers

- `ai-router/src/__smoke__/helpers.ts`: Remove `getPendingCommandsForUser()` and `assertNoPendingCommands()`
- `out-of-scope.smoke.test.ts`: Remove `assertNoPendingCommands` assertions
- Update comments in other smoke test files

### Step 18: Update `acceptance-criteria.md`

Replace pending command lifecycle references with tool-calling agent confirmation model. Remove references to narrowingContext, unresolvedContactRef, and the 6-status lifecycle.

### Step 19: Verify all remaining tests pass

Run full test suite: `pnpm install`, `pnpm test`, `pnpm check`

### Step 20: Run Docker Compose smoke tests and promptfoo benchmark

### Step 21: Mark roadmap items complete

## Test Strategy

- **After Step 1:** Run ai-router tests to verify relocated import works
- **After Steps 2-4:** Verify no import errors from deleted modules
- **After Step 5:** Schema test for conversationHistory only
- **After Step 8:** Config tests pass without expiry sweep
- **After Step 11:** App-level tests pass without stale mocks
- **After Steps 14-16:** Retention and scheduler tests pass
- **After Step 19:** Full test suite green
- **After Step 20:** Smoke tests and benchmark pass

## Security Considerations

- No new public endpoints added
- Service auth and per-endpoint caller allowlists unchanged
- Credential handling and redaction unchanged
- DROP TABLE migration removes potentially sensitive pending command data (aligns with data governance)
- Migration runs on container startup after new code is mounted (safe ordering)

## Risks & Open Questions

1. **Migration ordering:** Safe in Docker Compose (code deploys before migration runs)
2. **Retention schema rename:** Renaming `conversationTurnsCutoff` to `conversationHistoryCutoff` for clarity; coordinated with scheduler update
3. **Types package unused exports:** `PendingCommandStatus` etc. remain in types — separate cleanup pass
4. **CI workflow check:** Verify `.github/workflows/` does not reference `test:llm-integration` script
5. **Smoke test assertion change:** Replacing DB query with HTTP-level assertion for out-of-scope tests
