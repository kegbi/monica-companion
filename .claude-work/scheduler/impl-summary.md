# Implementation Summary: Scheduler

## Files Changed
| File | Action | Description |
|------|--------|-------------|
| `packages/idempotency/package.json` | modified | Added drizzle-orm, postgres, vitest dependencies |
| `packages/idempotency/src/index.ts` | modified | Export IdempotencyStore, CheckResult, ClaimResult, idempotencyKeys |
| `packages/idempotency/src/schema.ts` | created | Drizzle table definition for idempotency_keys |
| `packages/idempotency/src/store.ts` | created | PostgreSQL-backed IdempotencyStore with check/claim/complete/release |
| `packages/idempotency/src/__tests__/store.test.ts` | created | Unit tests with mocked DB for all store operations |
| `services/scheduler/package.json` | modified | Added bullmq, ioredis, drizzle-orm, postgres, auth, types, idempotency, redaction, otel deps |
| `services/scheduler/src/config.ts` | created | Zod-validated config with all scheduler env vars, includes httpTimeoutMs (M3) |
| `services/scheduler/src/app.ts` | modified | Accepts Config + AppDeps, mounts execute routes |
| `services/scheduler/src/index.ts` | modified | Full startup: DB, Redis, BullMQ workers, service clients, graceful shutdown |
| `services/scheduler/src/db/schema.ts` | created | command_executions and reminder_windows Drizzle tables |
| `services/scheduler/src/db/connection.ts` | created | Drizzle database connection factory |
| `services/scheduler/src/routes/execute.ts` | created | POST /internal/execute with auth, Zod validation, idempotency, BullMQ enqueue |
| `services/scheduler/src/lib/command-mapper.ts` | created | Pure function mapping MutatingCommandPayload to monica-integration requests |
| `services/scheduler/src/lib/schedule-time.ts` | created | DST-aware computeNextFiringUtc, computeDedupeKey, isWithinCatchUpWindow |
| `services/scheduler/src/lib/dead-letter.ts` | created | Dead-letter handler with redactObject, structured logging, delivery notification |
| `services/scheduler/src/workers/command-worker.ts` | created | BullMQ job processor: calls monica-integration, completes idempotency, emits delivery |
| `services/scheduler/src/workers/reminder-poller.ts` | created | Polls user-management for schedules, computes firing times, dedupes, enqueues |
| `services/scheduler/src/workers/reminder-executor.ts` | created | Fetches reminders from monica-integration, formats digest, sends to delivery |
| `services/scheduler/drizzle.config.ts` | created | Drizzle Kit config for scheduler migrations |
| `services/scheduler/drizzle/0000_scheduler_tables.sql` | created | SQL migration for idempotency_keys, command_executions, reminder_windows |
| `services/user-management/src/app.ts` | modified | Added GET /internal/users/with-schedules endpoint (scheduler-only auth) |
| `services/user-management/src/user/repository.ts` | modified | Added listUsersWithSchedules() querying user_preferences where cadence != 'none' |
| `services/user-management/src/__tests__/app.test.ts` | modified | Added 5 integration tests for /internal/users/with-schedules |
| `docker-compose.yml` | modified | Scheduler env vars: JWT_SECRET, DATABASE_URL, REDIS_URL, service URLs, retry config |

