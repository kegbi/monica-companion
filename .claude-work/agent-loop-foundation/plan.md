# Implementation Plan: Stage 1 — Agent Loop Foundation

**Revision 2** — Addresses all findings from plan-review.md (CRITICAL-1, MEDIUM-1 through MEDIUM-4, LOW-1 through LOW-3).

## Objective

Replace the LangGraph StateGraph pipeline in `ai-router/src/graph/` with a single async agent loop function backed by the OpenAI SDK. The current 7-node pipeline (loadContext, classifyIntent, resolveContactRef, executeAction, formatResponse, deliverResponse, persistTurn) becomes: load history, LLM call with tools, execute or intercept, persist history. This is the foundation layer; Stages 2-6 will add confirmation guardrails, tool handlers, testing, and dead code removal on top of it.

## Scope

### In Scope

- New OpenAI SDK LLM client with configurable base URL (OpenRouter, OpenAI, vLLM, Ollama)
- New env vars: `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL_ID`
- New `conversationHistory` DB table (one row per user, JSONB messages array, pendingToolCall, updatedAt)
- New history repository (get/save/clear/clearStale)
- New agent loop function (`runAgentLoop`) with explicit deps interface
- New tool definitions (11 tools as OpenAI function schemas) with explicit `MUTATING_TOOLS` and `READ_ONLY_TOOLS` sets
- New system prompt for tool-calling agent
- `/clear` command in telegram-bridge calling new `POST /internal/clear-history` on ai-router
- 24h inactivity hard-clear (interval-based cleanup query)
- Wiring the agent loop into the existing `/internal/process` route
- Drizzle migration for the new `conversationHistory` table
- Adding `openai` SDK to ai-router/package.json (alongside existing `@langchain/*` deps)
- Docker Compose smoke test verification

### Out of Scope

- Tool handler implementations (Stage 4)
- Confirmation guardrail / pending tool call interception (Stage 2)
- Contact resolution via `search_contacts` tool (Stage 3)
- Promptfoo eval migration (Stage 5)
- Deletion of old graph nodes, pending command state machine, intent-schemas (Stage 6)
- Removal of `@langchain/*` dependencies (Stage 6 — old graph code still imports them)
- Changes to `delivery`, `scheduler`, `monica-integration`, or `user-management` services
- Changes to the `GraphResponse` schema or outbound delivery contract

### Critical Constraint: Response Contract Stability

The `/internal/process` endpoint MUST continue returning the same `GraphResponse` shape (`type: "text" | "confirmation_prompt" | "disambiguation_prompt" | "error"`, `text`, optional `pendingCommandId`/`version`/`options`) so `delivery` and `telegram-bridge` need zero changes. During Stage 1, before the confirmation guardrail exists (Stage 2), the agent loop will only return `type: "text"` or `type: "error"` responses.

### Critical Constraint: LangChain Dependency Coexistence

The `@langchain/*` packages (`@langchain/core`, `@langchain/langgraph`, `@langchain/openai`) MUST remain in `ai-router/package.json` and the pnpm catalog throughout Stages 1-5. Five source files under `src/graph/` import from these packages, and `tsconfig.json` has `"include": ["src"]`, meaning TypeScript type-checks all `.ts` files — not just those on the runtime call path. Removing the deps before deleting the graph code (Stage 6) would break `tsc`, Biome, and Vitest. The vitest resolve alias for `@langchain/core/messages` must also be retained.

## Affected Services & Packages

| Package/Service | Changes |
|-----------------|---------|
| `services/ai-router` | New `src/agent/` directory with loop, tools, system-prompt, history-repository, llm-client, history-inactivity-sweep. Modified `src/config.ts` (new env vars), `src/db/schema.ts` (new table), `src/app.ts` (wire agent loop + clear-history endpoint), `src/index.ts` (start inactivity sweep). New Drizzle migration. Add `openai: "catalog:"` to package.json (alongside existing `@langchain/*`). Vitest config: keep existing `@langchain/core/messages` alias. |
| `services/telegram-bridge` | New `src/bot/handlers/clear.ts`. Modified `src/bot/setup.ts` (register /clear, update ordering comment, extend `SetupDeps`). Modified `src/lib/ai-router-client.ts` (add `clearHistory` method). Modified `src/app.ts` (wire `clearHistory` dep). |
| `.env.example` | Add `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL_ID`. Keep `OPENAI_API_KEY`. |
| `docker-compose.yml` | Add `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL_ID` to ai-router environment block. |

## Implementation Steps

### Step 1: Config — New LLM env vars

**What:** Add `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL_ID` to `ai-router/src/config.ts`. The existing `OPENAI_API_KEY` is retained because the current `guardrailMiddleware` costEstimator references it and `voice-transcription` uses it independently. The new vars drive only the agent loop's LLM client.

