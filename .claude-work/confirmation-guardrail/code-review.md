---
verdict: APPROVED
attempt: 1
biome_pass: true
tests_pass: true
test_summary: "521 passed, 35 skipped, 1 failed (pre-existing integration test requiring PostgreSQL)"
critical_count: 0
high_count: 0
medium_count: 1
---

# Code Review: Stage 2 -- Confirmation Guardrail

## Automated Checks
- **Biome**: pass, zero errors
- **Tests**: 521 passed, 35 skipped, 1 failed (pre-existing `repository.integration.test.ts` requiring a running PostgreSQL instance -- not related to this change). 48 new tests added across 4 test files.

## Findings

### CRITICAL
(none)

### HIGH
(none)

### MEDIUM

1. [MEDIUM] `services/ai-router/src/agent/loop.ts:497` -- The `assistantMessage` is cast with `as unknown as Record<string, unknown>` to satisfy `PendingToolCallSchema`. When it is later loaded back from JSONB and cast with `as ChatCompletionMessageParam` (lines 187, 233, 278, 339), there is no runtime validation that the deserialized JSONB actually conforms to the OpenAI message shape. While the `PendingToolCallSchema` validates the surrounding fields, the `assistantMessage` field is only validated as `z.record(z.string(), z.unknown())`, which accepts any JSON object. If the DB row were corrupted or tampered with, the code would silently pass a malformed message to the OpenAI API. -- **Fix:** Consider adding a narrower Zod schema for the assistantMessage field (at minimum validating `role`, `tool_calls` array presence) in a follow-up. This is acceptable for Stage 2 since the data round-trips within the same service and the JSONB column is not externally writable, but should be tightened before production.

### LOW

1. [LOW] `services/ai-router/src/agent/loop.ts:148-167` -- The `existingMessages` extraction (`Array.isArray(history.messages) ? ... : []`) is repeated four times across `handleCallback`, `handleConfirm`, `handleCancel`, and `handleEdit`. Lines 102-104, 137-139, 148-150 all do the same extraction. -- **Fix:** Extract into a small helper function like `extractMessages(history)` to reduce duplication.

2. [LOW] `services/ai-router/src/agent/loop.ts:181-184,228-231,273-276` -- The system prompt is rebuilt via `buildAgentSystemPrompt()` independently in `handleConfirm`, `handleCancel`, and `handleEdit`. These three handlers all construct it the same way. -- **Fix:** Build the system message once in `handleCallback` and pass it to the sub-handlers.

3. [LOW] `services/ai-router/src/agent/__tests__/pending-tool-call.test.ts:84,90` -- Tests use `as any` casts for the `pendingToolCall` parameter to `isPendingToolCallExpired`. Since the function accepts `Pick<PendingToolCall, "createdAt">`, the test objects `{ createdAt }` already satisfy that type. -- **Fix:** Remove the `as any` casts; the objects conform to the `Pick` type naturally.

4. [LOW] `services/ai-router/src/agent/loop.ts:72` -- `parseCallbackData` extracts the version number but never validates it against `PENDING_COMMAND_VERSION`. The version field is parsed and returned but only the `pendingCommandId` is checked against the stored value (line 116). -- **Fix:** Add a version check in a future stage when version > 1 becomes possible. Document this as a known gap for now.

## Plan Compliance

The implementation follows the approved plan closely. All 9 files from the plan are accounted for (7 modified/created as specified, with `pending-tool-call.test.ts` as the additional new test file). The plan review's 4 MEDIUM findings and relevant LOW findings were addressed:

- **MEDIUM-1** (pendingCommandId in schema): Addressed -- `pendingCommandId` added to `PendingToolCallSchema`, `PENDING_COMMAND_VERSION` hardcoded, both returned in `confirmation_prompt` response.
- **MEDIUM-2** (Callback identity verification): Addressed -- `parseCallbackData()` extracts and verifies `pendingCommandId` against stored value; mismatch returns rejection.
- **MEDIUM-3** (Stub execution on confirm): Addressed -- Confirm handler appends stub `{ status: "success" }` tool result with explicit comment documenting Stage 4 will wire real execution.
- **MEDIUM-4** (Callback edge case tests): Addressed -- 3 tests added for malformed data, pendingCommandId mismatch, and unknown action.
- **LOW-1** (Inline crypto.randomUUID): Addressed -- called inline at interception site.
- **LOW-3** (Multiple mutating tools): Addressed -- first mutating tool intercepted, subsequent ones get error results.
- **LOW-4** (No smoke test): Acknowledged as handled by separate smoke-tester agent.

Plan deviations are minor and justified:
1. `pendingCommandTtlMinutes` as a first-class field on `AgentLoopDeps` (cleaner than passing through context)
2. `parseCallbackData` co-located in `loop.ts` (logical placement)
3. No process endpoint test updates needed (existing mocks already compatible)

## Unintended Removals Check

- **`.env.example`**: No changes (empty diff). The `PENDING_COMMAND_TTL_MINUTES` variable was already present from Stage 1.
- **`docker-compose.yml`**: Not modified.
- **`pnpm-workspace.yaml`**: Not modified.
- **Barrel exports**: Not modified.
- **Existing test descriptions**: One test renamed from "handles tool calls by providing stub results..." to "handles read-only tool calls by providing stub results..." -- this is a clarifying rename, not a removal.
- No deletions of previously existing code beyond the test description rename.

## Verdict Rationale

APPROVED. All automated checks pass (Biome zero errors, all non-pre-existing tests pass). No CRITICAL or HIGH findings. The single MEDIUM finding about `assistantMessage` JSONB validation is a defense-in-depth concern that is mitigated by the fact that the data round-trips within the same service and the JSONB column is not externally writable. The implementation is well-structured with 48 new tests covering interception, callbacks, identity verification, TTL enforcement, and stale handling. All plan review findings were addressed. Service boundaries are clean with no Telegram or Monica type leakage.