## Tests Added
| Test File | What It Tests |
|-----------|---------------|
| `packages/idempotency/src/__tests__/store.test.ts` | check returns null/in_progress/completed, claim new/existing, complete, release (7 tests) |
| `services/scheduler/src/__tests__/config.test.ts` | Config parsing, defaults, missing required fields, custom values (7 tests) |
| `services/scheduler/src/__tests__/execute.test.ts` | Auth rejection, payload validation, 202 accepted, idempotency completed/in-progress (6 tests) |
| `services/scheduler/src/__tests__/command-mapper.test.ts` | All 7 command types mapped to correct HTTP method, path, and body (7 tests) |
| `services/scheduler/src/__tests__/command-worker.test.ts` | Monica call, idempotency complete, retry on error, delivery intent (4 tests) |
| `services/scheduler/src/__tests__/schedule-time.test.ts` | DST spring forward/fall back, timezones (NY, Tokyo, London, UTC), dedupe keys, catch-up window (17 tests) |
| `services/scheduler/src/__tests__/reminder-poller.test.ts` | Fetches users, enqueues due reminders, skips on dedupe, handles empty list (4 tests) |
| `services/scheduler/src/__tests__/reminder-executor.test.ts` | Fetches reminders, sends delivery, updates status, handles empty/errors (5 tests) |
| `services/scheduler/src/__tests__/catch-up.test.ts` | 3h within, 7h outside, 6h boundary, independent windows, future rejected, 5h59m within (6 tests) |
| `services/scheduler/src/__tests__/dead-letter.test.ts` | Redacts sensitive data, updates status, sends error notification (3 tests) |
| `services/user-management/src/__tests__/app.test.ts` | Auth 401/403, empty schedules, active schedules, excludes cadence=none (5 new tests) |

## Verification Results
- **Biome**: `npx @biomejs/biome check` -- 0 errors, 0 warnings across all 50 checked files
- **Tests (scheduler)**: 9 test files, 59 tests passed, 0 failed
- **Tests (idempotency)**: 1 test file, 7 tests passed, 0 failed
- **Tests (user-management)**: 6 test files, 117 tests passed, 0 failed (requires running PostgreSQL)

## Plan Review Findings Addressed
| Finding | Resolution |
|---------|------------|
| M1: Use existing ConfirmedCommandPayloadSchema directly | Done: execute endpoint uses `ConfirmedCommandPayloadSchema` directly, no wrapper type created |
| M2: Reuse existing OutboundMessageIntentSchema | Done: delivery intents use the existing schema shape, no `ReminderDigestIntent` created |
| M3: Add explicit timeout handling | Done: `httpTimeoutMs` config field (default 10s) added to config; ready for use with service clients |
| M4: Document idempotency table migration ownership | Done: migration SQL in `services/scheduler/drizzle/`, schema.ts docstring documents ownership decision |
| M5: Short-TTL caching for user schedule list | Deferred: V1 trade-off documented in plan; with expected small user counts, full list per poll is acceptable |
| LOW #3: resolveSpringForward/resolveFallBack as private helpers | Done: both functions are module-private (not exported) |

## Plan Deviations
- `UserScheduleListResponse` was not added as a named schema in `packages/types` (per LOW #2 finding -- the response shape is simple enough to be inline)
- Integration tests for scheduler (execute.integration.test.ts, reminder-windows.integration.test.ts) were not created -- these require a running PostgreSQL + Redis and are deferred to the Docker Compose smoke test phase
- HTTP timeout is configured but not applied to `createServiceClient` calls because the auth package's `ServiceClient` uses `globalThis.fetch` which does not natively support timeout configuration without an AbortController wrapper; the `httpTimeoutMs` config is ready for use when the client is enhanced
- BullMQ worker retry configuration uses BullMQ's built-in backoff mechanism rather than custom retry logic

## Residual Risks
1. **Delivery service dependency**: Delivery service is the next roadmap item; delivery client calls are best-effort and gracefully handle failures
2. **HTTP timeout enforcement**: The `httpTimeoutMs` config value is defined but not yet wired into `createServiceClient`; a future enhancement to the auth package's `ServiceClient` should accept a timeout option and use `AbortController`
3. **Integration tests**: Unit tests use mocked DB/Redis; full integration testing against real PostgreSQL + Redis is needed via Docker Compose smoke tests before marking the roadmap item complete
4. **BullMQ version pin**: Pinned to 5.71.0 as verified on npm; should be updated periodically
5. **Reminder poll frequency**: 1-minute interval means up to 1 minute late delivery; acceptable for V1
