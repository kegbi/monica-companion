# Implementation Plan: Stage 5 — Testing & Acceptance Parity

## Objective

Bring the new tool-calling agent architecture (Stages 1-4) to full testing parity with the acceptance criteria established in Phases 6-9. This covers three testing layers: (1) Vitest unit and integration tests verifying every agent component with mocked dependencies, (2) promptfoo LLM evals adapted from the old intent-classification provider to the new tool-calling output format, and (3) Docker Compose smoke tests confirming the unchanged `/internal/process` response contract.

## Scope

### In Scope

- Gap analysis and expansion of existing Vitest unit tests for tool handlers, confirmation guardrail, history repository, and agent loop
- New Vitest integration test for multi-turn disambiguation with context preservation (the "Artillery Park" scenario)
- New promptfoo provider wrapping the tool-calling agent's single-turn LLM call
- Adapted 210-case promptfoo dataset (102 write + 60 read + 33 clarification + 15 guardrails) with tool-call-based assertions replacing intent-classification assertions
- New promptfoo multi-turn and false-positive eval cases
- Updated `check-thresholds.ts` with contact-resolution precision threshold and env var fix
- Verification that existing smoke tests pass unchanged against the new agent loop
- Updated `vitest.bench.config.ts` to remove LangChain aliases

### Out of Scope

- Changes to the agent loop implementation itself (Stages 1-4 are complete)
- Changes to the `/internal/process` response contract or smoke test assertions
- Changes to `telegram-bridge`, `delivery`, `scheduler`, or other services
- Real-Monica smoke tests (these run outside normal CI in a separate workflow)
- Voice-specific latency benchmarks (measured separately in the staging environment)

## Affected Services & Packages

| Package/Service | Changes |
|-----------------|---------|
| `services/ai-router/src/agent/__tests__/` | Expand existing tests, add new integration test file |
| `services/ai-router/src/agent/tool-handlers/__tests__/` | Already comprehensive; verify gap coverage only |
| `services/ai-router/promptfoo/provider.ts` | Replace LangChain intent classifier with tool-calling LLM provider |
| `services/ai-router/promptfoo/datasets/*.yaml` | Update all 4 dataset files to use tool-call assertions |
| `services/ai-router/promptfoo/datasets/multi-turn.yaml` | Create new multi-turn eval dataset |
| `services/ai-router/promptfoo/check-thresholds.ts` | Update env var, add contact-resolution metric, update assertion parsing |
| `services/ai-router/promptfooconfig.yaml` | Add multi-turn dataset |
| `services/ai-router/vitest.bench.config.ts` | Remove `@langchain/*` aliases |
| `services/ai-router/vitest.config.ts` | Remove `@langchain/core/messages` alias |
| `tests/smoke/` | No changes; verify existing tests pass unchanged |

## Review Finding Tracking

Each review finding from `plan-review-1.md` is addressed with a specific reference below:

| Finding | Severity | Addressed In | Summary |
|---------|----------|-------------|---------|
| HIGH-1: Clarification context-injection unspecified | HIGH | Steps 5, 8 | `conversationHistory` var format defined; migration of `recentTurns`/`activePendingCommand` fully specified |
| HIGH-2: Assertion quality regression | HIGH | Steps 6, 7, 11 | Per-case `expectedTool` metadata; `search_contacts` argument assertions replace `contactRef`; gap acknowledged |
| MEDIUM-1: Clarification case count is 33 | MEDIUM | Step 8 | Count corrected to 33 (cl-001 to cl-033) |
| MEDIUM-2: Contact-resolution precision unspecified | MEDIUM | Step 11 | Named `contactResolution` score defined; concrete measurement spec provided |
| MEDIUM-3: TDD claim misleading for gap-filling | MEDIUM | Test Strategy | Acknowledged; deliberate wrong-expectation RED phase documented |
| LOW-1: `OPENAI_API_KEY` env var in check-thresholds | LOW | Step 11 | Explicit instruction to update to `LLM_API_KEY` |
| LOW-2: OpenRouter model risk | LOW | Risks | Concrete mitigation: `temperature: 0`, substring assertions, model documented |

## Implementation Steps

### Step 1: Audit Existing Test Coverage and Identify Gaps

**What to do:** Compare the roadmap's test requirements against existing test files.

**Existing coverage (already implemented in Stages 1-4):**

1. **Tool handler unit tests** — All 4 read-only handlers and mutating handlers have thorough test suites:
   - `tool-handlers/__tests__/search-contacts.test.ts` — 7 tests
   - `tool-handlers/__tests__/query-birthday.test.ts` — 6 tests
   - `tool-handlers/__tests__/query-phone.test.ts` — 6 tests
   - `tool-handlers/__tests__/query-last-note.test.ts` — 5 tests
   - `tool-handlers/__tests__/mutating-handlers.test.ts` — 13 tests

2. **Confirmation guardrail tests** — In `__tests__/loop.test.ts` (31 tests total): interception, Zod validation rejection, confirm/cancel/edit callbacks, stale TTL rejection, callback identity mismatch, malformed data, unknown action handling.

3. **History repository tests** — In `__tests__/history-repository.test.ts`: getHistory, saveHistory, upsert, truncation, clearHistory, clearStaleHistories.