**Files to modify:**
- `services/ai-router/src/config.ts` — add three new fields to the Zod schema and Config interface:
  - `LLM_BASE_URL` (string, default `https://openrouter.ai/api/v1`)
  - `LLM_API_KEY` (string, min 1, no default — required)
  - `LLM_MODEL_ID` (string, default `qwen/qwen3-235b-a22b`)
  - Map to `llmBaseUrl`, `llmApiKey`, `llmModelId` on the Config interface
- `services/ai-router/src/__tests__/config.test.ts` — add tests for new env vars, defaults, and missing-key rejection

**Expected outcome:** `loadConfig()` parses the new vars. Existing tests still pass. New tests verify defaults and required behavior.

### Step 2: OpenAI SDK client

**What:** Create a thin LLM client wrapper using the `openai` SDK (already in pnpm catalog at `6.31.0`).

**Files to create:**
- `services/ai-router/src/agent/llm-client.ts` — exports `createLlmClient(config: { baseUrl: string, apiKey: string, modelId: string, timeoutMs?: number })` returning an object with `chatCompletion()` method. Internally creates an `OpenAI` instance with `baseURL` and `apiKey`, calls `openai.chat.completions.create({ model, messages, tools })` with a 30-second timeout.

**Files to create (test):**
- `services/ai-router/src/agent/__tests__/llm-client.test.ts` — unit test with mocked `openai` SDK. Verify correct base URL/key/model passed, timeout applied, error propagation.

**Dependencies:** Add `"openai": "catalog:"` to `ai-router/package.json`. No vitest resolve alias needed (voice-transcription uses `openai` without one).

### Step 3: Conversation history DB table

**What:** Add a `conversationHistory` table to the Drizzle schema. One row per user. `userId` is `uuid` type, consistent with existing tables.

**Files to modify:**
- `services/ai-router/src/db/schema.ts` — add `conversationHistory` table with: `id` (uuid PK), `userId` (uuid, unique), `messages` (jsonb, default `[]`), `pendingToolCall` (jsonb, nullable), `updatedAt` (timestamptz). Indexes on userId and updatedAt.

**Files to create:**
- Drizzle migration SQL generated via `drizzle-kit generate`

### Step 4: History repository

**What:** Create CRUD functions for the `conversationHistory` table with sliding window truncation (40 messages).

**Files to create:**
- `services/ai-router/src/agent/history-repository.ts` — exports: `getHistory`, `saveHistory` (upsert with truncation), `clearHistory`, `clearStaleHistories`

**Files to create (test):**
- `services/ai-router/src/agent/__tests__/history-repository.test.ts` — ~8 tests

### Step 5: Tool definitions

**What:** Define all 11 tools as OpenAI function-calling format schemas. Explicitly partition into `MUTATING_TOOLS` (7) and `READ_ONLY_TOOLS` (4, including `search_contacts`).

**Files to create:**
- `services/ai-router/src/agent/tools.ts` — exports `TOOL_DEFINITIONS`, `MUTATING_TOOLS`, `READ_ONLY_TOOLS`
  - `READ_ONLY_TOOLS = new Set(["search_contacts", "query_birthday", "query_phone", "query_last_note"])`
  - `MUTATING_TOOLS = new Set(["create_note", "create_contact", "create_activity", "update_contact_birthday", "update_contact_phone", "update_contact_email", "update_contact_address"])`

**Files to create (test):**
- `services/ai-router/src/agent/__tests__/tools.test.ts`

### Step 6: System prompt

**What:** Create the new agent system prompt optimized for tool-calling. Carries forward security rules from current `graph/system-prompt.ts`.

**Files to create:**
- `services/ai-router/src/agent/system-prompt.ts` — exports `buildAgentSystemPrompt(): string`
- `services/ai-router/src/agent/__tests__/system-prompt.test.ts`

### Step 7: Agent loop function

**What:** Create the core agent loop with explicit deps interface.

**Deps interface:**
```ts
export interface AgentLoopDeps {
  llmClient: LlmClient;
  db: Database;
  deliveryClient: DeliveryClient;
  userManagementClient: UserManagementClient;
}
```

**Files to create:**
- `services/ai-router/src/agent/loop.ts` — `runAgentLoop(deps, userId, inboundEvent, correlationId)` with while-loop (max 5 iterations), tool call stub results, history persistence, delivery integration
- `services/ai-router/src/agent/__tests__/loop.test.ts` — ~12 tests

### Step 8: Wire agent loop into process route

**What:** Replace graph invocation in `app.ts` with `runAgentLoop()`. Keep serviceAuth + guardrailMiddleware. Old graph code retained but not called.

**Files to modify:**
- `services/ai-router/src/app.ts`
- `services/ai-router/src/__tests__/process-endpoint.test.ts`

### Step 9: `/clear` command — ai-router endpoint

**What:** Add `POST /internal/clear-history` with serviceAuth (allowedCallers: telegram-bridge).

