# Implementation Summary: Command Contract & Lifecycle

## Files Changed
| File | Action | Description |
|------|--------|-------------|
| `packages/types/src/commands.ts` | created | Zod schemas for MutatingCommandType, ReadOnlyCommandType, PendingCommandStatus, per-action payload schemas, PendingCommandRecordSchema, ConfirmedCommandPayloadSchema |
| `packages/types/src/index.ts` | modified | Export all command-related types and schemas |
| `packages/types/src/__tests__/commands.test.ts` | created | 27 unit tests covering all command schemas, enum values, discriminated unions, and validation |
| `packages/types/vitest.config.ts` | created | Vitest config with zod alias for Windows/pnpm junction workaround |
| `services/ai-router/package.json` | modified | Added dependencies: @monica-companion/auth, @monica-companion/types, zod, drizzle-orm, postgres, drizzle-kit, @types/node |
| `services/ai-router/vitest.config.ts` | created | Vitest config with aliases for zod, drizzle-orm, postgres, and workspace packages (Windows/pnpm junction workaround) |
| `services/ai-router/drizzle.config.ts` | created | Drizzle Kit config pointing to ai-router schema |
| `services/ai-router/src/config.ts` | created | Config module with DATABASE_URL, PENDING_COMMAND_TTL_MINUTES, EXPIRY_SWEEP_INTERVAL_MS |
| `services/ai-router/src/__tests__/config.test.ts` | created | 9 unit tests for config validation and defaults |
| `services/ai-router/src/db/connection.ts` | created | Database connection factory using postgres.js and drizzle |
| `services/ai-router/src/db/schema.ts` | created | Drizzle schema for pending_commands table with indexes |
| `services/ai-router/src/db/index.ts` | created | Re-exports for database module |
| `services/ai-router/src/app.ts` | modified | Accept Config and Database parameters |
| `services/ai-router/src/index.ts` | modified | Wire up config, DB connection, expiry sweep with cleanup on shutdown |
| `services/ai-router/src/pending-command/state-machine.ts` | created | State machine with valid transitions map, assertTransition, isTerminal, isActive |
| `services/ai-router/src/pending-command/__tests__/state-machine.test.ts` | created | 26 unit tests covering all valid/invalid transitions, terminal/active checks |
| `services/ai-router/src/pending-command/repository.ts` | created | CRUD operations: create, get, getActiveForUser, transitionStatus (optimistic concurrency), updateDraftPayload, expireStaleCommands |
| `services/ai-router/src/pending-command/__tests__/repository.integration.test.ts` | created | 22 integration tests against real PostgreSQL including concurrent version conflict test |
| `services/ai-router/src/pending-command/confirm.ts` | created | buildConfirmedPayload helper producing ConfirmedCommandPayload with deterministic idempotencyKey |
| `services/ai-router/src/pending-command/__tests__/confirm.test.ts` | created | 6 unit tests for confirmed payload builder |
| `services/ai-router/src/pending-command/expiry-sweep.ts` | created | Periodic sweep returning cleanup function |
| `services/ai-router/src/pending-command/index.ts` | created | Module barrel exports |
| `docker-compose.yml` | modified | Added JWT_SECRET, DATABASE_URL, PENDING_COMMAND_TTL_MINUTES, EXPIRY_SWEEP_INTERVAL_MS env vars for ai-router service |

## Tests Added
| Test File | What It Tests |
|-----------|---------------|
| `packages/types/src/__tests__/commands.test.ts` | MutatingCommandType enum values, ReadOnlyCommandType enum values, PendingCommandStatus enum values, all 7 mutating payload schemas (valid + invalid), all 3 read-only payload schemas (valid + invalid), PendingCommandRecordSchema (valid, invalid commandType, invalid status), ConfirmedCommandPayloadSchema (valid, missing fields, wrong commandType) |
| `services/ai-router/src/__tests__/config.test.ts` | Config parsing, default values (port 3002, TTL 30min, sweep 60s), missing DATABASE_URL, PORT coercion, TTL coercion, JWT secret handling |
| `services/ai-router/src/pending-command/__tests__/state-machine.test.ts` | All 8 valid transitions, 6 invalid transitions (including same-state), isTerminal for all 6 statuses, isActive for all 6 statuses |
| `services/ai-router/src/pending-command/__tests__/repository.integration.test.ts` | createPendingCommand (draft status, TTL calculation), getPendingCommand (found, not found), getActivePendingCommandForUser (most recent, excludes terminal, empty), transitionStatus (valid transitions, confirmedAt/executedAt/terminalAt setting, version mismatch, status mismatch, invalid transition, concurrent version conflict -- exactly one succeeds), updateDraftPayload (payload + version bump, TTL refresh, version mismatch, non-draft rejection), expireStaleCommands (expired, within TTL, already terminal) |
| `services/ai-router/src/pending-command/__tests__/confirm.test.ts` | buildConfirmedPayload field mapping, deterministic idempotencyKey format, schema validation pass-through, confirmedAt from record vs fallback, different keys for different versions |