4. **Agent loop tests** — In `__tests__/loop.test.ts`: text response, voice message, callbacks, history loading/saving, search_contacts/query_birthday dispatch, validation errors, 5-iteration cap, LLM errors, stale pending handling.

5. **Integration tests** — In `__tests__/search-contacts-integration.test.ts`: unambiguous/ambiguous/no-match/kinship/service error.

**Identified gaps:**

- G1: `query_phone` and `query_last_note` not tested at the loop level (dispatch + validation)
- G2: No multi-turn disambiguation integration test spanning multiple `runAgentLoop` invocations
- G3: History repository truncation test does not verify actual truncated array content
- G4: Promptfoo provider wraps old LangGraph `createIntentClassifier()` instead of tool-calling agent
- G5: All 210 promptfoo assertions check old intent-classification schema
- G6: No promptfoo multi-turn eval cases
- G7: No promptfoo false-positive eval cases for read-only queries
- G8: `vitest.bench.config.ts` still has `@langchain/openai` and `@langchain/core` aliases
- G9: `vitest.config.ts` still has `@langchain/core/messages` alias
- G10: `check-thresholds.ts` reads `OPENAI_API_KEY` instead of `LLM_API_KEY`
- G11: `check-thresholds.ts` lacks contact-resolution precision metric

---

### Step 2: Add Missing Agent Loop Dispatch Tests for query_phone and query_last_note

**Files to modify:** `services/ai-router/src/agent/__tests__/loop.test.ts`

Add 4 test cases following the same pattern as the existing `query_birthday` dispatch tests (lines 324-454):

1. "dispatches query_phone to the handler" — Mock LLM calls `query_phone({ contact_id: 42 })`, assert `mockedHandleQueryPhone` was called with `{ contactId: 42, serviceClient, userId, correlationId }`, assert handler result JSON is passed to the second LLM call.
2. "dispatches query_last_note to the handler" — Same pattern for `query_last_note`.
3. "returns validation error to LLM when query_phone args are invalid" — `query_phone({ contact_id: -1 })`, assert handler NOT called, assert second LLM call receives validation error in tool result.
4. "returns validation error to LLM when query_last_note args are invalid" — `query_last_note({})` (missing contact_id), assert handler NOT called.

**Expected outcome:** All 4 tests pass immediately against existing loop implementation (gap-filling, not new behavior).

---

### Step 3: Strengthen History Repository Truncation Test

**Files to modify:** `services/ai-router/src/agent/__tests__/history-repository.test.ts`

The existing truncation test (line 80-93) verifies `db.insert` was called but does not inspect the truncated message content. Add 3 tests:

1. "insert 50 messages, verify values call receives only the last 40" — Create 50 messages with identifiable content (`Message 0` through `Message 49`), capture the `values` call argument, verify it contains messages 10-49 (the last 40).
2. "insert exactly 40 messages, verify all 40 preserved" — Edge case: no truncation should occur.
3. "insert 1 message, verify it survives" — Edge case: single message preserved.

**Implementation note:** These tests require intercepting the argument passed to `db.insert().values()`. The existing mock captures `insertCall = db.insert.mock.calls[0]` but does not access the chained `.values()` argument. Update the mock to capture the value passed to `mockInsertValues`.

**Expected outcome:** Tests pass immediately against existing `saveHistory` implementation.

---

### Step 4: Multi-Turn Disambiguation Integration Test (Artillery Park Scenario)

**Files to create:** `services/ai-router/src/agent/__tests__/multi-turn-disambiguation.integration.test.ts`

**Scenario 1:** "Add a note to mum about Artillery Park" with disambiguation:
- **Turn 1:** User sends "Add a note to mum: today we went to Artillery Park" -> Mock LLM calls `search_contacts("mum")` -> Handler returns 8 results -> Mock LLM generates disambiguation text "I found 8 contacts matching mum. What's your mom's name?" -> `saveHistory` captures turn 1 history
- **Turn 2:** Replay saved history via `getHistory` mock. User says "Elena" -> Mock LLM calls `search_contacts("Elena")` -> Handler returns 1 result (contactId=682023) -> Mock LLM calls `create_note(contact_id=682023, body="Today we went to Artillery Park")` -> Confirmation gate intercepts
- **Turn 3:** Replay saved history via `getHistory` mock. User sends confirm callback -> `executeMutatingTool` called
- **Critical assertion:** The `create_note` tool call in turn 2 contains `body` including "Artillery Park". This is the exact regression that motivated the tool-calling migration.

**Scenario 2:** User cancels at confirmation step:
- Turn 1: Mutating request -> confirmation returned
- Turn 2: Cancel callback -> `executeMutatingTool` never called, history cleared

**Mock strategy:** After each `runAgentLoop` call, capture the arguments passed to `saveHistory`. Before the next call, configure `getHistory` to return those captured values. This simulates real DB persistence without requiring a database. Script LLM responses via `.mockResolvedValueOnce()` to control the exact tool calls and text responses.

**TDD note:** This is genuine TDD. The test orchestration (multi-turn state capture/replay) is non-trivial. The test will fail until the mock choreography correctly simulates the conversation flow. The RED phase is real.

---

### Step 5: Replace Promptfoo Provider with Tool-Calling Agent Provider

