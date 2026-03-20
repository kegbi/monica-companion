# Implementation Summary: Data Governance Enforcement

## Smoke Test Bug Fixes (2026-03-19)

### Bug 1 (CRITICAL): ai-router Hono sub-app middleware ordering collision
**File:** `services/ai-router/src/app.ts`
**Fix:** Scoped the `serviceAuth` middleware in the `internal` sub-app from global `.use(serviceAuth(...))` to path-scoped `.use("/process", serviceAuth(...))`. This ensures the telegram-bridge allowlist only applies to `/internal/process` and does not block scheduler or user-management callers on `/internal/retention-cleanup` or `/internal/users/:userId/data`.

### Bug 2 (CRITICAL): delivery Hono sub-app middleware collision
**File:** `services/delivery/src/app.ts`
**Fix:** Same approach. Scoped the `serviceAuth` middleware from global `.use(serviceAuth(...))` to path-scoped `.use("/deliver", serviceAuth(...))`. This ensures the ai-router/scheduler allowlist only applies to `/internal/deliver` and does not block user-management callers on purge endpoints.

### Bug 3 (HIGH): Scheduler CTE query error
**File:** `services/scheduler/src/retention/user-purge.ts`
**Fix:** Changed result extraction from `result[0][0]` (incorrect nested array assumption) to `result.rows[0]` (actual Drizzle ORM `execute()` return format with node-postgres). Added null-safe access with `?.` and `?? 0` fallbacks for empty result sets.
**Test:** `services/scheduler/src/retention/__tests__/user-purge.test.ts` updated to use `{ rows: [...] }` mock format and added a new test for empty result sets.

## Files Changed

