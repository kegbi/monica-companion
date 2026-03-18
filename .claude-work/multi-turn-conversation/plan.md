# Implementation Plan: Multi-Turn Conversation & Context Preservation

## Objective

Enable the ai-router LangGraph pipeline to maintain conversation context across turns so users can use follow-up references ("add a note to him too"), receive clarification questions when intent is ambiguous, and have disambiguation choices update existing draft commands rather than creating new ones. Compressed turn summaries (not raw utterances) are persisted after each interaction to satisfy data-governance minimization requirements.

## Scope

### In Scope

- Add a `loadContext` graph node that reads the most recent N turn summaries from the existing `conversation_turns` table into state.
- Add a `persistTurn` graph node that writes a compressed summary after processing (user turn + assistant turn).
- Add `MAX_CONVERSATION_TURNS` config parameter (default 10).
- Update `buildSystemPrompt` to accept and render conversation history so the LLM can resolve pronouns and follow-up references.
- Update `classifyIntent` to pass conversation history to the LLM.
- Update `formatResponse` to produce `clarification_prompt` and `disambiguation_prompt` response types when the LLM signals ambiguity or missing fields.
- Add `needsClarification` field to `IntentClassificationResultSchema` so the LLM can signal when clarification is needed.
- Track active pending command in state: when a follow-up arrives while a draft command exists, attach it to the existing command instead of creating a new one.
- Handle callback_action events for multi-step disambiguation: resolve the selected contact and re-evaluate the command.
- Graph topology change: `START -> loadContext -> classifyIntent -> formatResponse -> persistTurn -> END`.
- Create a `turn-repository.ts` module for conversation_turns DB operations.
- Database dependency injection through graph config (not global imports).

### Out of Scope

- Actual HTTP calls to `delivery` service for sending clarification questions (deferred to End-to-End Pipeline Wiring).
- Actual pending command DB writes from within the graph nodes (the graph sets `activePendingCommand` in state; the route handler orchestrates actual DB writes).
- Auto-confirmation logic (End-to-End Pipeline Wiring).
- Contact resolution HTTP calls to `monica-integration`.
- Retention cleanup of old conversation_turns records (Phase 7 Data Governance).

## Affected Services & Packages

| Package/Service | Changes |
|-----------------|---------|
| `services/ai-router` | New graph nodes (`loadContext`, `persistTurn`), updated graph topology, updated system prompt, updated config, new `turn-repository.ts`, updated `classifyIntent` and `formatResponse`, updated `app.ts` to inject DB into graph |
| `packages/types` | No changes needed |

## Implementation Steps

### Step 1: Add `MAX_CONVERSATION_TURNS` config

Add `MAX_CONVERSATION_TURNS` env var (default 10) to config schema and `Config` interface.

**Files:**
- Modify: `services/ai-router/src/config.ts`
- Modify: `services/ai-router/src/__tests__/config.test.ts`

### Step 2: Create `turn-repository.ts` for conversation_turns DB operations

Create repository with `getRecentTurns(db, userId, limit)` and `insertTurnSummary(db, params)`.

- `getRecentTurns`: SELECT from `conversationTurns` WHERE userId ORDER BY createdAt DESC LIMIT N, reverse for chronological order.
- `insertTurnSummary`: INSERT compressed summary (never raw utterance).

**Files:**
- Create: `services/ai-router/src/db/turn-repository.ts`
- Create: `services/ai-router/src/db/__tests__/turn-repository.test.ts`

### Step 3: Update graph config to accept DB dependency

Extend `ConversationGraphConfig` to accept `db: Database` and `maxConversationTurns: number`. Update `createApp` to pass these.

**Files:**
- Modify: `services/ai-router/src/graph/graph.ts`
- Modify: `services/ai-router/src/app.ts`
- Modify: `services/ai-router/src/graph/__tests__/graph.test.ts`

### Step 4: Implement `loadContext` graph node

Node that loads recent turn summaries and active pending command from DB into state.

- `createLoadContextNode(deps: { db, maxTurns })` returns async node.
- Calls `getRecentTurns` and checks for active pending command.
- Returns `{ recentTurns, activePendingCommand }`.

**Files:**
- Create: `services/ai-router/src/graph/nodes/load-context.ts`
- Create: `services/ai-router/src/graph/nodes/__tests__/load-context.test.ts`

### Step 5: Update system prompt to include conversation history

Modify `buildSystemPrompt` to accept optional `recentTurns` and `activePendingCommand`. When present, include them in the prompt for pronoun resolution and follow-up handling.