**Files to modify:** `services/ai-router/promptfoo/provider.ts`

Replace `createIntentClassifier()` wrapper with direct OpenAI SDK tool-calling:

```typescript
// New provider structure
import OpenAI from "openai";
import { buildAgentSystemPrompt } from "../src/agent/system-prompt.js";
import { TOOL_DEFINITIONS } from "../src/agent/tools.js";

const LLM_API_KEY = process.env.LLM_API_KEY ?? "";
const LLM_BASE_URL = process.env.LLM_BASE_URL ?? "https://openrouter.ai/api/v1";
const LLM_MODEL_ID = process.env.LLM_MODEL_ID ?? "qwen/qwen3-235b-a22b";

// Skip-guard
if (!LLM_API_KEY || LLM_API_KEY.startsWith("sk-fake")) {
  throw new Error("promptfoo provider requires LLM_API_KEY...");
}

const openai = new OpenAI({ baseURL: LLM_BASE_URL, apiKey: LLM_API_KEY });

export default class ToolCallingProvider {
  id() { return "tool-calling-agent"; }

  async callApi(
    prompt: string,
    context?: { vars?: Record<string, unknown> }
  ): Promise<{ output: string }> {
    const systemMessage = { role: "system" as const, content: buildAgentSystemPrompt() };
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [systemMessage];

    // HIGH-1 FIX: Inject conversationHistory between system and user message
    const rawHistory = context?.vars?.conversationHistory;
    if (typeof rawHistory === "string" && rawHistory.length > 0) {
      const historyMessages = JSON.parse(rawHistory) as OpenAI.Chat.ChatCompletionMessageParam[];
      messages.push(...historyMessages);
    }

    messages.push({ role: "user", content: prompt });

    const completion = await openai.chat.completions.create({
      model: LLM_MODEL_ID,
      messages,
      tools: TOOL_DEFINITIONS,
      temperature: 0, // LOW-2 FIX: maximize determinism
      timeout: 60_000,
    });

    const choice = completion.choices[0];
    const result = {
      text: choice?.message?.content ?? null,
      tool_calls: choice?.message?.tool_calls?.map(tc => ({
        function: { name: tc.function.name, arguments: tc.function.arguments },
      })) ?? [],
    };
    return { output: JSON.stringify(result) };
  }
}
```

**Context injection mechanism (HIGH-1 fix):**

The new provider accepts a `conversationHistory` var containing a JSON array of OpenAI-format messages (`{role, content}[]`). These messages are injected between the system message and the user utterance in the `messages` array. This is the exact mechanism the production agent loop uses (history loaded from DB inserted between system prompt and new user message).

For multi-turn eval cases and clarification cases that need prior context:
- Prior user messages become `{ role: "user", content: "..." }`
- Prior assistant responses become `{ role: "assistant", content: "..." }`
- Prior tool calls become `{ role: "assistant", content: null, tool_calls: [...] }` followed by `{ role: "tool", tool_call_id: "...", content: "..." }`

For `activePendingCommand` context (cases cl-031 to cl-033): The pending command is represented as a prior assistant message containing a tool call that was intercepted, followed by a tool result with `status: "awaiting_confirmation"`. This matches how the production loop represents a pending action in history context.

**Removed imports:** `@langchain/core/messages`, `createIntentClassifier`, `buildSystemPrompt`, `TurnSummary`, `PendingCommandRef`.

---

### Step 6: Adapt Write-Intent Dataset Assertions (HIGH-2 Fix)

**Files to modify:** `services/ai-router/promptfoo/datasets/write-intents.yaml`

Update all 102 case assertions from intent-classification format to tool-call format. Each case gets a per-case `expectedTool` metadata field to enable per-case command-type validation.

**Assertion strategy for write-intent cases:**

In single-turn tool-calling evaluation, the LLM typically calls `search_contacts` as its first tool call because it lacks a `contactId`. This is correct behavior per the system prompt ("always call search_contacts before any tool that needs a contactId"). The write-intent assertion therefore validates:

1. The output is valid JSON containing a `tool_calls` array
2. `search_contacts` is called with the expected contact reference in its `query` argument (replaces the old `contactRef` assertion -- HIGH-2 fix)
3. No out-of-scope behavior (at least one tool call was made)

**Per-case assertion template** (example for wi-001, `create_note`, contact ref "mom"):

```yaml
- description: "Add a note to a contact by relationship label"
  vars:
    utterance: "Add a note to Mom about her garden project"
  metadata:
    id: "wi-001"
    category: "write_intent"
    expectedTool: "create_note"
    expectedContactRef: "mom"
  assert:
    - type: is-json
    - type: javascript
      value: |
        const parsed = JSON.parse(output);
        const calls = parsed.tool_calls || [];
        calls.length > 0
    - type: javascript
      value: |
        const parsed = JSON.parse(output);
        const calls = parsed.tool_calls || [];
        const search = calls.find(c => c.function?.name === 'search_contacts');
        if (!search) return true;
        const args = JSON.parse(search.function.arguments || '{}');
        args.query && args.query.toLowerCase().includes('mom')
      metric: contactResolution
```