**Files to modify:**
- `services/ai-router/src/app.ts`
- `services/ai-router/src/__tests__/clear-history-endpoint.test.ts` (new)

### Step 10: `/clear` command — telegram-bridge handler

**What:** Add `/clear` command handler, update SetupDeps and ordering comment.

**Files to create:**
- `services/telegram-bridge/src/bot/handlers/clear.ts`
- `services/telegram-bridge/src/bot/handlers/__tests__/clear-command.test.ts`

**Files to modify:**
- `services/telegram-bridge/src/bot/setup.ts` — register /clear, update ordering comment (9 items), extend SetupDeps
- `services/telegram-bridge/src/lib/ai-router-client.ts` — add `clearHistory` method
- `services/telegram-bridge/src/app.ts` — wire dep
- `services/telegram-bridge/src/bot/__tests__/setup.test.ts` — update command count to 3

### Step 11: 24h inactivity hard-clear

**What:** Interval-based cleanup using `setInterval` (same pattern as expiry-sweep.ts).

**Files to create:**
- `services/ai-router/src/agent/history-inactivity-sweep.ts`
- `services/ai-router/src/agent/__tests__/history-inactivity-sweep.test.ts`

**Files to modify:**
- `services/ai-router/src/index.ts` — start sweep, add to shutdown handler
- `services/ai-router/src/config.ts` — add `HISTORY_INACTIVITY_SWEEP_INTERVAL_MS`

### Step 12: Add OpenAI SDK dependency and env vars

**What:** Add `openai` to ai-router alongside existing `@langchain/*`. Add env vars to `.env.example` and `docker-compose.yml`.

**NOT changed (deferred to Stage 6):**
- `pnpm-workspace.yaml` — `@langchain/*` catalog entries stay
- `services/ai-router/vitest.config.ts` — `@langchain/core/messages` alias stays
- `services/ai-router/package.json` — `@langchain/*` deps stay

### Step 13: Update retention and user-purge routes

**What:** Handle both `conversationTurns` and `conversationHistory` in retention and user purge routes.

**Files to modify:**
- `services/ai-router/src/retention/cleanup.ts`
- `services/ai-router/src/retention/user-purge.ts`
- `services/ai-router/src/retention/routes.ts`
- `services/ai-router/src/retention/user-purge-routes.ts`
- Tests for above

### Step 14: Docker Compose Smoke Test

**Services:** postgres, redis, ai-router, user-management, delivery

**Checks:**
1. Health check: `GET /health` returns 200
2. Migration verification: `conversation_history` table exists with indexes
3. Process endpoint: POST with valid JWT returns valid GraphResponse
4. Process endpoint auth: POST without JWT returns 401
5. Clear-history: POST with telegram-bridge JWT returns 200
6. Clear-history auth: POST with scheduler JWT returns 403

## Test Strategy

### TDD Sequence (RED → GREEN → REFACTOR)

Each step writes failing test first, then implements.

### What to Mock
- **OpenAI SDK**: always mocked in unit tests
- **Database**: mocked in unit tests, real Postgres in integration tests
- **Service clients**: always mocked
- **OTel/Logger**: no-op (existing pattern)

## Database Migration Plan

1. Migration creates `conversation_history` table with uuid userId, jsonb messages, indexes
2. Does NOT drop `conversation_turns` or `pending_commands` (Stage 6)
3. Rollback: `DROP TABLE IF EXISTS conversation_history`

## Security Considerations

1. `POST /internal/clear-history` uses `serviceAuth` with `allowedCallers: ["telegram-bridge"]`
2. `LLM_API_KEY` never logged — redaction package covers API key patterns
3. Conversation history with 24h inactivity hard-clear, 40-message sliding window, user `/clear`, retention cleanup
4. System prompt carries forward injection defenses from `graph/system-prompt.ts`
5. No public exposure — internal-only endpoints
6. User purge on disconnect deletes conversation history

## Risks

1. **Zod JSON Schema**: Verify `zod@4.3.6` `.toJsonSchema()` or use `zod-to-json-schema`
2. **OpenRouter compatibility**: Verify in smoke tests
3. **Model capability**: Default model must support tool calling — configurable
4. **Stage 1 partial functionality**: Tool calls stubbed until Stage 4
5. **Conversation history size**: 40-message sliding window + 24h sweep mitigates growth
6. **Vitest alias for openai**: Not needed based on voice-transcription precedent

## Decisions

1. `LLM_API_KEY` does NOT fall back to `OPENAI_API_KEY` — `OPENAI_API_KEY` retained for guardrailMiddleware and voice-transcription
2. 24h inactivity sweep uses `setInterval` (same as expiry-sweep pattern)
3. `userId` column uses `uuid` type, consistent with existing tables
4. Messages stored as raw OpenAI SDK types in JSONB
5. `@langchain/*` deps remain through Stages 1-5; removed in Stage 6
6. `search_contacts` classified as read-only in `READ_ONLY_TOOLS`