| File | Action | Description |
|------|--------|-------------|
| `packages/types/src/retention.ts` | created | Zod schemas for retention cleanup and purge contracts |
| `packages/types/src/__tests__/retention.test.ts` | created | Tests for retention Zod schemas (18 tests) |
| `packages/types/src/index.ts` | modified | Export new retention schemas |
| `services/ai-router/src/retention/cleanup.ts` | created | purgeExpiredConversationTurns, purgeExpiredPendingCommands functions |
| `services/ai-router/src/retention/__tests__/cleanup.test.ts` | created | Unit tests for ai-router retention cleanup |
| `services/ai-router/src/retention/routes.ts` | created | POST /internal/retention-cleanup endpoint (caller: scheduler) |
| `services/ai-router/src/retention/user-purge.ts` | created | purgeUserConversationTurns, purgeUserPendingCommands functions |
| `services/ai-router/src/retention/user-purge-routes.ts` | created | DELETE /internal/users/:userId/data endpoint (caller: user-management) |
| `services/ai-router/src/retention/__tests__/user-purge.test.ts` | created | Unit tests for ai-router user purge functions |
| `services/ai-router/src/__tests__/retention-endpoint.test.ts` | created | Endpoint tests for retention cleanup (auth, validation) |
| `services/ai-router/src/__tests__/user-purge-endpoint.test.ts` | created | Endpoint tests for user data purge (auth, validation) |
| `services/ai-router/src/app.ts` | modified | Mount retention and user-purge route sub-apps |
| `services/scheduler/src/retention/cleanup.ts` | created | purgeExpiredExecutions, purgeExpiredIdempotencyKeys, purgeExpiredReminderWindows |
| `services/scheduler/src/retention/__tests__/cleanup.test.ts` | created | Unit tests for scheduler retention cleanup |
| `services/scheduler/src/retention/user-purge.ts` | created | purgeUserCommandExecutionsAndKeys (CTE), purgeUserReminderWindows |
| `services/scheduler/src/retention/user-purge-routes.ts` | created | DELETE /internal/users/:userId/data endpoint (caller: user-management) |
| `services/scheduler/src/retention/__tests__/user-purge.test.ts` | created | Unit tests for scheduler user purge functions |
| `services/scheduler/src/__tests__/retention-cleanup-worker.test.ts` | created | Tests for retention cleanup worker |
| `services/scheduler/src/__tests__/user-purge-endpoint.test.ts` | created | Endpoint tests for scheduler user data purge |
| `services/scheduler/src/workers/retention-cleanup-worker.ts` | created | processRetentionCleanup function for BullMQ worker |
| `services/scheduler/src/config.ts` | modified | Add retention config fields and AI_ROUTER_URL |
| `services/scheduler/src/index.ts` | modified | Wire retention cleanup queue, worker, repeatable job, aiRouterClient |
| `services/scheduler/src/app.ts` | modified | Mount user-purge route sub-app |
| `services/delivery/src/retention/cleanup.ts` | created | purgeExpiredDeliveryAudits function |
| `services/delivery/src/retention/__tests__/cleanup.test.ts` | created | Unit tests for delivery retention cleanup |
| `services/delivery/src/retention/routes.ts` | created | POST /internal/retention-cleanup endpoint (caller: scheduler) |
| `services/delivery/src/retention/user-purge.ts` | created | purgeUserDeliveryAudits function |
| `services/delivery/src/retention/user-purge-routes.ts` | created | DELETE /internal/users/:userId/data endpoint (caller: user-management) |
| `services/delivery/src/retention/__tests__/user-purge.test.ts` | created | Unit tests for delivery user purge function |
| `services/delivery/src/__tests__/retention-endpoint.test.ts` | created | Endpoint tests for delivery retention cleanup |
| `services/delivery/src/__tests__/user-purge-endpoint.test.ts` | created | Endpoint tests for delivery user data purge |
| `services/delivery/src/app.ts` | modified | Mount retention and user-purge route sub-apps |
| `services/user-management/src/db/schema.ts` | modified | Add dataPurgeRequests table definition |
| `services/user-management/src/db/index.ts` | modified | Export dataPurgeRequests |
| `services/user-management/drizzle/0002_data_purge_requests.sql` | created | Migration for data_purge_requests table |
| `services/user-management/src/user/disconnect.ts` | created | disconnectUser function (transactional) |
| `services/user-management/src/user/__tests__/disconnect.test.ts` | created | Unit tests for disconnect function |
| `services/user-management/src/purge/executor.ts` | created | processPendingPurges function with claimed_at, retry logic, timeouts |
| `services/user-management/src/purge/__tests__/executor.test.ts` | created | Unit tests for purge executor |
| `services/user-management/src/config.ts` | modified | Add purge config fields (service URLs, sweep interval, timeouts) |
| `services/user-management/src/index.ts` | modified | Wire purge executor sweep timer with service clients |
| `services/user-management/src/app.ts` | modified | Add disconnect endpoint, import disconnectUser |
| `services/telegram-bridge/src/bot/handlers/disconnect-command.ts` | created | /disconnect command handler with unregistered user guard |
| `services/telegram-bridge/src/bot/handlers/__tests__/disconnect-command.test.ts` | created | Tests for disconnect command handler |
| `services/telegram-bridge/src/bot/setup.ts` | modified | Add disconnect command registration before text handler |
| `services/telegram-bridge/src/bot/__tests__/setup.test.ts` | modified | Update mock bot with command method, add disconnect dep |
| `services/telegram-bridge/src/lib/user-management-client.ts` | modified | Add disconnectUser method |
| `services/telegram-bridge/src/app.ts` | modified | Pass disconnect dependency to setupBot |
| `services/voice-transcription/src/__tests__/audio-retention.test.ts` | created | Verification tests for voice audio transient handling |
| `docker-compose.yml` | modified | Add AI_ROUTER_URL to scheduler, service URLs to user-management |

## Tests Added