**Contact reference validation (HIGH-2 fix):** The `contactResolution` metric assertion checks that `search_contacts` was called with arguments containing the expected contact reference. This replaces the old `contactRef` field check. If the LLM happens to directly call a mutating tool without `search_contacts` (e.g., for `create_contact` where no search is needed), the assertion returns `true` (vacuously passes) since no search was required.

**Per-case commandType precision gap (HIGH-2 fix, acknowledged):** In single-turn evaluation, the LLM will almost always call `search_contacts` as its only tool call. The specific mutating tool name (`create_note`, `create_activity`, etc.) is not visible in single-turn output. This is by design -- the system prompt correctly tells the LLM to resolve contacts first. The `expectedTool` metadata field preserves the intended tool type for reference but is NOT asserted in single-turn cases. Command-type dispatch accuracy is validated by:
- Vitest unit tests (Steps 2-4): mock LLM tool call dispatch verified per tool type
- Multi-turn promptfoo cases (Step 10): full search-then-mutate flow validates the final tool name

**Tool type coverage for assertions:** All 7 mutating tool types use the same assertion pattern. The `expectedTool` metadata carries the tool name for traceability:
- `create_note` (27 cases)
- `create_contact` (15 cases)
- `create_activity` (20 cases)
- `update_contact_birthday` (10 cases)
- `update_contact_phone` (10 cases)
- `update_contact_email` (10 cases)
- `update_contact_address` (10 cases)

---

### Step 7: Adapt Read-Intent Dataset Assertions (HIGH-2 Fix)

**Files to modify:** `services/ai-router/promptfoo/datasets/read-intents.yaml`

Update all 60 case assertions. Key behavioral difference: for read intents, the LLM should either call `search_contacts` (to find the contact) or directly call a read-only tool. It must NEVER call a mutating tool.

**Per-case assertion template** (example for ri-001, `query_birthday`, contact ref "sarah"):

```yaml
- description: "Ask for a contact's birthday"
  vars:
    utterance: "What's Sarah's birthday?"
  metadata:
    id: "ri-001"
    category: "read_intent"
    expectedTool: "query_birthday"
    expectedContactRef: "sarah"
  assert:
    - type: is-json
    - type: javascript
      value: |
        const parsed = JSON.parse(output);
        const calls = parsed.tool_calls || [];
        const mutating = ['create_note','create_contact','create_activity',
          'update_contact_birthday','update_contact_phone',
          'update_contact_email','update_contact_address'];
        !calls.some(c => mutating.includes(c.function?.name))
      metric: isMutating
    - type: javascript
      value: |
        const parsed = JSON.parse(output);
        const calls = parsed.tool_calls || [];
        calls.length > 0
    - type: javascript
      value: |
        const parsed = JSON.parse(output);
        const calls = parsed.tool_calls || [];
        const search = calls.find(c => c.function?.name === 'search_contacts');
        if (!search) return true;
        const args = JSON.parse(search.function.arguments || '{}');
        args.query && args.query.toLowerCase().includes('sarah')
      metric: contactResolution
```

**Read tool specificity:** In single-turn evaluation, the LLM will typically call `search_contacts` first (because it needs a `contactId`). The specific read tool (`query_birthday`, `query_phone`, `query_last_note`) may or may not appear depending on whether the LLM chains tool calls in a single turn. The assertion does NOT require the specific read tool name in single-turn -- it verifies (a) no mutating tools, (b) at least one tool call, (c) correct contact reference in `search_contacts` args. Multi-turn eval cases (Step 10) verify the complete flow including specific read tool dispatch.

---

### Step 8: Adapt Clarification Dataset Assertions (MEDIUM-1 Fix, HIGH-1 Fix)

**Files to modify:** `services/ai-router/promptfoo/datasets/clarification.yaml`

Update all **33** assertions (cl-001 to cl-033, not 25 -- MEDIUM-1 fix). The clarification dataset has three groups requiring different handling:

**Group A: No-context cases (cl-001 to cl-005, cl-007 to cl-010, cl-011 to cl-025):**
These cases have no `recentTurns` or `activePendingCommand` vars. In the new provider, these test whether the LLM generates a text response (no tool calls) when given an ambiguous or clarification-style utterance without prior context.

```yaml
assert:
  - type: is-json
  - type: javascript
    value: |
      const parsed = JSON.parse(output);
      const calls = parsed.tool_calls || [];
      const mutating = ['create_note','create_contact','create_activity',
        'update_contact_birthday','update_contact_phone',
        'update_contact_email','update_contact_address'];
      !calls.some(c => mutating.includes(c.function?.name))
    metric: isMutating
```

Note: Without context, a standalone "Yes, that's right" or "Elena" will likely produce a text response or a `search_contacts` call. The assertion validates no false-positive mutations.

**Group B: Cases with `recentTurns` context (cl-006, cl-022, cl-023, cl-026 to cl-030):**
These 8 cases currently use `recentTurns` JSON. They must be migrated to the new `conversationHistory` var format (HIGH-1 fix).

Migration specification: Each `recentTurns` array entry `{ role, summary, createdAt, correlationId }` maps to an OpenAI message:
- `{ role: "user", summary: "..." }` becomes `{ role: "user", content: "..." }` where content is the summary text
- `{ role: "assistant", summary: "..." }` becomes `{ role: "assistant", content: "..." }` where content is the summary text

Example migration for cl-006:

