# Implementation Summary: Stage 1 -- Agent Loop Foundation

## Files Changed
| File | Action | Description |
|------|--------|-------------|
| `services/ai-router/src/config.ts` | modified | Added LLM_BASE_URL, LLM_API_KEY, LLM_MODEL_ID, HISTORY_INACTIVITY_SWEEP_INTERVAL_MS env vars |
| `services/ai-router/src/agent/llm-client.ts` | created | OpenAI SDK wrapper with configurable baseURL, apiKey, modelId, and timeout |
| `services/ai-router/src/agent/history-repository.ts` | created | CRUD for conversationHistory table: getHistory, saveHistory, clearHistory, clearStaleHistories with 40-message sliding window |
| `services/ai-router/src/agent/tools.ts` | created | 11 tool definitions in OpenAI function-calling format; MUTATING_TOOLS (7) and READ_ONLY_TOOLS (4) sets |
| `services/ai-router/src/agent/system-prompt.ts` | created | Agent system prompt with tool-calling instructions, security rules, and injection defense |
| `services/ai-router/src/agent/loop.ts` | created | Core runAgentLoop() function with 5-iteration cap, tool call stubs, history persistence, callback_action handling |
| `services/ai-router/src/agent/history-inactivity-sweep.ts` | created | setInterval-based 24h inactivity sweep (same pattern as expiry-sweep) |
| `services/ai-router/src/app.ts` | modified | Replaced graph invocation with runAgentLoop(); added POST /internal/clear-history endpoint; removed unused graph imports |
| `services/ai-router/src/index.ts` | modified | Started history inactivity sweep; added to shutdown handler |
| `services/ai-router/src/db/schema.ts` | modified | Added conversationHistory table with userId (uuid, unique), messages (jsonb), pendingToolCall (jsonb), updatedAt |
| `services/ai-router/src/retention/cleanup.ts` | modified | Added purgeExpiredConversationHistory function |
| `services/ai-router/src/retention/user-purge.ts` | modified | Added purgeUserConversationHistory function |
| `services/ai-router/src/retention/routes.ts` | modified | Includes conversationHistory in retention cleanup response |
| `services/ai-router/src/retention/user-purge-routes.ts` | modified | Includes conversationHistory in user purge response |
| `services/ai-router/package.json` | modified | Added `"openai": "catalog:"` to dependencies |
| `services/ai-router/vitest.config.ts` | modified | Added ioredis and openai aliases to resolve pre-existing test failures |
| `services/ai-router/drizzle/0003_add_conversation_history.sql` | created | Migration for conversation_history table |
| `services/ai-router/drizzle/meta/_journal.json` | modified | Added migration entry |
| `services/telegram-bridge/src/bot/handlers/clear.ts` | created | /clear command handler calling ai-router clear-history endpoint |
| `services/telegram-bridge/src/bot/setup.ts` | modified | Registered /clear command; updated ordering comment (9 items); extended SetupDeps with clearHistory |
| `services/telegram-bridge/src/lib/ai-router-client.ts` | modified | Added clearHistory method to AiRouterClient interface and implementation |
| `services/telegram-bridge/src/app.ts` | modified | Wired clearHistory dep to setupBot |
| `.env.example` | modified | Added LLM_BASE_URL, LLM_API_KEY, LLM_MODEL_ID |
| `docker-compose.yml` | modified | Added LLM_BASE_URL, LLM_API_KEY, LLM_MODEL_ID to ai-router environment |
| `services/ai-router/src/__tests__/config.test.ts` | modified | Added tests for new LLM config vars and defaults |
| `services/ai-router/src/__tests__/process-endpoint.test.ts` | modified | Updated to test agent loop instead of graph; added openai mock |
| `services/ai-router/src/__tests__/clear-history-endpoint.test.ts` | created | Tests for POST /internal/clear-history endpoint |
| `services/ai-router/src/__tests__/guardrails-wiring.test.ts` | modified | Added openai mock and new config fields |
| `services/ai-router/src/__tests__/middleware-ordering.test.ts` | modified | Added openai mock and new config fields |
| `services/ai-router/src/__tests__/read-only-bypass.test.ts` | modified | Added LLM_API_KEY to baseEnv |
| `services/ai-router/src/__tests__/retention-endpoint.test.ts` | modified | Updated mock and assertion for conversationHistory |
| `services/ai-router/src/__tests__/user-purge-endpoint.test.ts` | modified | Updated mock and assertion for conversationHistory |
| `services/ai-router/src/contact-resolution/__tests__/routes.test.ts` | modified | Added openai mock, history-repository mock, service client mocks, and new config fields |
| `services/ai-router/src/retention/__tests__/cleanup.test.ts` | modified | Added tests for purgeExpiredConversationHistory |
| `services/ai-router/src/retention/__tests__/user-purge.test.ts` | modified | Added tests for purgeUserConversationHistory |

