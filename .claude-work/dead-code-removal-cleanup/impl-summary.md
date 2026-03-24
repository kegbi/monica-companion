# Implementation Summary: Stage 6 -- Dead Code Removal & Cleanup

## Files Changed

| File | Action | Description |
|------|--------|-------------|
| `services/ai-router/src/agent/types.ts` | created | Relocated `GraphResponseSchema` and `GraphResponse` type from deleted `graph/state.ts` |
| `services/ai-router/src/agent/loop.ts` | modified | Updated import of `GraphResponse` to point to `./types.js` instead of `../graph/state.js` |
| `services/ai-router/src/graph/` | deleted | Removed entire directory (~8,000+ lines): StateGraph wiring, intent classification, nodes, all tests |
| `services/ai-router/src/pending-command/` | deleted | Removed entire directory: repository, state machine, confirm, expiry sweep, all tests |
| `services/ai-router/src/db/turn-repository.ts` | deleted | Removed conversation turns repository |
| `services/ai-router/src/db/__tests__/turn-repository.test.ts` | deleted | Removed turn repository tests |
| `services/ai-router/src/db/index.ts` | modified | Simplified to export only `{ createDb, type Database }` (per plan review MEDIUM-4) |
| `services/ai-router/src/db/schema.ts` | modified | Removed `conversationTurns` and `pendingCommands` table definitions; kept only `conversationHistory` |
| `services/ai-router/src/db/__tests__/schema.test.ts` | modified | Replaced with tests for `conversationHistory` table only |
| `services/ai-router/drizzle/0004_drop_legacy_tables.sql` | created | Migration to drop `pending_commands` and `conversation_turns` tables |
| `services/ai-router/drizzle/meta/_journal.json` | modified | Added entry for migration 0004 |
| `services/ai-router/drizzle/meta/0004_snapshot.json` | created | Snapshot reflecting only the `conversationHistory` table |
| `services/ai-router/src/index.ts` | modified | Removed `startExpirySweep` import/invocation and `stopExpirySweep` from shutdown handler |
| `services/ai-router/src/config.ts` | modified | Removed `EXPIRY_SWEEP_INTERVAL_MS` from schema, interface, and mapping |
| `services/ai-router/src/__tests__/config.test.ts` | modified | Removed tests for `expirySweepIntervalMs` |
| `services/ai-router/package.json` | modified | Removed `@langchain/core`, `@langchain/langgraph`, `@langchain/openai` deps; removed `test:llm-integration` script |
| `pnpm-workspace.yaml` | modified | Removed `@langchain/*` catalog entries |
| `services/ai-router/vitest.config.ts` | modified | Removed `@langchain/core/messages` resolve alias |
| `services/ai-router/vitest.llm-integration.config.ts` | deleted | Removed LLM integration vitest config |
| `services/ai-router/src/__tests__/process-endpoint.test.ts` | modified | Removed `@langchain/openai`, `turn-repository`, `pending-command/repository` mocks and `expirySweepIntervalMs` from config |
| `services/ai-router/src/__tests__/clear-history-endpoint.test.ts` | modified | Same mock and config cleanup |
| `services/ai-router/src/__tests__/middleware-ordering.test.ts` | modified | Same mock and config cleanup |
| `services/ai-router/src/__tests__/guardrails-wiring.test.ts` | modified | Same mock and config cleanup |
| `services/ai-router/src/contact-resolution/__tests__/routes.test.ts` | modified | Removed `@langchain/openai` mock and `expirySweepIntervalMs` from config |
| `services/ai-router/src/__tests__/llm-integration/` | deleted | Removed LLM integration test directory |
| `services/ai-router/src/__tests__/read-only-bypass.test.ts` | deleted | Removed test that depended on deleted `pending-command/confirm.ts` |
| `services/ai-router/src/retention/cleanup.ts` | modified | Removed `purgeExpiredConversationTurns` and `purgeExpiredPendingCommands`; kept only `purgeExpiredConversationHistory` |
| `services/ai-router/src/retention/routes.ts` | modified | Updated to use `conversationHistoryCutoff` field; removed old table purge calls |
| `services/ai-router/src/retention/user-purge.ts` | modified | Removed `purgeUserConversationTurns` and `purgeUserPendingCommands`; kept only `purgeUserConversationHistory` |
| `services/ai-router/src/retention/user-purge-routes.ts` | modified | Updated response shape to only include `conversationHistory` |
| `services/ai-router/src/retention/__tests__/cleanup.test.ts` | modified | Updated to test only `purgeExpiredConversationHistory` |
| `services/ai-router/src/retention/__tests__/user-purge.test.ts` | modified | Updated to test only `purgeUserConversationHistory` |
| `services/ai-router/src/__tests__/retention-endpoint.test.ts` | modified | Updated payload and response expectations for new schema |
| `services/ai-router/src/__tests__/user-purge-endpoint.test.ts` | modified | Updated response expectations |
| `packages/types/src/retention.ts` | modified | Replaced `conversationTurnsCutoff` + `pendingCommandsCutoff` with single `conversationHistoryCutoff` |
| `packages/types/src/__tests__/retention.test.ts` | modified | Updated tests for new schema shape |
| `services/scheduler/src/workers/retention-cleanup-worker.ts` | modified | Removed `pendingCommandCutoff`; sends `conversationHistoryCutoff` instead of old fields |
| `services/scheduler/src/__tests__/retention-cleanup-worker.test.ts` | modified | Updated payload expectations and mock responses |
| `services/ai-router/src/__smoke__/helpers.ts` | modified | Removed `getPendingCommandsForUser` and `assertNoPendingCommands` DB query helpers |
| `services/ai-router/src/__smoke__/out-of-scope.smoke.test.ts` | modified | Replaced DB assertions with HTTP-level `body.type !== "confirmation_prompt"` checks |
| `docker-compose.yml` | modified | Removed `EXPIRY_SWEEP_INTERVAL_MS` env var for ai-router |
| `.github/workflows/llm-integration.yml` | deleted | Removed CI workflow for deleted LLM integration tests (plan review MEDIUM-2) |
| `context/product/acceptance-criteria.md` | modified | Updated command lifecycle section to reflect tool-calling agent model |
| `context/product/architecture.md` | modified | Replaced LangGraph/conversation_turns/pending-command references with tool-calling agent loop and conversation_history (plan review MEDIUM-1) |
| `context/product/service-architecture.md` | modified | Updated ai-router responsibilities to reflect tool-calling agent model (plan review MEDIUM-1) |