```yaml
# OLD:
recentTurns: '[{"role":"user","summary":"User asked to add a note to Alex",...},{"role":"assistant","summary":"Which Alex? Alex Torres from work or Alex Kim from school?",...}]'

# NEW:
conversationHistory: '[{"role":"user","content":"Add a note to Alex"},{"role":"assistant","content":"Which Alex? Alex Torres from work or Alex Kim from school?"}]'
```

The assertion changes from `intent === 'clarification_response'` + `contactRef` to checking for `search_contacts` call with the expected reference or a text-only response. For cases with a contact reference expectation:

```yaml
assert:
  - type: is-json
  - type: javascript
    value: |
      const parsed = JSON.parse(output);
      const calls = parsed.tool_calls || [];
      if (calls.length === 0) return parsed.text != null;
      const search = calls.find(c => c.function?.name === 'search_contacts');
      if (!search) return false;
      const args = JSON.parse(search.function.arguments || '{}');
      args.query && args.query.toLowerCase().includes('elena')
    metric: contactResolution
  - type: javascript
    value: |
      const parsed = JSON.parse(output);
      const calls = parsed.tool_calls || [];
      const mutating = ['create_note','create_contact','create_activity',
        'update_contact_birthday','update_contact_phone',
        'update_contact_email','update_contact_address'];
      !calls.some(c => mutating.includes(c.function?.name))
    metric: isMutating
```

**Group C: Cases with `activePendingCommand` context (cl-031, cl-032, cl-033):**
These 3 cases currently use both `recentTurns` and `activePendingCommand`. The `activePendingCommand` represents a pending mutating tool call awaiting confirmation. In the new agent loop, this is stored as `pendingToolCall` in the conversation history row.

Migration specification (HIGH-1 fix): The `activePendingCommand` maps to:
1. An assistant message containing the tool call: `{ role: "assistant", content: null, tool_calls: [{ id: "pending-1", type: "function", function: { name: "create_note", arguments: "{...}" } }] }`
2. A tool result indicating the action is awaiting confirmation: `{ role: "tool", tool_call_id: "pending-1", content: "{\"status\":\"awaiting_confirmation\",\"message\":\"Waiting for user to confirm or disambiguate contact.\"}" }`

Example migration for cl-031:

```yaml
# OLD:
recentTurns: '[{"role":"user","summary":"User asked to add a note to mum: she called me today",...},{"role":"assistant","summary":"Found 8 contacts matching mum. Asked user to provide name."}]'
activePendingCommand: '{"pendingCommandId":"cmd-cl031","version":3,"status":"draft","commandType":"create_note"}'

# NEW:
conversationHistory: '[{"role":"user","content":"Add a note to mum: she called me today"},{"role":"assistant","content":"I found 8 contacts matching mum. What is your mom'\''s name?"},{"role":"assistant","content":null,"tool_calls":[{"id":"pending-1","type":"function","function":{"name":"search_contacts","arguments":"{\"query\":\"mum\"}"}}]},{"role":"tool","tool_call_id":"pending-1","content":"{\"status\":\"ok\",\"contacts\":[{\"contactId\":1,\"displayName\":\"Contact 1\"},{\"contactId\":2,\"displayName\":\"Contact 2\"}]}"}]'
```

---

### Step 9: Adapt Guardrails Dataset Assertions + Add False-Positive Cases

**Files to modify:** `services/ai-router/promptfoo/datasets/guardrails.yaml`

**Update 15 existing assertions (oos-001 to oos-010, gr-001 to gr-005):**

Replace `intent === 'out_of_scope'` / `intent === 'greeting'` checks with tool-call-based assertions:

```yaml
assert:
  - type: is-json
  - type: javascript
    value: |
      const parsed = JSON.parse(output);
      const calls = parsed.tool_calls || [];
      calls.length === 0
  - type: javascript
    value: |
      const parsed = JSON.parse(output);
      parsed.text != null && parsed.text.length > 0
  - type: javascript
    value: |
      const parsed = JSON.parse(output);
      const calls = parsed.tool_calls || [];
      const mutating = ['create_note','create_contact','create_activity',
        'update_contact_birthday','update_contact_phone',
        'update_contact_email','update_contact_address'];
      !calls.some(c => mutating.includes(c.function?.name))
    metric: isMutating
```

**Add 10 false-positive eval cases (fp-001 to fp-010):**

These are read-only queries that must NEVER trigger mutations. They supplement the existing out-of-scope cases by testing the boundary between "read intent about a contact" and "mutating action on a contact":

- fp-001: "When is Mom's birthday?" (read query, not birthday update)
- fp-002: "What's David's phone number?" (read query, not phone update)
- fp-003: "What was the last note I wrote about Sarah?" (read query, not note create)
- fp-004: "Tell me about my friend Alex" (vague read, not any mutation)
- fp-005: "Do I have a contact named Emma?" (search, not create)
- fp-006: "Who is my brother?" (relationship lookup, not mutation)
- fp-007: "Is Carlos's email still the old one?" (read, not email update)
- fp-008: "Did I already add a note about the meeting?" (read, not note create)
- fp-009: "What contacts do I have?" (list, not create)
- fp-010: "Remind me what Mom's address is" (read, not address update)