## Verification Results
- **Biome**: `pnpm check:fix` -- 0 errors, 19 pre-existing warnings (none in changed files), 19 auto-fixes applied (formatting)
- **Tests**:
  - `@monica-companion/types`: 2 files, **38 passed**
  - `@monica-companion/ai-router`: 4 files, **63 passed**
  - Total: **101 tests passed**, 0 failed

## Plan Review Findings Addressed

### MEDIUM
1. **Command payload vs monica-integration write schema relationship** -- Block comment at top of mutating payload section in `commands.ts` documents they are intentionally separate (AI-facing vs Monica-integration-facing) and will be reconciled in Phase 4.
2. **`contactFieldTypeId` boundary pragmatism** -- JSDoc comments on both `UpdateContactPhonePayloadSchema.contactFieldTypeId` and `UpdateContactEmailPayloadSchema.contactFieldTypeId` documenting this as known V1 pragmatism.
3. **Expiry sweep cleanup** -- `startExpirySweep` returns a cleanup function; `index.ts` shutdown handler calls `stopExpirySweep()` before telemetry shutdown.
4. **Concurrent version conflict test** -- Integration test "concurrent version conflict: exactly one succeeds" fires two parallel `transitionStatus` calls with same `expectedVersion`, asserts exactly one succeeds and one returns null.

### LOW
1. **`PendingCommandRecord.commandType` typed as `MutatingCommandType`** -- Uses `MutatingCommandTypeSchema` (not a general `CommandType` union) in `PendingCommandRecordSchema` and `ConfirmedCommandPayloadSchema`.
2. **`sourceMessageRef` semantics** -- JSDoc comments in both `commands.ts` schema and `schema.ts` Drizzle definition defining it as "connector-neutral opaque string".
3. **Table ownership comment** -- File-level JSDoc in `schema.ts` stating all tables are owned by ai-router.

## Plan Deviations

1. **vitest.config.ts files added for both packages/types and services/ai-router** -- These were not in the plan but were necessary to work around a pre-existing Windows + pnpm junction issue where Node.js cannot resolve symlinked packages through MEGA Cloud Sync. The aliases point directly to the pnpm store paths. This is an environment-specific workaround and does not affect Docker or CI behavior.

2. **Drizzle migration generation skipped** -- The plan mentions `drizzle-kit generate` for migration files. The integration tests create the table via raw SQL (`CREATE TABLE IF NOT EXISTS`), which is sufficient for development and testing. Generating migration files requires a running database and `drizzle-kit` being able to resolve the schema (blocked by the same junction issue). The Drizzle schema is complete and correct; migrations can be generated when deploying to the live stack.

3. **Step ordering** -- The plan lists steps 1-14 sequentially. I grouped related steps (e.g., Steps 1+2 together for schema creation, Steps 6+7 together for state machine, Steps 8+9 together for repository) while maintaining TDD order within each group (test first, then implementation).

## Residual Risks

1. **Drizzle migrations not yet generated** -- The `pending_commands` table schema is defined in Drizzle ORM format but no migration SQL files exist yet in `services/ai-router/drizzle/`. These need to be generated before deploying to production. The integration tests create the table via raw SQL as a workaround.

2. **Windows/pnpm junction resolution** -- The vitest.config.ts alias workaround hardcodes exact pnpm store paths (e.g., `zod@4.3.6`). When upgrading these dependencies, the vitest configs must be updated. This does not affect Docker-based execution.

3. **No HTTP endpoints yet** -- The pending-command module is fully functional but not yet exposed via HTTP endpoints on ai-router. This is by design (out of scope per plan) -- endpoints will be added in Phase 4.

4. **Smoke test not performed** -- Docker Compose smoke test was not run because this task does not mark any roadmap item complete. Per the completion rules, smoke tests are required before marking items done, which will happen after Phase 4 integration.