| Test File | What It Tests |
|-----------|---------------|
| `packages/types/src/__tests__/retention.test.ts` | Zod schema validation for all retention/purge contracts (18 tests) |
| `services/ai-router/src/retention/__tests__/cleanup.test.ts` | Retention cleanup functions for conversation turns and pending commands (4 tests) |
| `services/ai-router/src/retention/__tests__/user-purge.test.ts` | User-specific purge functions for ai-router (2 tests) |
| `services/ai-router/src/__tests__/retention-endpoint.test.ts` | Retention cleanup endpoint auth, validation, response (4 tests) |
| `services/ai-router/src/__tests__/user-purge-endpoint.test.ts` | User purge endpoint auth, validation, response (3 tests) |
| `services/scheduler/src/retention/__tests__/cleanup.test.ts` | Retention cleanup for executions, idempotency keys, reminder windows (6 tests) |
| `services/scheduler/src/retention/__tests__/user-purge.test.ts` | User purge with CTE and reminder windows (3 tests, including empty result set) |
| `services/scheduler/src/__tests__/retention-cleanup-worker.test.ts` | Retention cleanup worker cutoff dates, service calls, timeouts (4 tests) |
| `services/scheduler/src/__tests__/user-purge-endpoint.test.ts` | Scheduler user purge endpoint auth, response (2 tests) |
| `services/delivery/src/retention/__tests__/cleanup.test.ts` | Retention cleanup for delivery audits (2 tests) |
| `services/delivery/src/retention/__tests__/user-purge.test.ts` | User-specific purge for delivery audits (1 test) |
| `services/delivery/src/__tests__/retention-endpoint.test.ts` | Delivery retention cleanup endpoint auth, validation (4 tests) |
| `services/delivery/src/__tests__/user-purge-endpoint.test.ts` | Delivery user purge endpoint auth, response (2 tests) |
| `services/user-management/src/user/__tests__/disconnect.test.ts` | Disconnect function: success, not found, transaction wrapping (3 tests) |
| `services/user-management/src/purge/__tests__/executor.test.ts` | Purge executor: service calls, timeout signals, empty claims (3 tests) |
| `services/telegram-bridge/src/bot/handlers/__tests__/disconnect-command.test.ts` | Disconnect command: success, unregistered user, error handling (3 tests) |
| `services/voice-transcription/src/__tests__/audio-retention.test.ts` | Voice audio transient verification: no disk writes, no DB, in-memory only (3 tests) |

## Verification Results

- **Biome**: `pnpm biome check --write` -- No fixes needed. 121 pre-existing warnings (all `any` type warnings in existing code), 0 errors.
- **Tests**:
  - `packages/types`: 10 files, 162 tests passed
  - `services/ai-router`: 29 files passed, 298 tests passed (1 pre-existing integration test skipped due to no Postgres)
  - `services/scheduler`: 15 files, 84 tests passed
  - `services/delivery`: 7 files, 31 tests passed
  - `services/user-management`: 5 files passed, 48 tests passed (3 pre-existing integration tests skipped due to no Postgres)
  - `services/telegram-bridge`: 18 files, 84 tests passed
  - `services/voice-transcription`: 7 files, 53 tests passed

## Plan Deviations

1. **No integration tests with real Postgres**: The plan specified integration tests for cleanup and purge functions, but since Postgres is not available in this environment, only unit tests with mocked DB were written. Integration tests against real Postgres should be run in CI.

2. **Review finding MEDIUM-1 (no-op retry_count clause)**: The plan mentioned `retry_count = retry_count` in the failed request reset query. The implementation correctly omits this no-op clause -- the reset query only sets `status = 'pending'` and `error = null`, without touching `retry_count`.

3. **Review finding MEDIUM-2 (/disconnect unregistered user guard)**: Implemented as specified in the plan's notes -- `ctx.userId` is checked and handler returns early with appropriate message if absent.

## Residual Risks

1. **Integration tests require Postgres**: The retention cleanup and user purge functions use Drizzle ORM operations that should be validated against a real database. The CTE query in scheduler's `purgeUserCommandExecutionsAndKeys` is especially important to test with real Postgres.

2. **Migration not yet applied**: The `0002_data_purge_requests.sql` migration needs to be applied to the database before the purge executor can function.

3. **Docker Compose smoke tests not run**: Smoke tests against the live stack were not executed because the Docker environment is not available in this session. These should be run before marking the roadmap item complete.

4. **Delivery audits user_id is TEXT**: The purge query uses text comparison for `user_id` in the delivery audits table, which is correct but differs from the UUID type used in other services.