Each assertion:
```yaml
assert:
  - type: is-json
  - type: javascript
    value: |
      const parsed = JSON.parse(output);
      const calls = parsed.tool_calls || [];
      const mutating = ['create_note','create_contact','create_activity',
        'update_contact_birthday','update_contact_phone',
        'update_contact_email','update_contact_address'];
      !calls.some(c => mutating.includes(c.function?.name))
    metric: isMutating
```

Category: `guardrails` (same as existing cases, so `isMutating` aggregation includes them).

---

### Step 10: Add Promptfoo Multi-Turn Eval Cases

**Files to create:** `services/ai-router/promptfoo/datasets/multi-turn.yaml`
**Files to modify:** `services/ai-router/promptfooconfig.yaml`

Add 5 multi-turn cases using the `conversationHistory` var to inject prior conversation context:

**mt-001: Search-then-create-note (Artillery Park regression)**
```yaml
- description: "Disambiguation narrowing preserves note body across turns"
  vars:
    utterance: "Elena"
    conversationHistory: '[{"role":"user","content":"Add a note to mum: today we went to Artillery Park"},{"role":"assistant","content":null,"tool_calls":[{"id":"sc1","type":"function","function":{"name":"search_contacts","arguments":"{\"query\":\"mum\"}"}}]},{"role":"tool","tool_call_id":"sc1","content":"{\"status\":\"ok\",\"contacts\":[{\"contactId\":1,\"displayName\":\"Elena Y\"},{\"contactId\":2,\"displayName\":\"Marya K\"}]}"},{"role":"assistant","content":"I found 2 contacts matching mum: Elena Y and Marya K. Which one?"}]'
  metadata:
    id: "mt-001"
    category: "multi_turn"
    expectedTool: "create_note"
  assert:
    - type: is-json
    - type: javascript
      value: |
        const parsed = JSON.parse(output);
        const calls = parsed.tool_calls || [];
        const search = calls.find(c => c.function?.name === 'search_contacts');
        if (search) {
          const args = JSON.parse(search.function.arguments || '{}');
          return args.query && args.query.toLowerCase().includes('elena');
        }
        const note = calls.find(c => c.function?.name === 'create_note');
        if (note) {
          const args = JSON.parse(note.function.arguments || '{}');
          return args.body && args.body.toLowerCase().includes('artillery park');
        }
        return false
      metric: contactResolution
```

**mt-002: Read query after search**
Prior conversation: user searched for "Sarah", got 1 result. Now asking "What's her birthday?"

**mt-003: Follow-up pronoun resolution**
Prior conversation: user asked about "David Chen". Now: "Also update his phone to 555-1234"

**mt-004: Disambiguation with kinship narrowing**
Prior conversation: user asked "Add note to dad", got 6 results, assistant asked for name. Now: "David"

**mt-005: Context switch after prior action**
Prior conversation: user created a note for Elena (confirmed). Now: "Now add an activity that we had lunch together"

**promptfooconfig.yaml update:**
```yaml
tests:
  - file://promptfoo/datasets/write-intents.yaml
  - file://promptfoo/datasets/read-intents.yaml
  - file://promptfoo/datasets/clarification.yaml
  - file://promptfoo/datasets/guardrails.yaml
  - file://promptfoo/datasets/multi-turn.yaml
```

---

### Step 11: Update check-thresholds.ts (LOW-1 Fix, MEDIUM-2 Fix)

**Files to modify:** `services/ai-router/promptfoo/check-thresholds.ts`

**Change 1 (LOW-1 fix):** Update the API key skip-guard from `OPENAI_API_KEY` to `LLM_API_KEY`:
```typescript
const LLM_API_KEY = process.env.LLM_API_KEY ?? "";
if (!LLM_API_KEY || LLM_API_KEY.startsWith("sk-fake")) {
  console.log("Skipping promptfoo eval (no real API key)");
  process.exit(0);
}
```

**Change 2 (MEDIUM-2 fix): Add contact-resolution precision metric:**

Define which dataset cases contribute: all write-intent (102) and read-intent (60) cases that have a `contactResolution` named score assertion. The clarification cases with `contactResolution` scores also contribute.

Measurement spec: Each case with a `contactResolution` metric assertion produces a named score of `1` (pass) or `0` (fail) based on whether `search_contacts` was called with the correct contact reference in its arguments. The threshold check aggregates these:

```typescript
const CONTACT_RESOLUTION_THRESHOLD = 0.95;

// After existing metric computation:
const contactResolutionResults = results.filter(r => r.namedScores?.contactResolution !== undefined);
const crPassed = contactResolutionResults.filter(r => (r.namedScores?.contactResolution ?? 0) > 0).length;
const crAccuracy = contactResolutionResults.length > 0
  ? crPassed / contactResolutionResults.length
  : 0;

// Add to report:
console.log(`  Contact resolution: ${(crAccuracy * 100).toFixed(1)}% (threshold: >= ${(CONTACT_RESOLUTION_THRESHOLD * 100).toFixed(0)}%) ${crAccuracy >= CONTACT_RESOLUTION_THRESHOLD ? "PASS" : "FAIL"}`);

// Add to allPass:
const allPass =
  readAccuracy >= READ_ACCURACY_THRESHOLD &&
  writeAccuracy >= WRITE_ACCURACY_THRESHOLD &&
  fpMutationRate < FALSE_POSITIVE_MUTATION_THRESHOLD &&
  crAccuracy >= CONTACT_RESOLUTION_THRESHOLD;
```

