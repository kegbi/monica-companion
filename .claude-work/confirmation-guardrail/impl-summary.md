# Implementation Summary: Stage 2 -- Confirmation Guardrail

## Files Changed
| File | Action | Description |
|------|--------|-------------|
| `services/ai-router/src/agent/pending-tool-call.ts` | created | PendingToolCallSchema (Zod) with pendingCommandId, name, arguments, toolCallId, actionDescription, createdAt, assistantMessage fields; isPendingToolCallExpired() utility |
| `services/ai-router/src/agent/tools.ts` | modified | Added 7 Zod arg schemas (TOOL_ARG_SCHEMAS map) for mutating tools; added generateActionDescription() for human-readable confirmation text |
| `services/ai-router/src/agent/system-prompt.ts` | modified | Added confirmation behavior section (interception, confirm/cancel/edit flows) and abandoned action instructions |
| `services/ai-router/src/agent/loop.ts` | modified | Major rewrite: mutating tool interception with Zod validation; confirm/cancel/edit callback handlers with identity verification; TTL enforcement; stale pending tool call handling for new messages; parseCallbackData utility |
| `services/ai-router/src/app.ts` | modified | Added pendingCommandTtlMinutes to agentDeps object passed to runAgentLoop |
| `services/ai-router/src/agent/__tests__/pending-tool-call.test.ts` | created | 12 tests for PendingToolCallSchema validation and isPendingToolCallExpired |
| `services/ai-router/src/agent/__tests__/tools.test.ts` | modified | Added 19 tests: TOOL_ARG_SCHEMAS coverage for all 7 mutating tools, generateActionDescription for all tool types plus fallback |
| `services/ai-router/src/agent/__tests__/system-prompt.test.ts` | modified | Added 2 tests: confirmation behavior instructions and abandoned action instructions |
| `services/ai-router/src/agent/__tests__/loop.test.ts` | modified | Added 15 tests: mutating tool interception (valid args, invalid args, mixed tools), confirm/cancel/edit callback handling, callback identity verification (mismatch, malformed data, unknown action), TTL enforcement (rejection, clearing), stale pending tool call handling (text, voice, history reconstruction) |

## Tests Added
| Test File | What It Tests |
|-----------|---------------|
| `services/ai-router/src/agent/__tests__/pending-tool-call.test.ts` | PendingToolCallSchema valid/invalid fields (8 tests), isPendingToolCallExpired fresh/stale/boundary/custom-TTL (4 tests) |
| `services/ai-router/src/agent/__tests__/tools.test.ts` | TOOL_ARG_SCHEMAS completeness and individual schema validation (11 tests), generateActionDescription for all 7 tools plus unknown fallback (8 tests) |
| `services/ai-router/src/agent/__tests__/system-prompt.test.ts` | Confirmation behavior and abandoned action instructions in system prompt (2 tests) |
| `services/ai-router/src/agent/__tests__/loop.test.ts` | Mutating tool interception: confirmation_prompt return, pendingToolCall persistence, invalid args error handling, mixed read-only/mutating (4 tests). Callback handling: confirm with stub execution, cancel with cancellation ack, edit with change prompt (3 tests). Identity verification: pendingCommandId mismatch, malformed data, unknown action (3 tests). TTL enforcement: expiry rejection, clearing on expiry (2 tests). Stale handling: text message clearing, voice message clearing, history reconstruction with abandoned tool result (3 tests) |

## Verification Results
- **Biome**: `pnpm biome check` -- 0 errors, all files formatted correctly
- **Tests**: 521 passed, 35 skipped, 1 failed (pre-existing integration test requiring running PostgreSQL -- same as Stage 1 baseline). 48 new tests added (12 + 19 + 2 + 15)

## Plan Review Findings Addressed

| Finding | Status | How Addressed |
|---------|--------|---------------|
| MEDIUM-1: pendingCommandId in schema | Addressed | Added `pendingCommandId` to PendingToolCallSchema, hardcoded `version: 1` as PENDING_COMMAND_VERSION, returned both in confirmation_prompt response |
| MEDIUM-2: Callback identity verification | Addressed | parseCallbackData() extracts pendingCommandId from `data` field, compared against stored pendingToolCall.pendingCommandId; mismatch returns stale rejection |
| MEDIUM-3: Stub execution on confirm | Addressed | Confirm handler appends stub tool result (`status: "success"`), not real execution. Explicit comment documents Stage 4 will wire real execution |
| MEDIUM-4: Callback edge case tests | Addressed | 3 tests: malformed data, pendingCommandId mismatch, unknown action |
| LOW-1: Inline crypto.randomUUID() | Addressed | Called inline at interception site, no separate generatePendingCommandId function |
| LOW-3: Multiple mutating tools handling | Addressed | First mutating tool intercepted; subsequent mutating tools get error tool results; read-only tool results appended normally |
| LOW-4: No smoke test step | Acknowledged | Per plan review, smoke-tester agent handles this separately |

## Plan Deviations

1. **AgentLoopDeps interface change**: Added `pendingCommandTtlMinutes: number` to the `AgentLoopDeps` interface. This was implicit in the plan (Step 8 mentioned updating for expanded deps) but making it a first-class field rather than passing through context is cleaner.

2. **parseCallbackData in loop.ts**: The plan did not explicitly specify where the callback data parsing logic would live. I implemented it as a private function in loop.ts to keep it co-located with the callback handler, matching the `decodeCallbackData` format from telegram-bridge.

3. **No separate process endpoint test updates needed**: The existing process endpoint tests continue to pass because the mock for `history-repository.js` already provides the correct interface, and the new `pendingCommandTtlMinutes` is set via the config object which already had this field.

## Residual Risks

1. **Tool call stubs**: All 11 tools still return stub results. Real tool execution comes in Stage 4.
2. **Read-only tool stubs**: Read-only tools return "not yet implemented" stubs. Contact resolution (search_contacts) will be implemented in Stage 3.
3. **LangChain dead code**: Old graph code under src/graph/ is retained but no longer called from app.ts. It will be removed in Stage 6.
4. **Smoke tests**: Not verified against a live Docker Compose stack. Should be run before marking roadmap item as complete per project rules.
5. **assistantMessage JSONB size**: Full assistant messages are stored in the pendingToolCall JSONB column. For typical tool calls this is approximately 1KB. Should be monitored for unusual growth.
6. **Multiple tool calls with read-only before mutating**: When the LLM emits read-only tools followed by a mutating tool, the read-only stub results are added to history but the mutating tool is intercepted. The LLM will see these stubs when processing the confirmation callback. This is correct behavior.
