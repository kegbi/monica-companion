---
verdict: APPROVED
attempt: 1
biome_pass: true
tests_pass: true
test_summary: "ai-router: 39 passed, 1 failed (pre-existing integration test, no Postgres), 1 skipped; 473 individual tests passed, 35 skipped. telegram-bridge: 21 passed, 98 individual tests passed."
critical_count: 0
high_count: 0
medium_count: 3
---

# Code Review: Stage 1 -- Agent Loop Foundation

## Automated Checks
- **Biome**: pass -- 0 errors across all changed files in services/ai-router/src/ and services/telegram-bridge/src/
- **Tests (ai-router)**: 39 files passed, 1 failed (pre-existing repository.integration.test.ts -- requires running PostgreSQL, not related to this change), 1 skipped. 473 individual tests passed, 35 skipped.
- **Tests (telegram-bridge)**: 21 files passed, 98 individual tests passed.

## Findings

### CRITICAL
(none)

### HIGH
(none)

### MEDIUM

1. [MEDIUM] `.env.example:33-34` -- Unplanned modification of SETUP_BASE_URL and EXPECTED_ORIGIN from `http://localhost` to `http://127.0.0.1`. The plan says to add LLM vars and keep OPENAI_API_KEY -- the diff should be additive only for .env.example. While 127.0.0.1 may work identically for most setups, localhost can resolve to both IPv4 and IPv6 while 127.0.0.1 is IPv4-only, and this was not authorized by the plan. -- **Fix:** Revert SETUP_BASE_URL and EXPECTED_ORIGIN back to `http://localhost` to keep the change additive-only as specified.

2. [MEDIUM] `services/ai-router/src/agent/loop.ts:82-84` -- The messages field from the JSONB column is cast with a bare `as ChatCompletionMessageParam[]` without runtime validation. Corrupted or tampered JSON in the DB could cause silent type errors or unexpected LLM SDK behavior. Per reliability.md, Zod validation should be applied on inbound contracts. -- **Fix:** Add a lightweight Zod array schema (e.g., `z.array(z.object({ role: z.string() }).passthrough())`) to validate the shape of loaded messages, or at minimum an `Array.isArray()` guard with a fallback to empty array.

3. [MEDIUM] `services/ai-router/src/agent/loop.ts:87-89` -- The system prompt is rebuilt on every invocation of runAgentLoop, calling `new Date().toISOString()` each time. This is functionally correct but inefficient for high-throughput scenarios. More importantly, if the agent loop runs across midnight, the date in the system prompt could differ between iterations within the same user request. -- **Fix:** Hoist the `buildAgentSystemPrompt()` call outside the while-loop (already the case) but consider caching per-day or accepting the current per-call behavior as acceptable for Stage 1.

### LOW

1. [LOW] `services/ai-router/src/agent/history-repository.ts:68` -- `(result as unknown as { count: number }).count` is a fragile double cast. Drizzle pg-core driver may return different shapes depending on the adapter. If the underlying driver changes, this will silently return undefined. The same pattern exists in the existing codebase (cleanup.ts, user-purge.ts) so this is pre-existing. -- **Fix:** Consider creating a shared helper like `extractDeleteCount(result: unknown): number` to centralize this cast.

2. [LOW] `services/ai-router/src/agent/loop.ts:127` -- `messages.push(assistantMessage as ChatCompletionMessageParam)` -- the `as` cast is needed because the OpenAI SDK ChatCompletionMessage type is slightly different from ChatCompletionMessageParam. This is a known SDK ergonomic issue. -- **Fix:** Add a brief comment explaining why the cast is needed.

3. [LOW] `services/ai-router/src/agent/loop.ts:64-78` -- The callback_action handler loads history to check for pendingToolCall but then returns the same no-pending-action message regardless of whether pendingToolCall exists. This is documented as Stage 2 work. -- **Fix:** This is explicitly deferred to Stage 2 per the plan. No action needed now.

4. [LOW] `services/ai-router/drizzle/meta/_journal.json` -- There is no corresponding Drizzle snapshot JSON file for migration 0003. The implementation summary acknowledges this. -- **Fix:** Generate the proper snapshot file by running `drizzle-kit generate` against a real database before applying the migration in production.

5. [LOW] `services/telegram-bridge/src/lib/ai-router-client.ts:45` -- The correlationId for clearHistory is generated as a timestamp-based string rather than a UUID, which is the format used elsewhere. -- **Fix:** Consider using a UUID generator or accepting this as adequate for a simple clear operation.

## Plan Compliance

The implementation closely follows the approved plan (Revision 2). All 13 implementation steps (Steps 1-13) were completed as specified. Key observations:

1. **Step 14 (Smoke Tests)**: Deferred -- acknowledged in the implementation summary. Per project rules, the roadmap item cannot be marked complete until smoke tests pass against a live Docker Compose stack.

2. **Unplanned change in .env.example**: The SETUP_BASE_URL and EXPECTED_ORIGIN values were changed from localhost to 127.0.0.1. This was not part of the plan and constitutes a non-additive modification to a shared config file. Flagged as MEDIUM.

3. **Additional vitest aliases**: The ioredis and openai aliases added to vitest.config.ts were not in the plan but were necessary to fix test resolution. These are justified deviations.

4. **Contact resolution routes test updates**: Additional mocks were needed due to app.ts changes. This is a reasonable consequence of the planned modifications.

5. **LangChain coexistence**: Correctly maintained -- @langchain/* deps remain in package.json and the vitest alias for @langchain/core/messages is preserved.

6. **Response contract stability**: The /internal/process endpoint continues returning GraphResponse shape (type: "text" or "error", text). This satisfies the critical constraint.

7. **Security**: The POST /internal/clear-history endpoint correctly uses serviceAuth with allowedCallers: ["telegram-bridge"]. The LLM_API_KEY is not logged anywhere -- it flows into the OpenAI SDK constructor but never appears in log statements. The system prompt includes injection defenses.

8. **Service boundaries**: No Telegram types leak into ai-router. The clear.ts handler in telegram-bridge correctly uses BotContext from the telegram-bridge package. The ClearHistoryFn type signature is connector-agnostic.

## Verdict Rationale

**APPROVED.** All automated checks pass (Biome: 0 errors; all non-pre-existing tests pass). There are zero CRITICAL or HIGH findings. The three MEDIUM findings are:

- The .env.example change to SETUP_BASE_URL/EXPECTED_ORIGIN is unplanned but does not break functionality or security -- it is a cosmetic difference between localhost and 127.0.0.1.
- The missing runtime validation on loaded JSONB messages is a defense-in-depth concern but not an immediate vulnerability since the data is written by the same service.
- The per-call system prompt rebuild is a minor inefficiency acceptable for Stage 1.

The implementation is well-structured, follows project patterns, maintains service boundaries, includes comprehensive tests (9 new test files, updates to 10 existing test files), and preserves backward compatibility with the existing response contract. The deferred items (smoke tests, Stage 2 confirmation guardrail, Stage 4 tool handlers) are clearly documented.