## Tests Added
| Test File | What It Tests |
|-----------|---------------|
| `services/ai-router/src/__tests__/config.test.ts` | LLM_BASE_URL/LLM_API_KEY/LLM_MODEL_ID defaults, parsing, and required validation |
| `services/ai-router/src/agent/__tests__/llm-client.test.ts` | createLlmClient creation, correct SDK params, timeout defaults, error propagation |
| `services/ai-router/src/agent/__tests__/history-repository.test.ts` | getHistory, saveHistory, clearHistory, clearStaleHistories, SLIDING_WINDOW_SIZE |
| `services/ai-router/src/agent/__tests__/tools.test.ts` | 11 tool definitions, READ_ONLY_TOOLS (4), MUTATING_TOOLS (7), no overlap, all tools classified |
| `services/ai-router/src/agent/__tests__/system-prompt.test.ts` | Prompt contains date, role, tools, security rules, injection defense |
| `services/ai-router/src/agent/__tests__/loop.test.ts` | Text/voice/callback events, history loading, history saving, tool call stubs, 5-iteration cap, LLM error handling, empty choices |
| `services/ai-router/src/__tests__/clear-history-endpoint.test.ts` | POST /internal/clear-history: valid userId, invalid userId, missing body, auth wiring |
| `services/ai-router/src/agent/__tests__/history-inactivity-sweep.test.ts` | Interval-based sweep, 24h cutoff, stop function, error handling |
| `services/telegram-bridge/src/bot/handlers/__tests__/clear-command.test.ts` | /clear handler: registered user, unregistered user, error handling |

## Verification Results
- **Biome**: `pnpm biome check --write` -- 0 errors, all files formatted
- **ai-router tests**: 39 passed, 1 failed (pre-existing integration test needing running postgres), 1 skipped. 473 individual tests passed, 35 skipped.
- **telegram-bridge tests**: 21 files passed. 98 individual tests passed.

## Plan Deviations

1. **Step 14 (Smoke Tests)**: Deferred. Smoke tests require a running Docker Compose stack which is not available in this environment. The existing smoke test files were not modified because no new externally-reachable endpoints were added (clear-history is internal, same as other /internal/ endpoints).

2. **vitest.config.ts ioredis alias**: Added an ioredis alias to fix a pre-existing test failure in config.test.ts and read-only-bypass.test.ts. This was not in the plan but was necessary to make the existing tests pass.

3. **openai vitest alias**: Added an openai alias to vitest.config.ts to ensure the OpenAI SDK resolves correctly in tests. This aligns with the plan's note about checking voice-transcription precedent.

4. **contact-resolution routes test**: Updated with additional mocks (service clients, history repository, openai) and complete Config type that were missing before but became required when app.ts was modified. This was a pre-existing gap in test isolation.

5. **Drizzle migration snapshot**: The snapshot JSON file for the new migration was not generated because drizzle-kit generate requires a running database. The SQL migration file was hand-written instead, which is sufficient for runtime migration execution.

## Residual Risks

1. **Tool call stubs**: All 11 tools return "not yet implemented" stub results. Actual implementations come in Stage 4.
2. **Confirmation guardrail**: callback_action events return a generic "no pending action" message. Stage 2 will add proper pending tool call interception.
3. **Migration snapshot**: No Drizzle snapshot file for migration 0003. If drizzle-kit generate is run later, it may produce a duplicate migration. Recommend running `drizzle-kit generate` against a real database to produce the proper snapshot.
4. **LangChain dead code**: Old graph code under src/graph/ is retained but no longer called from app.ts. It will be removed in Stage 6.
5. **Smoke tests**: Not verified against a live Docker Compose stack. Should be run before marking roadmap item as complete per project rules.
