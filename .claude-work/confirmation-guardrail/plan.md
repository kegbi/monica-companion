# Implementation Plan: Stage 2 — Confirmation Guardrail

## Objective

Replace the 6-status pending command state machine with a thin interception layer inside the agent loop. When the LLM emits a mutating tool call, the loop pauses, validates and serializes it into `pendingToolCall` on the conversation history row, and returns a `confirmation_prompt` to the user. On confirm, cancel, or edit callbacks, the loop resumes accordingly. Stale pending tool calls expire after 30 minutes.

## Scope

### In Scope

- Define `PendingToolCallSchema` (Zod) for the serialized pending tool call shape
- Define Zod argument validation schemas for all 7 mutating tools
- Modify the agent loop to intercept mutating tool calls: validate args, serialize on valid, return error on invalid
- Generate human-readable action descriptions from tool call params
- Implement confirm/cancel/edit callback handling in the agent loop
- Handle stale pending tool calls when a new text/voice message arrives
- Enforce 30-minute TTL on pending tool calls
- Update the system prompt for confirmation behavior and abandoned actions
- Update and add unit tests following TDD

### Out of Scope

- Actual tool execution (Stage 4 — stubs used for execution after confirm)
- Contact resolution via search_contacts tool (Stage 3)
- Removing old graph code (Stage 6)
- Read-only tool execution (Stage 4)

## Affected Files

| File | Action | Description |
|------|--------|-------------|
| `services/ai-router/src/agent/pending-tool-call.ts` | create | PendingToolCallSchema, isPendingToolCallExpired(), generatePendingCommandId() |
| `services/ai-router/src/agent/tools.ts` | modify | Add Zod arg schemas for 7 mutating tools, TOOL_ARG_SCHEMAS map, generateActionDescription() |
| `services/ai-router/src/agent/system-prompt.ts` | modify | Add confirmation behavior and abandoned action instructions |
| `services/ai-router/src/agent/loop.ts` | modify | Interception logic, confirm/cancel/edit callbacks, stale handling, TTL |
| `services/ai-router/src/app.ts` | modify | Pass pendingCommandTtlMinutes to AgentLoopDeps |
| `services/ai-router/src/agent/__tests__/pending-tool-call.test.ts` | create | Tests for schema, TTL, ID generation |
| `services/ai-router/src/agent/__tests__/tools.test.ts` | modify | Tests for arg schemas and action descriptions |
| `services/ai-router/src/agent/__tests__/system-prompt.test.ts` | modify | Tests for new prompt sections |
| `services/ai-router/src/agent/__tests__/loop.test.ts` | modify | Major expansion: interception, callbacks, TTL, stale handling |

## Implementation Steps

### Step 1: Define PendingToolCallSchema and utilities

Create `services/ai-router/src/agent/pending-tool-call.ts`:
- `PendingToolCallSchema` — Zod schema: `{ name: string, arguments: string (JSON), toolCallId: string, createdAt: string (ISO 8601), assistantMessage: object }`
- `isPendingToolCallExpired(pendingToolCall, ttlMinutes)` — checks createdAt + ttl
- `generatePendingCommandId()` — returns `crypto.randomUUID()`

### Step 2: Define Zod argument schemas for mutating tools

Modify `services/ai-router/src/agent/tools.ts`:
- Add `TOOL_ARG_SCHEMAS: Record<string, z.ZodType>` — one schema per mutating tool
- Schemas: CreateNoteArgsSchema, CreateContactArgsSchema, CreateActivityArgsSchema, UpdateContactBirthdayArgsSchema, UpdateContactPhoneArgsSchema, UpdateContactEmailArgsSchema, UpdateContactAddressArgsSchema
- Add `generateActionDescription(toolName, args): string` — human-readable summary

### Step 3: Update system prompt for confirmation behavior

Modify `services/ai-router/src/agent/system-prompt.ts`:
- Confirmation behavior: "mutating tools will be intercepted for user confirmation"
- Abandoned action handling: "if user sends new message while action pending, consider it abandoned"

### Step 4: Implement mutating tool interception in agent loop

Modify `services/ai-router/src/agent/loop.ts`:
- In the tool_calls processing block, separate read-only vs mutating
- Read-only: stub result (Stage 1 behavior)
- Mutating: validate args with Zod → if invalid, error tool result + continue loop → if valid, serialize to pendingToolCall, return confirmation_prompt
- Store assistantMessage in pendingToolCall for history reconstruction on confirm

### Step 5: Implement confirm/cancel/edit callback handler

Modify `services/ai-router/src/agent/loop.ts`:
- **Confirm**: deserialize pendingToolCall, reconstruct history (assistant msg + tool result), clear pendingToolCall, call LLM for success message
- **Cancel**: clear pendingToolCall, add cancelled tool result to history, call LLM for cancellation ack
- **Edit**: clear pendingToolCall, add cancelled tool result, LLM asks what to change

### Step 6: Implement TTL enforcement

In the callback handler: check pendingToolCall.createdAt, reject if >30min old.

### Step 7: Implement stale pending tool call handling

In agent loop main flow: if new text/voice arrives and pendingToolCall exists, clear it, add abandoned tool result to history, continue with new message.

### Step 8: Update process endpoint tests

Update mocks for expanded AgentLoopDeps (pendingCommandTtlMinutes).

## Test Strategy

### TDD Sequence

1. PendingToolCallSchema validation tests → implement schema
2. Tool arg schema tests → implement schemas
3. System prompt tests → update prompt
4. Interception tests → implement interception
5. Callback handler tests → implement handlers
6. TTL tests → implement TTL check
7. Stale handling tests → implement stale clearing

### Test Coverage (~30 new tests)

- pending-tool-call.test.ts: ~6 tests (schema valid/invalid, TTL fresh/stale, UUID)
- tools.test.ts: ~10 tests (7 schema validations, description generation)
- system-prompt.test.ts: ~2 tests
- loop.test.ts: ~15 tests (interception, confirm, cancel, edit, TTL expiry, stale clearing)

## Security Considerations

1. Zod validation on pendingToolCall JSONB (addresses Stage 1 review MEDIUM finding)
2. Tool argument validation before serialization
3. 30-minute TTL on pending tool calls
4. No sensitive data in action descriptions
5. Correlation ID propagation in all handlers
6. Service auth unchanged on /internal/process

## Risks

1. **Delivery wiring gap**: Agent loop returns GraphResponse but doesn't call delivery service. Confirmation prompts may not reach user until delivery wiring is added.
2. **Read-only tool stubs**: LLM can't actually resolve contacts yet (Stage 3/4).
3. **Multiple mutating tools in one response**: Only first is intercepted, rest get error.
4. **assistantMessage storage**: Full message stored in JSONB (~1KB typical, monitor).
5. **LLM behavior dependency**: Interception only activates when LLM emits tool_calls.
