# Implementation Plan: LangGraph Pipeline Foundation

## Objective

Wire the LangGraph AI orchestration engine into `ai-router` so that `POST /internal/process` invokes a real LangGraph `StateGraph` instead of returning a stub `{ received: true }`. This establishes the graph skeleton, typed conversation state, and persistence layer (conversation_turns table) that all subsequent Phase 6 tasks (intent classification, multi-turn context, end-to-end wiring) build upon.

## Scope

### In Scope

- Install `@langchain/langgraph` and `@langchain/openai` in `ai-router` with pinned exact versions.
- Define a LangGraph `StateGraph` with a typed conversation state schema (Zod + LangGraph StateSchema).
- Add a `conversation_turns` PostgreSQL table via Drizzle ORM with configurable retention (default 30 days).
- Replace the stub in `POST /internal/process` with a graph invocation.
- Ensure the graph runner executes behind existing guardrail middleware (rate limits, concurrency caps, budget tracking, kill switch).
- Add `OPENAI_API_KEY` (optional, not needed until Intent Classification task) to the ai-router config schema.
- A single placeholder node ("echo") that acknowledges the message, proving the graph executes end-to-end. Actual LLM calls come in the next task group (Intent Classification & Command Parsing).

### Out of Scope

- Actual OpenAI LLM calls (deferred to Intent Classification & Command Parsing task).
- Intent classification, system prompts, structured output parsing.
- Multi-turn conversation loading from `conversation_turns` (deferred to Multi-Turn Conversation task).
- Connecting output to `delivery` or `scheduler`.
- Contact resolution integration within the graph.
- Retention cleanup jobs for `conversation_turns`.

## Affected Services & Packages

| Package/Service | Changes |
|-----------------|---------|
| `services/ai-router` | New dependencies, new DB table, new graph module, updated `/internal/process` handler, updated config |
| `packages/types` | No changes (existing schemas sufficient) |
| `docker-compose.yml` | Add `OPENAI_API_KEY` env var to ai-router service (optional, for future LLM calls) |

## Implementation Steps

### Step 1: Install LangGraph and OpenAI dependencies

**What to do:**
- Add `@langchain/langgraph` and `@langchain/openai` to `services/ai-router/package.json` under `dependencies` with exact pinned versions.
- Only add `@langchain/core` as an explicit dependency if direct imports are needed (e.g., `RunnableConfig`). If langgraph/openai re-export everything needed, omit it to avoid version conflicts.
- Run `pnpm install` from the monorepo root.

**Note on versions:** Before implementation, verify current latest stable versions on npmjs.com and pin accordingly. No `^` or `~` ranges. Ensure `@langchain/langgraph` and `@langchain/openai` require compatible `@langchain/core` peer versions.

**Files to modify:**
- `services/ai-router/package.json` -- add 2-3 new dependencies
- `pnpm-workspace.yaml` -- add catalog entries if used

**Expected outcome:** `pnpm install` succeeds, existing tests still pass.

### Step 2: Add `conversation_turns` Drizzle schema

**What to do:**
- Add the `conversationTurns` table definition to `services/ai-router/src/db/schema.ts`.
- Export it from `services/ai-router/src/db/index.ts`.

**Table schema:**

```
conversation_turns
  id            uuid        PK, default gen_random_uuid()
  user_id       uuid        NOT NULL
  role          text        NOT NULL  -- 'user' | 'assistant' | 'system'
  summary       text        NOT NULL  -- compressed turn summary (NOT raw utterance)
  correlation_id text       NOT NULL
  created_at    timestamptz NOT NULL  DEFAULT NOW()
```

**Indexes:**
- `idx_conversation_turns_user_created` on `(user_id, created_at DESC)` -- for fetching recent turns per user.
- `idx_conversation_turns_created_at` on `(created_at)` -- for retention cleanup.

**Design notes:**
- `role` is a text column validated at application layer with Zod.
- No raw utterance or full LLM response stored -- only compressed summaries per data governance rules.
- `user_id` is a cross-service reference with no FK constraint (same pattern as existing tables).

**Files to modify:**
- `services/ai-router/src/db/schema.ts` -- add `conversationTurns` table
- `services/ai-router/src/db/index.ts` -- export `conversationTurns`

### Step 3: Add config entries

**What to do:**
- Add `OPENAI_API_KEY` (optional string, not required until Intent Classification task) to `services/ai-router/src/config.ts`.
- Do NOT add `SCHEDULER_URL` — scheduler connectivity is out of scope (deferred to End-to-End Pipeline Wiring task).
- Do NOT add `CONVERSATION_TURNS_RETENTION_DAYS` or `MAX_CONVERSATION_TURNS` — these are unused by the echo node and should be deferred to when they are actually needed.
- Update Docker Compose `ai-router` environment block with `OPENAI_API_KEY` (optional).
- Update test fixtures (`mockConfig` in existing tests) to include the new optional field.

**Files to modify:**
- `services/ai-router/src/config.ts`
- `docker-compose.yml` (ai-router section)
- Existing test files that reference mockConfig/baseEnv

### Step 4: Define the LangGraph conversation state schema

**What to do:**
- Create `services/ai-router/src/graph/state.ts` with Zod schemas and LangGraph state annotation.

**Conversation state fields:**