**Change 3:** Add `multi_turn` category to the report output. The multi-turn cases appear under their own category in the per-category breakdown but do not have a separate threshold (they contribute to the overall success rate).

**Change 4:** Update the `isMutating` metric computation to work with the new assertion format. The existing logic checks `namedScores.isMutating === 0` (fail). In the new format, the `isMutating` metric assertion returns `true` when no mutating tools were called (pass = score 1). The false-positive count is cases where `isMutating` score is 0 (the assertion failed, meaning a mutating tool WAS called). This logic is unchanged; verify it works with the new assertion output.

**Change 5:** Update total expected case count in comments: ~225 (102 write + 60 read + 33 clarification + 25 guardrails + 5 multi-turn).

---

### Step 12: Update vitest.bench.config.ts and vitest.config.ts

**Files to modify:**
- `services/ai-router/vitest.bench.config.ts` — Remove `@langchain/openai` and `@langchain/core` aliases
- `services/ai-router/vitest.config.ts` — Remove `@langchain/core/messages` alias

**Verification before removal:**
1. Check `package.json` — `@langchain/core`, `@langchain/langgraph`, and `@langchain/openai` are still in `dependencies` (will be removed in Stage 6). The aliases are used by vitest to resolve these packages in test environments.
2. The benchmark tests (`src/benchmark/__tests__/`) may still import from the old graph code that uses LangChain. If any benchmark test file imports `@langchain/*` transitively, the alias removal will break it.
3. Before removing: `grep -r "@langchain" src/benchmark/` to verify no transitive imports remain.
4. The main `vitest.config.ts` has `"@langchain/core/messages"` because the old `provider.ts` and old graph code imports it. After Step 5 rewrites `provider.ts`, verify no remaining test file under the main test config needs this alias.

**Safe approach:** Remove the aliases, run `pnpm --filter @monica-companion/ai-router test` and `pnpm --filter @monica-companion/ai-router bench`. If any test fails with a module resolution error, the transitive dependency exists and the alias must stay until Stage 6 removes the LangChain code entirely.

---

### Step 13: Verify Smoke Tests Pass Unchanged

Run existing Docker Compose smoke tests. No modifications needed -- `/internal/process` returns the same `GraphResponse` shape (`type: "text" | "confirmation_prompt" | "disambiguation_prompt" | "error"`, `text`, optional `pendingCommandId`/`version`/`options`).

Steps:
1. `docker compose --profile app up -d ai-router postgres redis caddy`
2. Run the existing smoke test HTTP assertions against `/internal/process`
3. Verify all pass with the new agent loop
4. `docker compose --profile app down`

---

### Step 14: Run Full Acceptance Parity Check

1. `pnpm --filter @monica-companion/ai-router test` — All Vitest tests pass (including new gap-filling tests from Steps 2-4)
2. `pnpm --filter @monica-companion/ai-router bench` — Runs contact-resolution Vitest benchmarks + promptfoo eval with thresholds:
   - Read accuracy >= 92%
   - Write accuracy >= 90%
   - Contact-resolution precision >= 95%
   - False-positive mutation rate < 1%
3. Docker Compose smoke tests pass (Step 13)
4. Compare results against Phase 9 baselines

## Test Strategy

### Unit Tests (Vitest): What to Test, What to Mock

| Component | Tests | Mocks |
|-----------|-------|-------|
| Tool handlers (search, birthday, phone, last-note) | Correct endpoint called, correct payload, error handling | `ServiceClient.fetch` |
| Mutating handlers | Correct `SchedulerClient.execute` call per tool type | `SchedulerClient.execute`, `ServiceClient.fetch` |
| Confirmation guardrail | Interception, Zod rejection, confirm/cancel/edit callbacks, TTL, identity mismatch | `LlmClient.chatCompletion`, `getHistory`, `saveHistory` |
| History repository | Sliding window truncation content, clear, stale cleanup | Drizzle DB operations |
| Agent loop | Single-turn dispatch per tool, multi-turn flow, loop cap, error handling | `LlmClient.chatCompletion`, all handlers, `getHistory`, `saveHistory` |

### Integration Tests (Vitest)

| Test | What Needs Real Infra |
|------|----------------------|
| Multi-turn disambiguation (Artillery Park) | None -- all mocked. State capture/replay simulates DB. |
| Contact-resolution quality gate (`benchmark/`) | None -- deterministic matcher with synthetic fixtures |

### TDD Sequence (MEDIUM-3 Fix)

**Steps 2-3 (gap-filling tests):** These are coverage additions for already-working code. The implementation already passes. To satisfy the "failing test observed first" requirement:
1. Write the test with a deliberately incorrect expected value (e.g., assert `query_phone` dispatches to `handleQueryBirthday` instead of `handleQueryPhone`).
2. Run the test and observe the RED failure.
3. Correct the expectation to the real value.
4. Run and observe GREEN.

This validates that the test actually exercises the code path and catches regressions. It is not strict TDD (no new implementation code is written), but it proves the test has discriminatory power.

