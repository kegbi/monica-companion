# Implementation Plan: Stage 3 — Contact Resolution via Tools

## Objective

Replace the standalone `resolve-contact-ref` graph node (797 lines), `narrowingContext`, `unresolvedContactRef`, and progressive narrowing logic with a single `search_contacts` tool handler that the LLM calls when it needs a `contactId`. Disambiguation becomes conversational: the LLM uses conversation history to present options and interpret user replies, eliminating complex graph state for narrowing rounds.

## Scope

### In Scope

- Implement the `search_contacts` tool handler that calls `monica-integration` and runs the deterministic matcher
- Thread a `ServiceClient` (for `monica-integration`) through the agent loop so the handler can fetch contact summaries
- Update the system prompt with explicit `search_contacts`-first instructions
- Replace the "not_implemented" stub for `search_contacts` in the agent loop with the real handler
- Add a Zod validation schema for `search_contacts` arguments
- Write tests following TDD (failing test first, then implementation)

### Out of Scope

- Implementing other tool handlers (read-only query tools, mutating tool execution) — that is Stage 4
- Removing the graph pipeline files (`graph/nodes/execute-action.ts`, `graph/graph.ts`, etc.) — that is Stage 6
- Removing the `narrowingContext`/`unresolvedContactRef` DB columns via migration — that is Stage 6
- Promptfoo eval updates — that is Stage 5
- Changes to `delivery`, `telegram-bridge`, `scheduler`, or any other service

## Affected Services & Packages

| Package/Service | Changes |
|-----------------|---------|
| `services/ai-router` | New tool handler file, modified agent loop, modified system prompt, modified tools.ts, new and updated tests |
| `packages/types` | No changes (ContactResolutionSummary, ContactMatchCandidate already exist) |
| `packages/auth` | No changes (ServiceClient already exists) |

## Implementation Steps

### Step 1: Add `SearchContactsArgsSchema` to `tools.ts`

**What:** Add a Zod schema for the `search_contacts` tool arguments, matching the pattern already used for mutating tools.

**Files to modify:**
- `services/ai-router/src/agent/tools.ts` — add `SearchContactsArgsSchema = z.object({ query: z.string().min(1) })`, add to a schemas map so the agent loop can validate search_contacts args before calling the handler.

**Files to modify (tests):**
- `services/ai-router/src/agent/__tests__/tools.test.ts` — add test for the new schema.

**TDD sequence:**
1. Write a failing test: `TOOL_ARG_SCHEMAS` has an entry for `search_contacts`, validates `{ query: "mom" }` successfully and rejects `{ query: "" }`.
2. Implement the schema in `tools.ts`.
3. Verify test passes.

---

### Step 2: Create the `search_contacts` tool handler

**What:** Create `services/ai-router/src/agent/tool-handlers/search-contacts.ts`. This module exports a function that:
1. Accepts `{ query: string }`, a `ServiceClient`, a `userId`, and a `correlationId`
2. Calls `fetchContactSummaries(serviceClient, userId, correlationId)` from `contact-resolution/client.ts`
3. Runs `matchContacts(query, summaries)` from `contact-resolution/matcher.ts`
4. Returns the top 10 results as `Array<{ contactId, displayName, aliases, relationshipLabels, birthdate }>` where `birthdate` is extracted from `importantDates`
5. If `fetchContactSummaries` throws, returns a structured error result so the LLM can tell the user

**Files to create:**
- `services/ai-router/src/agent/tool-handlers/search-contacts.ts`
- `services/ai-router/src/agent/tool-handlers/__tests__/search-contacts.test.ts`

**Key design decisions:**
- Returns plain JSON-serializable object as the `tool` result message content
- Returns `aliases` and `relationshipLabels` so LLM can present meaningful disambiguation text
- `birthdate` is a simple nullable string extracted from `importantDates`
- Limit to top 10 results since the LLM handles narrowing conversationally
- Error results are returned (not thrown) so the LLM can tell the user

**TDD sequence:**
1. Write failing tests: 3 summaries matched, 0 matches, service error, cap at 10, birthdate extraction
2. Implement the handler
3. Verify all tests pass

---

### Step 3: Thread `ServiceClient` through the agent loop

**What:** The agent loop needs access to a `ServiceClient` for calling `monica-integration`.

**Files to modify:**
- `services/ai-router/src/agent/loop.ts` — add `monicaServiceClient` to `AgentLoopDeps`
- `services/ai-router/src/app.ts` — create `monicaIntegrationServiceClient`, pass to `agentDeps`
- `services/ai-router/src/agent/__tests__/loop.test.ts` — update `createMockDeps` to include mock

**TDD sequence:**
1. Write failing test: `createMockDeps()` includes `monicaServiceClient`
2. Add to interface and wiring
3. Verify existing tests still pass

---

### Step 4: Wire the `search_contacts` handler into the agent loop

**What:** Replace the "not_implemented" stub for `search_contacts` with a call to the real handler.

**Files to modify:**
- `services/ai-router/src/agent/loop.ts` — in the read-only tool handling block, add special case for `search_contacts` that calls the handler. Other read-only tools still get the stub (Stage 4).

**Key design decisions:**
- Validate arguments with `SearchContactsArgsSchema` before calling handler
- On validation failure, return error tool result for LLM self-correction
- Serialize handler return as JSON string for tool message content
- Consider per-invocation cache for contact summaries (optional optimization)

