---
verdict: APPROVED
attempt: 1
biome_pass: true
tests_pass: true
test_summary: "ai-router: 300 passed, 0 failed; types: 178 passed, 0 failed; scheduler: 53 passed, 6 pre-existing failures (import resolution)"
critical_count: 0
high_count: 0
medium_count: 2
---

# Code Review: Stage 6 -- Dead Code Removal & Cleanup

## Automated Checks

- **Biome**: 25 errors, 40 warnings -- all pre-existing (CRLF line endings and `noExplicitAny` in test files). Main branch has 64 errors, 126 warnings. This change *reduced* Biome errors by ~39 by deleting dead code files. No new Biome errors introduced.
- **ai-router tests**: PASS -- 30 test files, 300 tests passed, 0 failures.
- **types tests**: PASS -- 11 test files, 178 tests passed, 0 failures.
- **scheduler tests**: 6 pre-existing failures (cannot resolve `@monica-companion/observability`, `@monica-companion/auth`, `@monica-companion/idempotency` -- missing vitest resolve aliases). Confirmed identical on main branch. 9 test files pass with 53 tests.

## Findings

### CRITICAL
(none)

### HIGH
(none)

### MEDIUM

1. [MEDIUM] `scripts/orchestrate-runner/run.ts` -- Unrelated change (~526 lines diff) to the orchestrate runner script is included in the working tree alongside the dead code removal changes. This is not part of the Stage 6 plan. -- **Fix:** When committing, do not stage `scripts/orchestrate-runner/run.ts` or `scripts/orchestrate-runner/README.md`. These should be committed separately under a different task.

2. [MEDIUM] `services/ai-router/src/agent/history-inactivity-sweep.ts:12` -- Comment still references "expiry-sweep" pattern: "Uses the same setInterval pattern as expiry-sweep." Since the expiry sweep module no longer exists, the comment reference is stale. -- **Fix:** Update the comment to describe the pattern generically (e.g., "Uses a simple setInterval pattern") or remove the reference.

### LOW

1. [LOW] `services/ai-router/src/config.ts:8` -- `PENDING_COMMAND_TTL_MINUTES` config field name remains. This was explicitly deferred in the plan's Out of Scope section and is noted in the impl-summary, but worth tracking. -- **Fix:** No action needed now; cosmetic rename deferred to a future pass.

2. [LOW] `config/vitest-resolve.ts:33-37` -- Comment examples were updated from `@langchain/openai` to `@opentelemetry/api`, which is a good cleanup. No issue, just noting the additional beneficial change.

3. [LOW] `tests/smoke/migration.smoke.test.ts` -- Smoke test still queries for `conversation_turns` and `pending_commands` in the first test case's SQL WHERE clause (to verify they don't exist alongside `conversation_history`). This is correct for verifying the migration but could be simplified to only check `conversation_history`. -- **Fix:** Optional; the current approach is valid as a migration regression test.

## Plan Compliance

The implementation follows the approved plan faithfully across all 18 implementation steps (Steps 19-21 deferred as documented). All four plan review MEDIUM recommendations were addressed:

- **MEDIUM-1** (stale architecture docs): `architecture.md` and `service-architecture.md` updated.
- **MEDIUM-2** (dangling CI workflow): `.github/workflows/llm-integration.yml` deleted.
- **MEDIUM-3** (cross-service breaking change): Atomic deployment documented in impl-summary.
- **MEDIUM-4** (`db/index.ts` exports): Correctly exports only `{ createDb, type Database }`.

Plan review LOW-1 (TODO comment for `GraphResponse` name) was also addressed in `agent/types.ts:4-5`.

No unjustified deviations found.

## Unintended Removal Check

- **`.env.example`**: No changes. No variables removed.
- **`docker-compose.yml`**: Only `EXPIRY_SWEEP_INTERVAL_MS` removed, as planned. All other service definitions, env vars, and volume mounts intact.
- **`pnpm-workspace.yaml`**: Only the three `@langchain/*` catalog entries removed, as planned. All other entries intact.
- **`packages/types/src/index.ts`**: No changes. All existing exports preserved.
- **`services/ai-router/src/db/index.ts`**: Exports reduced to `{ createDb, type Database }` as planned. The removed exports (`getRecentTurns`, `insertTurnSummary`, `conversationTurns`, `pendingCommands`) belong to deleted modules.

## Deleted Files Summary

The implementation correctly deleted:
- Entire `services/ai-router/src/graph/` directory (~8,000+ lines: StateGraph, nodes, tests)
- Entire `services/ai-router/src/pending-command/` directory (~1,050 lines: repository, state machine, sweep, tests)
- `services/ai-router/src/db/turn-repository.ts` and its test
- `services/ai-router/src/__tests__/read-only-bypass.test.ts`
- `services/ai-router/src/__tests__/llm-integration/` directory
- `services/ai-router/vitest.llm-integration.config.ts`
- `.github/workflows/llm-integration.yml`

No dangling imports to any deleted module were found. All 300 remaining ai-router tests pass.

## Migration Safety

- `drizzle/0004_drop_legacy_tables.sql` uses `DROP TABLE IF EXISTS` for both tables -- safe and idempotent.
- `drizzle/meta/_journal.json` correctly adds entry at index 4 with `prevId` linking to the previous snapshot.
- `drizzle/meta/0004_snapshot.json` correctly reflects only the `conversation_history` table with all 5 columns, constraints, and indexes.

## Security Check

- No new public endpoints added.
- Service auth middleware and per-endpoint caller allowlists remain intact on all retention and user-purge routes.
- Redaction patterns unchanged.
- No secrets or credentials exposed.

## Verdict Rationale

All automated checks pass (Biome errors are pre-existing and reduced in count; scheduler test failures are pre-existing). Zero CRITICAL or HIGH findings. The implementation is thorough, well-structured, and follows the approved plan faithfully. The two MEDIUM findings are cosmetic (unrelated file in working tree, stale comment) and do not affect correctness or safety. The dead code removal successfully eliminates ~13,700 lines of unused code and dependencies while maintaining full test coverage of the surviving codebase.

**APPROVED**