**Step 4 (multi-turn integration test):** Genuine TDD. The mock choreography (capturing `saveHistory` output, replaying via `getHistory`, scripting multi-turn LLM responses) is non-trivial. The test will fail before the scripted responses are correctly tuned. The RED phase is real.

**Steps 5-10 (promptfoo migration):** Not TDD. Provider and assertion migration is run incrementally via `npx promptfoo eval --no-cache`. Failures guide assertion tuning.

### Security Considerations

- No sensitive data in eval outputs -- synthetic data only in all dataset YAML files
- API key read from `LLM_API_KEY` environment variable only, with `sk-fake` skip-guard in CI
- No credentials in test fixtures or dataset vars
- `conversationHistory` vars contain only synthetic conversation context
- Redaction compliance unchanged -- no new logging of user data
- Provider sets `temperature: 0` for determinism; no additional data exposure

## Smoke Test Strategy

- **Docker Compose services to start:** `ai-router`, `postgres`, `redis`, `caddy`
- **HTTP checks to run:**
  - `POST /internal/process` with a text_message event -> expect `GraphResponse` with `type: "text"` and non-empty `text`
  - `POST /internal/process` with a write-intent message -> expect `type: "confirmation_prompt"` or `type: "text"` (depending on LLM behavior)
  - `GET /health` on the internal network -> expect 200
- **What the smoke test proves:** The new agent loop responds correctly through the real network path (Caddy reverse proxy -> ai-router -> LLM -> response). The `/internal/process` response contract is unchanged from Phases 6-9.

## Risks & Open Questions

1. **LLM non-determinism:** Tool-calling output varies between runs. **Mitigation:** Provider sets `temperature: 0`. Assertions use substring matching (`includes()`) rather than exact equality. Accept ~5% variance in pass rates between runs.

2. **OpenRouter model behavior (LOW-2 fix):** The eval runs against `qwen/qwen3-235b-a22b` via OpenRouter, not OpenAI's native API. Tool-calling format and argument serialization may differ subtly. **Mitigation:** (a) `temperature: 0` for determinism, (b) assertions parse `function.arguments` as JSON and check content via substring/includes rather than exact string match, (c) if Qwen3 tool-calling proves unreliable, the provider env vars allow switching to any OpenAI-compatible model without code changes.

3. **`vitest.bench.config.ts` LangChain alias removal may break if transitive deps exist.** The old graph code and benchmark code may still import LangChain transitively. **Mitigation:** grep for transitive imports before removing. If found, defer alias removal to Stage 6.

4. **Multi-turn integration test mock complexity.** State capture/replay across 3 turns requires careful orchestration of `saveHistory` captures and `getHistory` replays. **Mitigation:** Start with the simplest 2-turn test, then extend to 3 turns.

5. **Clarification case behavior change.** Without context, standalone utterances like "Yes, that's right" (cl-011) may be interpreted differently by the tool-calling agent vs. the intent classifier. The old system had a `clarification_response` intent category; the new system treats these as regular user messages. **Mitigation:** Relax assertions for no-context clarification cases to only check for no false-positive mutations, not for specific intent labels.

6. **Contact resolution precision measurement with `search_contacts` args.** If the LLM reformulates the contact reference (e.g., "Mom" -> "mother" in the search query), the substring assertion may fail. **Mitigation:** Use flexible matching patterns (e.g., `includes('mom') || includes('mother')`) for known kinship terms. Accept a small number of false negatives in the metric.

## File Summary

| File | Action | Step |
|---|---|---|
| `services/ai-router/src/agent/__tests__/loop.test.ts` | Expand: +4 tests (query_phone, query_last_note dispatch) | 2 |
| `services/ai-router/src/agent/__tests__/history-repository.test.ts` | Expand: +3 tests (truncation content verification) | 3 |
| `services/ai-router/src/agent/__tests__/multi-turn-disambiguation.integration.test.ts` | Create: 2 scenarios (Artillery Park, cancel) | 4 |
| `services/ai-router/promptfoo/provider.ts` | Rewrite: replace LangChain with OpenAI SDK tool-calling | 5 |
| `services/ai-router/promptfoo/datasets/write-intents.yaml` | Update 102 assertions: tool-call format + contactResolution metric | 6 |
| `services/ai-router/promptfoo/datasets/read-intents.yaml` | Update 60 assertions: tool-call format + isMutating + contactResolution | 7 |
| `services/ai-router/promptfoo/datasets/clarification.yaml` | Update 33 assertions: migrate recentTurns/activePendingCommand to conversationHistory | 8 |
| `services/ai-router/promptfoo/datasets/guardrails.yaml` | Update 15 assertions + add 10 false-positive cases | 9 |
| `services/ai-router/promptfoo/datasets/multi-turn.yaml` | Create: 5 multi-turn eval cases | 10 |
| `services/ai-router/promptfooconfig.yaml` | Add multi-turn dataset | 10 |
| `services/ai-router/promptfoo/check-thresholds.ts` | Update env var, add contactResolution threshold, add multi_turn category | 11 |
| `services/ai-router/vitest.bench.config.ts` | Remove @langchain aliases (if safe) | 12 |
| `services/ai-router/vitest.config.ts` | Remove @langchain/core/messages alias (if safe) | 12 |