Add instructions for:
- Resolving pronouns from conversation context
- Attaching follow-ups to active pending commands
- Setting `needsClarification` when ambiguous

**Files:**
- Modify: `services/ai-router/src/graph/system-prompt.ts`
- Modify: `services/ai-router/src/graph/__tests__/system-prompt.test.ts`

### Step 6: Add `needsClarification` to intent classification schema

Extend `IntentClassificationResultSchema` with:
- `needsClarification: z.boolean().default(false)`
- `clarificationReason: z.enum(["ambiguous_contact", "missing_fields", "unclear_intent"]).optional()`
- `disambiguationOptions: z.array(z.object({ label, value })).optional()`

**Files:**
- Modify: `services/ai-router/src/graph/intent-schemas.ts`
- Modify: `services/ai-router/src/graph/__tests__/intent-schemas.test.ts`

### Step 7: Update `classifyIntent` to pass conversation context to LLM

- Call `buildSystemPrompt({ recentTurns, activePendingCommand })` instead of bare `buildSystemPrompt()`.
- For callback_action with active pending command: construct synthetic message and pass through LLM with context.

**Files:**
- Modify: `services/ai-router/src/graph/nodes/classify-intent.ts`
- Modify: `services/ai-router/src/graph/nodes/__tests__/classify-intent.test.ts`

### Step 8: Update `formatResponse` for clarification and disambiguation

When `needsClarification` is true:
- With `disambiguationOptions`: produce `disambiguation_prompt` response
- Without options: produce `clarification_prompt` response type (use `type: "text"` with clarification text)
- Include `pendingCommandId` and `version` when available

**Files:**
- Modify: `services/ai-router/src/graph/nodes/format-response.ts`
- Modify: `services/ai-router/src/graph/nodes/__tests__/format-response.test.ts`

### Step 9: Implement `persistTurn` graph node

Node that writes compressed turn summaries to DB after processing.

- Persists user turn: compressed as `commandType + contactRef` (e.g., "Requested create_note for Jane").
- Persists assistant turn: compressed as response type summary.
- Never stores raw utterances or full LLM responses.
- Error resilient: catches DB errors, user still gets response.
- Returns empty state update `{}`.

**Files:**
- Create: `services/ai-router/src/graph/nodes/persist-turn.ts`
- Create: `services/ai-router/src/graph/nodes/__tests__/persist-turn.test.ts`

### Step 10: Wire new graph topology

`START -> loadContext -> classifyIntent -> formatResponse -> persistTurn -> END`

**Files:**
- Modify: `services/ai-router/src/graph/graph.ts`
- Modify: `services/ai-router/src/graph/__tests__/graph.test.ts`

### Step 11: Update existing tests

Update all test files that create the app or reference the graph to include db mock and new config.

**Files:**
- Update: all test files in `services/ai-router/src/__tests__/`

## Test Strategy

### Unit Tests (Vitest)

| Component | Tests | Mocks |
|-----------|-------|-------|
| `turn-repository.ts` | Query construction, result mapping, insert | Drizzle db |
| `load-context.ts` | State population, empty/non-empty turns, active command | Repository functions |
| `persist-turn.ts` | Summary compression, two-row insert, error resilience | Repository functions |
| `system-prompt.ts` | History rendering, active command, backward compat | None |
| `classify-intent.ts` | Context passed to LLM, callback with active command | Classifier mock |
| `format-response.ts` | Clarification/disambiguation response types | None |
| `config.ts` | MAX_CONVERSATION_TURNS default and override | None |

### TDD Sequence

For each step, write failing test FIRST, then implement to pass.

## Smoke Test Strategy

### Services: postgres, redis, ai-router

### Checks:
1. Health check OK
2. First turn creates conversation history
3. Follow-up turn resolves pronoun from context
4. DB has compressed summaries (not raw text)

## Security Considerations

- No raw utterances persisted (data governance)
- Turn summaries use only intent type + command type + contact display name
- No API keys, phone numbers, email addresses in summaries
- Service auth unchanged
- No Telegram/Monica specifics in summaries
- Pending command references in prompts include only type/status/ID, no payloads

## Risks

1. LLM pronoun resolution quality from compressed summaries — needs benchmark validation
2. Turn summary compression fidelity vs. privacy trade-off — adjustable after benchmarks
3. Callback action handling via LLM with synthetic messages — may need deterministic handler later
4. persistTurn failure resilience — best-effort, gaps acceptable for V1
5. Concurrent same-user requests — acceptable since Telegram is sequential per user