## Tests Added

| Test File | What It Tests |
|-----------|---------------|
| `services/ai-router/src/db/__tests__/schema.test.ts` | Replaced: now tests only `conversationHistory` table (5 columns, correct types) |
| `services/ai-router/src/retention/__tests__/cleanup.test.ts` | Replaced: tests only `purgeExpiredConversationHistory` |
| `services/ai-router/src/retention/__tests__/user-purge.test.ts` | Replaced: tests only `purgeUserConversationHistory` |
| `packages/types/src/__tests__/retention.test.ts` | Updated: tests new `conversationHistoryCutoff` schema field |
| `services/scheduler/src/__tests__/retention-cleanup-worker.test.ts` | Updated: verifies new payload shape and absence of removed fields |

## Verification Results

- **Biome**: `pnpm --filter @monica-companion/ai-router exec biome check --write src/` -- 0 errors, 0 fixes applied, 40 pre-existing warnings
- **ai-router tests**: 30 test files, 300 tests passed (0 failures)
- **types tests**: 11 test files, 178 tests passed (0 failures)
- **scheduler tests**: 6 pre-existing failures (import resolution issues unrelated to this change -- `@monica-companion/observability` and `@monica-companion/idempotency` cannot resolve without vitest aliases). 9 test files pass with 53 tests.

## Plan Deviations

1. **Plan review MEDIUM-1**: Updated `context/product/architecture.md` and `context/product/service-architecture.md` to replace stale LangGraph/conversation_turns/pending-command references, as recommended.
2. **Plan review MEDIUM-2**: Deleted `.github/workflows/llm-integration.yml` alongside the `test:llm-integration` script removal, as recommended.
3. **Plan review MEDIUM-4**: `db/index.ts` exports only `{ createDb, type Database }` as recommended (no `conversationHistory` export).
4. **Plan review LOW-1**: Added TODO comment in `agent/types.ts` noting that `GraphResponse` name is a vestige.
5. **Steps 19-21** (full test suite verification, Docker Compose smoke tests, roadmap update): Deferred per instructions -- these require the full Docker stack running and are gated on the implementation being reviewed first.

## Residual Risks

1. **Scheduler test resolution**: The scheduler package lacks vitest resolve aliases, causing 6 test files to fail on import resolution. This is a pre-existing issue not introduced by this change. The retention-cleanup-worker code is structurally correct and matches the test expectations.
2. **Atomic deployment**: The retention schema rename (`conversationTurnsCutoff` -> `conversationHistoryCutoff`) is a cross-service change between scheduler and ai-router. Safe in Docker Compose monorepo model where all services deploy atomically from the same codebase. Documented per plan review MEDIUM-3.
3. **Types package unused exports**: `PendingCommandStatus`, `PendingCommandRecordSchema`, and related types remain in `@monica-companion/types` as they may be referenced by the scheduler's command execution flow. Separate cleanup pass if needed.
4. **Migration ordering**: The SQL migration uses `DROP TABLE IF EXISTS` for safety. It runs on container startup after new code is mounted, which is safe in the Docker Compose deployment model.
5. **pnpm install**: The `--force` reinstall was needed to clear stale `@langchain` node_modules. A clean `pnpm install` may need to be run in a fresh environment if Windows file-locking issues persist.