| Field | Type | Purpose |
|-------|------|---------|
| `userId` | `string` | Authenticated user ID from JWT |
| `correlationId` | `string` | Request correlation ID |
| `inboundEvent` | `InboundEvent` | The current inbound event being processed |
| `recentTurns` | `TurnSummary[]` | Loaded from `conversation_turns` (most recent N) |
| `activePendingCommand` | `PendingCommandRef \| null` | Reference to active pending command if one exists |
| `resolvedContact` | `ContactResolutionSummary \| null` | Resolved contact from Monica if applicable |
| `userPreferences` | `UserPreferences \| null` | User language, confirmation mode, timezone |
| `response` | `GraphResponse \| null` | The final output of the graph |

**Supporting Zod schemas:**

- `TurnSummarySchema`: `{ role: 'user' | 'assistant' | 'system', summary: string, createdAt: string, correlationId: string }`
- `PendingCommandRefSchema`: `{ pendingCommandId: string, version: number, status: string, commandType: string }`
- `GraphResponseSchema`: `{ type: 'text' | 'confirmation_prompt' | 'disambiguation_prompt' | 'error', text: string, pendingCommandId?: string, version?: number, options?: {label: string, value: string}[] }`

**Files to create:**
- `services/ai-router/src/graph/state.ts`

### Step 5: Build the placeholder graph with a single echo node

**What to do:**
- Create `services/ai-router/src/graph/graph.ts` with the `StateGraph` definition.
- The graph has a single node `"process"` that reads the inbound event and produces a simple acknowledgment response.
- The node does NOT call OpenAI yet -- returns a `GraphResponse` with `type: 'text'`.
- Export a factory function `createConversationGraph()` that returns the compiled graph.

**Graph topology (V1 skeleton):**

```
START -> process -> END
```

**Files to create:**
- `services/ai-router/src/graph/graph.ts`
- `services/ai-router/src/graph/index.ts` (barrel export)

### Step 6: Wire the graph into POST /internal/process with guardrails

**What to do:**
- Modify `services/ai-router/src/app.ts`:
  1. Restructure route mounting so `/internal/process` passes through BOTH auth AND guardrail middleware.
  2. In the handler, build the initial graph state from the inbound event + user context.
  3. Invoke the compiled graph.
  4. Return the graph's `response` field as the HTTP response.

**Key design decision -- guardrail integration:**

Currently, `/internal/process` is mounted on the `inbound` sub-app which is routed BEFORE the guardrail middleware. This needs restructuring so `/internal/process` goes through guardrails.

**Exact route-mounting order:**
1. `/health` — mounted first, no middleware (stays guardrail-free)
2. `app.use("/internal/*", guard)` — guardrail middleware for all internal routes
3. `/internal/process` — with route-level `serviceAuth` using `inboundAllowedCallers`, mounted AFTER guardrails so both auth AND guardrails apply
4. `/internal/resolve-contact` — existing contact-resolution routes (unchanged, already behind guardrails)

This preserves: (a) service auth on `/process` with the correct allowlist, (b) existing contact-resolution routes, (c) `/health` remaining guardrail-free. The `inbound` sub-app that currently mounts `/process` before guardrails will be removed and replaced with a direct route mount after the guard middleware.

**Files to modify:**
- `services/ai-router/src/app.ts` -- restructure route mounting, add graph invocation
- `services/ai-router/src/index.ts` -- pass config to createApp for graph creation

### Step 7: Tests (TDD sequence)

**New test files:**

1. `services/ai-router/src/db/__tests__/schema.test.ts` -- validates `conversationTurns` table columns
2. `services/ai-router/src/graph/__tests__/state.test.ts` -- validates Zod schemas
3. `services/ai-router/src/graph/__tests__/graph.test.ts` -- tests graph invocation returns valid response
4. `services/ai-router/src/__tests__/process-endpoint.test.ts` -- tests endpoint returns graph response, auth enforcement

**TDD Sequence:**
For each step, write the failing test FIRST, then implement to make it pass.

## Test Strategy

### Unit Tests (Vitest)

| Test | What to test | What to mock |
|------|-------------|--------------|
| State schema validation | Zod schemas accept valid data, reject invalid | Nothing |
| Graph invocation | Graph processes each event type, returns valid response | Nothing |
| Process endpoint | Auth enforcement, payload validation, graph invocation | Auth middleware, guardrails, graph |
| DB schema | Table structure matches expectations | Nothing |

## Smoke Test Strategy

### Docker Compose services to start
```bash
docker compose --profile app up -d postgres redis ai-router
```

### HTTP checks
1. Health check returns OK
2. POST /internal/process with valid JWT returns graph response (not `{ received: true }`)
3. POST /internal/process without auth returns 401
4. conversation_turns table exists in PostgreSQL

## Security Considerations

1. **OPENAI_API_KEY handling:** Must NOT appear in logs, traces, or error messages. Verify redaction patterns cover `sk-...` format.
2. **Service auth on /internal/process:** Preserves existing `serviceAuth` with caller allowlists.
3. **Guardrail enforcement:** Moving `/internal/process` behind guardrail middleware prevents budget exhaustion from compromised connectors.
4. **Graph state never persisted raw:** Only compressed summaries go to `conversation_turns`.
5. **No PII in graph response logs:** Log correlation ID and response type, not text content.

## Risks

1. **LangGraph version compatibility with Node 24:** Verify during implementation.
2. **@langchain/core version alignment:** langgraph and openai must share compatible core version.
3. **Guardrail middleware ordering:** Restructuring route mounts requires care to not break existing routes.
4. **Placeholder graph is temporary:** Next task (Intent Classification) replaces the echo node with real LLM calls.
5. **Exact package versions:** Must be verified on npmjs.com at implementation time.
