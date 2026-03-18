# Implementation Summary: LangGraph Pipeline Foundation

## Files Changed
| File | Action | Description |
|------|--------|-------------|
| `services/ai-router/src/db/schema.ts` | modified | Added `conversationTurns` table with id, userId, role, summary, correlationId, createdAt columns and two indexes |
| `services/ai-router/src/db/index.ts` | modified | Exported `conversationTurns` from schema |
| `services/ai-router/src/config.ts` | modified | Added optional `OPENAI_API_KEY` config entry and `openaiApiKey` to Config interface |
| `services/ai-router/src/graph/state.ts` | created | LangGraph conversation state schema with Zod schemas (TurnSummary, PendingCommandRef, GraphResponse, ConversationState) and LangGraph Annotation |
| `services/ai-router/src/graph/graph.ts` | created | Placeholder graph with echo node (START -> process -> END) |
| `services/ai-router/src/graph/index.ts` | created | Barrel export for graph module |
| `services/ai-router/src/app.ts` | modified | Restructured route mounting: /health first, then guardrails on /internal/*, then /process with serviceAuth behind guardrails, then contact-resolution. Replaced stub with graph invocation. |
| `docker-compose.yml` | modified | Added `OPENAI_API_KEY: ${OPENAI_API_KEY:-}` to ai-router service environment |
| `services/ai-router/drizzle/0000_majestic_romulus.sql` | created | Generated migration for both conversation_turns and pending_commands tables |
| `services/ai-router/drizzle/meta/_journal.json` | created | Drizzle migration journal |
| `services/ai-router/drizzle/meta/0000_snapshot.json` | created | Drizzle migration snapshot |
| `services/ai-router/src/db/__tests__/schema.test.ts` | created | Tests for conversationTurns table schema |
| `services/ai-router/src/graph/__tests__/state.test.ts` | created | Tests for Zod state schemas |
| `services/ai-router/src/graph/__tests__/graph.test.ts` | created | Tests for graph invocation |
| `services/ai-router/src/__tests__/process-endpoint.test.ts` | created | Tests for POST /internal/process endpoint with graph response |
| `services/ai-router/src/__tests__/config.test.ts` | modified | Added tests for OPENAI_API_KEY config |

## Exact Dependency Versions
Dependencies were already present in the pnpm catalog and package.json:
- `@langchain/langgraph`: 1.2.3
- `@langchain/openai`: 1.3.0
- `@langchain/core`: 1.1.33

All versions verified against npmjs.com as the latest stable releases.

## Tests Added
| Test File | What It Tests |
|-----------|---------------|
| `services/ai-router/src/db/__tests__/schema.test.ts` | conversationTurns table name, columns (count, types, not-null, defaults) |
| `services/ai-router/src/graph/__tests__/state.test.ts` | TurnSummarySchema, PendingCommandRefSchema, GraphResponseSchema, ConversationStateSchema validation (accept valid, reject invalid, defaults) |
| `services/ai-router/src/graph/__tests__/graph.test.ts` | Graph compilation, invocation with all 3 event types, response validation, state preservation |
| `services/ai-router/src/__tests__/process-endpoint.test.ts` | Endpoint returns graph response (not stub), 400 for invalid/non-JSON body, all event types, error handling |
| `services/ai-router/src/__tests__/config.test.ts` | OPENAI_API_KEY optional parsing (2 new tests) |

## Verification Results
- **Biome**: 12 files checked, 0 errors, 6 warnings (pre-existing `any` in test mocks)
- **Tests**: 14 test files passed, 134 tests passed. 1 integration test file skipped (requires live PostgreSQL, pre-existing)

## Key Decisions
1. **Provisional state fields**: Per review advisory (MEDIUM-1), state fields not used by the echo node (recentTurns, activePendingCommand, resolvedContact, userPreferences) are marked as "provisional" in code comments.
2. **Route restructuring**: Moved /internal/process behind guardrail middleware as specified in the plan. The old `inbound` sub-app pattern (mounted before guardrails) was replaced with a `processRoutes` sub-app mounted after `app.use("/internal/*", guard)`.
3. **Graph compiled once at app creation**: The conversation graph is compiled in `createApp()` and reused for all requests (stateless, no mutable state in the compiled graph).
4. **Error handling**: Graph invocation failures return `{ type: "error", text: "..." }` with HTTP 500, and null responses also return 500.

## Plan Deviations
1. **Index assertions simplified**: The plan suggested testing index names via `getTableConfig()`, but the Drizzle ORM version's `getTableConfig()` returns undefined for index names in test context. Replaced with a column-count test; the indexes are verified in the generated migration SQL.
2. **No changes to index.ts**: The plan mentioned "pass config to createApp for graph creation" but the existing `index.ts` already passes `config` to `createApp()`. The graph creation happens inside `createApp()` using no config (the echo node needs no config). No change was needed.

## Residual Risks
1. **Migration includes both tables**: The generated migration (`0000_majestic_romulus.sql`) includes both `conversation_turns` and `pending_commands` since this is the first migration generation. If `pending_commands` was previously applied manually or via `db:push`, the migration will need adjustment.
2. **Graph is compiled once**: If future nodes need per-request configuration (e.g., different LLM settings), the graph factory may need to accept parameters.
3. **OPENAI_API_KEY not yet used**: The key is accepted in config but has no consumer until the Intent Classification task.