**Files to modify (tests):**
- `services/ai-router/src/agent/__tests__/loop.test.ts` — update read-only tool call tests

**TDD sequence:**
1. Write failing test: `search_contacts({"query": "Mom"})` invokes handler via mocked service client
2. Implement wiring in `loop.ts`
3. Write failing test: invalid args produce validation error
4. Add validation logic
5. Verify all tests pass

---

### Step 5: Update the system prompt with contact resolution instructions

**What:** Add explicit contact resolution rules to the system prompt.

**Files to modify:**
- `services/ai-router/src/agent/system-prompt.ts`
- `services/ai-router/src/agent/__tests__/system-prompt.test.ts`

**Content to add:**
```
## Contact Resolution Rules

Before calling any tool that requires a `contactId` parameter, call `search_contacts` with the user's contact reference (name, nickname, relationship term like 'mom'). Follow these rules:

- If search returns exactly one result, use that contactId.
- If search returns multiple results, present them to the user and ask which one they meant.
- If search returns zero results, ask the user to clarify or offer to create a new contact.
- Never guess or fabricate a contactId. Always use search_contacts first.
```

**TDD sequence:**
1. Write failing tests for new content (`expect(prompt).toContain("Never guess")`, etc.)
2. Update the system prompt
3. Verify tests pass

---

### Step 6: Update `search_contacts` tool definition description

**What:** Refine the tool description in `tools.ts` to accurately describe the return shape.

**Files to modify:**
- `services/ai-router/src/agent/tools.ts`

---

### Step 7: Integration test for multi-turn contact disambiguation

**What:** Write integration tests with scripted mock LLM validating the full disambiguation flow.

**Files to create:**
- `services/ai-router/src/agent/__tests__/search-contacts-integration.test.ts`

**Test scenarios:**
1. Unambiguous resolution: 1 result → LLM proceeds to mutating tool
2. Ambiguous resolution: 3 results → LLM asks clarification → user clarifies → resolves
3. No match: 0 results → LLM asks user to clarify
4. Kinship term: "mom" returns matching relationship labels

---

## What Gets Removed (Stage 3 scope)

| File/Symbol | Lines | Reason |
|---|---|---|
| `ai-router/src/graph/nodes/resolve-contact-ref.ts` | ~797 | Replaced by `search_contacts` tool handler |
| `ai-router/src/graph/nodes/__tests__/resolve-contact-ref.test.ts` | ~1,408 | Tests for removed node |

**NOT removed yet** (deferred to Stage 6): `graph/state.ts`, `graph/graph.ts`, `graph/nodes/execute-action.ts`, narrowingContext/unresolvedContactRef columns.

## What Stays

| File | Reason |
|---|---|
| `ai-router/src/contact-resolution/matcher.ts` | Deterministic scoring + kinship map, reused by tool handler |
| `ai-router/src/contact-resolution/client.ts` | `fetchContactSummaries`, reused by tool handler |
| `ai-router/src/contact-resolution/resolver.ts` | Thresholds, exported constants |
| `ai-router/src/contact-resolution/routes.ts` | HTTP endpoint may still be used; deferred to Stage 6 |

## Test Strategy

### Unit Tests (Vitest)

| Test File | What to Test | What to Mock |
|---|---|---|
| `tool-handlers/__tests__/search-contacts.test.ts` | Handler shape, cap at 10, birthdate extraction, error handling | `ServiceClient.fetch` |
| `__tests__/tools.test.ts` | `SearchContactsArgsSchema` validation | Nothing |
| `__tests__/loop.test.ts` | `search_contacts` invokes handler, validation errors handled | `LlmClient`, `ServiceClient`, DB deps |
| `__tests__/system-prompt.test.ts` | Prompt includes contact resolution instructions | Nothing |

### Integration Tests

| Test File | What to Test |
|---|---|
| `__tests__/search-contacts-integration.test.ts` | Multi-turn disambiguation with scripted LLM |

## Security Considerations

1. **Service-to-service auth:** Handler calls `monica-integration` via existing `ServiceClient` with signed JWTs
2. **No credential leakage:** Returns only `contactId`, `displayName`, `aliases`, `relationshipLabels`, `birthdate`
3. **Input validation:** Zod schema validates tool arguments before handler execution
4. **Log redaction:** Handler logs outcome counts, not contact names or query text
5. **Timeout handling:** `fetchContactSummaries` already uses `AbortSignal.timeout(30_000)`
6. **No new public endpoints:** Handler is internal to the agent loop

## Smoke Test Strategy

```bash
docker compose --profile app up -d ai-router monica-integration postgres redis caddy
```

1. Health check: `GET /health` returns OK
2. Process endpoint: `POST /internal/process` with contact reference text, verify `GraphResponse` shape
3. Verify response contract unchanged for `telegram-bridge` and `delivery`

## Risks

1. **LLM may not always call `search_contacts` first** — mitigated by system prompt instructions and Stage 5 promptfoo evals
2. **Repeated full contact list fetches** — consider per-invocation cache, deferrable to Stage 4
3. **Graph pipeline test breakage** — acceptable since graph is dead code; handled by only removing `resolve-contact-ref.ts` in Stage 3
