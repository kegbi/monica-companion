# Implementation Plan: Scheduler (Phase 4)

## Objective

Build the `scheduler` service as the single execution path for all confirmed mutating commands and scheduled reminder jobs. The scheduler must enforce idempotency at ingress, own job-level retries with dead-letter handling, provide execution observability through OpenTelemetry, and implement DST-aware daily/weekly reminder scheduling with bounded catch-up windows and duplicate-send prevention.

## Scope

### In Scope

- HTTP endpoint to accept confirmed command payloads from `ai-router` (Zod-validated, JWT-authenticated)
- Idempotency enforcement at scheduler ingress using `@monica-companion/idempotency` backed by PostgreSQL
- BullMQ-based job queue for command execution with configurable retry/backoff
- Command executor that maps `ConfirmedCommandPayload` to `monica-integration` write endpoints
- Dead-letter queue with redacted payloads and failure notifications to `delivery`
- Execution result reporting back (status update, delivery intent emission)
- BullMQ repeatable job for reminder schedule polling
- DST-aware wall-clock time computation using IANA timezones
- Schedule-window dedupe keys to prevent duplicate sends
- Bounded catch-up window (6 hours) for missed reminder windows
- New `GET /internal/users/with-schedules` endpoint in `user-management` for scheduler to enumerate users with active reminder schedules
- Docker Compose environment variable updates for scheduler
- OTel spans on all job processing, HTTP calls, and retry/DLQ events
- Structured logging with `@monica-companion/redaction` for queue payloads and dead letters

### Out of Scope

- Telegram-specific formatting (stays in `telegram-bridge` via `delivery`)
- Read-only query execution (stays in `ai-router`)
- Monica API client implementation (already exists in `monica-integration`)
- Delivery service implementation (separate roadmap item)
- Database migrations tooling (use existing Drizzle migration infrastructure)
- Multi-cron-per-user scheduling (V1 supports a single daily-or-weekly reminder)

## Affected Services & Packages

| Package/Service | Changes |
|-----------------|---------|
| `services/scheduler` | Major: implement command execution, reminder scheduling, BullMQ workers, HTTP endpoint, DB schema, idempotency, observability |
| `packages/idempotency` | Implement: PostgreSQL-backed idempotency store with key check/claim/complete/expire operations |
| `packages/types` | Add: `SchedulerExecuteRequest` schema, `ReminderDigestIntent` schema, `UserScheduleListResponse` schema |
| `services/user-management` | Add: `GET /internal/users/with-schedules` endpoint listing users with active reminder preferences |
| `docker-compose.yml` | Update: scheduler environment variables (JWT_SECRET, DATABASE_URL, REDIS_URL, service URLs, retry config) |

## Implementation Steps

### Step 1: Idempotency Package (`@monica-companion/idempotency`)

**What:** Implement the shared idempotency package with a PostgreSQL-backed store. This is a prerequisite for scheduler ingress validation.

**Files to create/modify:**
- `packages/idempotency/src/index.ts` -- export public API
- `packages/idempotency/src/store.ts` -- IdempotencyStore class with `check`, `claim`, `complete`, `release` methods
- `packages/idempotency/src/schema.ts` -- Drizzle table `idempotency_keys` (key TEXT PK, status TEXT, claimed_at TIMESTAMPTZ, completed_at TIMESTAMPTZ, result JSONB, expires_at TIMESTAMPTZ)
- `packages/idempotency/src/__tests__/store.test.ts` -- unit tests with mocked DB
- `packages/idempotency/src/__tests__/store.integration.test.ts` -- integration tests against real Postgres
- `packages/idempotency/package.json` -- add drizzle-orm, postgres dependencies

**Behavior:**
- `check(key)` returns `null` (not seen), `"in_progress"`, or `{ status: "completed", result }`.
- `claim(key, ttlMs)` atomically inserts if absent or returns existing. Uses `ON CONFLICT DO NOTHING` + select pattern.
- `complete(key, result)` transitions from in_progress to completed with stored result.
- `release(key)` removes an in_progress claim (for cleanup on failure before DLQ).
- Expired in_progress keys are reclaimable (guards against crashed workers).

**Expected outcome:** Shared package that any service can use for idempotent operation enforcement.

### Step 2: Scheduler Config and Database Schema

**What:** Define the scheduler's Zod-validated config and its Drizzle database schema.

**Files to create/modify:**
- `services/scheduler/src/config.ts` -- Zod config schema with PORT, DATABASE_URL, REDIS_URL, JWT_SECRET, JWT_SECRET_PREVIOUS, MONICA_INTEGRATION_URL, DELIVERY_URL, USER_MANAGEMENT_URL, SCHEDULER_MAX_RETRIES, SCHEDULER_RETRY_BACKOFF_MS, CATCH_UP_WINDOW_HOURS, REMINDER_POLL_INTERVAL_MS
- `services/scheduler/src/db/connection.ts` -- Drizzle database connection factory
- `services/scheduler/src/db/schema.ts` -- Drizzle tables:
  - `command_executions` (id UUID PK, pending_command_id UUID, idempotency_key TEXT UNIQUE, user_id UUID, command_type TEXT, payload JSONB, status TEXT [queued/processing/completed/failed/dead_lettered], correlation_id TEXT, attempt_count INT, last_error TEXT, queued_at TIMESTAMPTZ, started_at TIMESTAMPTZ, completed_at TIMESTAMPTZ, created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ)
  - `reminder_windows` (id UUID PK, user_id UUID, dedupe_key TEXT UNIQUE, cadence TEXT, scheduled_at TIMESTAMPTZ, fired_at TIMESTAMPTZ, status TEXT [pending/sent/skipped/catch_up], created_at TIMESTAMPTZ)
- `services/scheduler/src/__tests__/config.test.ts` -- config validation tests
- `services/scheduler/package.json` -- add dependencies: bullmq, ioredis, drizzle-orm, postgres, zod, @monica-companion/auth, @monica-companion/types, @monica-companion/idempotency, @monica-companion/redaction, @monica-companion/observability

**Expected outcome:** Scheduler has typed config, DB schema, and connection setup.

### Step 3: Command Execution HTTP Endpoint

**What:** Add the `POST /internal/execute` endpoint that accepts confirmed command payloads from `ai-router`, validates them, checks idempotency, and enqueues to BullMQ.

**Files to create/modify:**
- `services/scheduler/src/routes/execute.ts` -- Hono route handler:
  1. Validate JWT with `serviceAuth({ audience: "scheduler", allowedCallers: ["ai-router"] })`
  2. Parse body with `ConfirmedCommandPayloadSchema`
  3. Check idempotency key via `IdempotencyStore.check()`
  4. If already completed, return the stored result (200)
  5. If in_progress, return 409 Conflict
  6. Claim the idempotency key
  7. Insert into `command_executions` table
  8. Add to BullMQ `command-execution` queue
  9. Return 202 Accepted with execution ID
- `services/scheduler/src/app.ts` -- mount route
- `services/scheduler/src/__tests__/execute.test.ts` -- unit tests: valid payload accepted, invalid payload rejected (400), duplicate key returns existing result, auth rejected for non-ai-router callers

**Expected outcome:** Scheduler has a working ingress endpoint that validates, deduplicates, and enqueues confirmed commands.

### Step 4: Command Execution Worker

**What:** Implement the BullMQ worker that processes command execution jobs by calling `monica-integration` write endpoints.

**Files to create/modify:**
- `services/scheduler/src/workers/command-worker.ts` -- BullMQ Worker for `command-execution` queue:
  1. Read job data (ConfirmedCommandPayload + executionId)
  2. Create OTel span `scheduler.execute_command`
  3. Map command type to `monica-integration` endpoint using `@monica-companion/auth` `createServiceClient`
  4. Call the appropriate write endpoint on `monica-integration`
  5. On success: update `command_executions` status to `completed`, complete idempotency key, emit success delivery intent to `delivery`
  6. On failure: let BullMQ retry with exponential backoff (configurable max retries, initial delay)
  7. On final failure: move to dead-letter, update status to `dead_lettered`, emit error delivery intent to `delivery`, redact payload in DLQ
- `services/scheduler/src/lib/command-mapper.ts` -- maps `MutatingCommandPayload` discriminated union to `monica-integration` HTTP calls (create_contact -> POST /internal/contacts, create_note -> POST /internal/contacts/:contactId/notes, etc.)
- `services/scheduler/src/lib/delivery-client.ts` -- sends `OutboundMessageIntent` to delivery service
- `services/scheduler/src/__tests__/command-worker.test.ts` -- unit tests with mocked monica-integration and delivery clients
- `services/scheduler/src/__tests__/command-mapper.test.ts` -- unit tests for each command type mapping

**Expected outcome:** Commands flow from BullMQ queue through to `monica-integration` with proper retry/DLQ behavior.

### Step 5: Reminder Schedule Time Computation

**What:** Implement DST-aware wall-clock time computation for reminder scheduling. This is the pure logic layer with no I/O dependencies.

**Files to create/modify:**
- `services/scheduler/src/lib/schedule-time.ts` -- pure functions:
  - `computeNextFiringUtc(timezone: string, localTime: string, cadence: "daily" | "weekly", now: Date): Date` -- converts user's local wall-clock time to the next UTC firing instant, handling DST transitions
  - `computeDedupeKey(userId: string, cadence: string, localDate: string): string` -- deterministic dedupe key: `reminder:${userId}:${cadence}:${localDate}` for daily or `reminder:${userId}:${cadence}:${isoWeek}` for weekly
  - `isWithinCatchUpWindow(scheduledUtc: Date, now: Date, windowHours: number): boolean` -- returns true if `now - scheduledUtc <= windowHours`
  - `resolveSpringForward(timezone: string, localTime: string, localDate: string): Date` -- when the scheduled local time does not exist (spring forward), returns the next valid local minute
  - `resolveFallBack(timezone: string, localTime: string, localDate: string): Date` -- when the local time repeats (fall back), returns the first occurrence
- `services/scheduler/src/__tests__/schedule-time.test.ts` -- comprehensive tests:
  - Normal daily/weekly scheduling
  - Spring forward: scheduled time 02:30 in America/New_York on DST transition day -> fires at 03:00
  - Fall back: scheduled time 01:30 in America/New_York on DST transition day -> fires only once
  - Dedupe key uniqueness per schedule window
  - Catch-up window boundary tests (exactly 6h, 6h+1ms, 5h59m)
  - Various IANA timezones (UTC, Asia/Tokyo, Europe/London, America/Los_Angeles, Australia/Lord_Howe with 30-min offset)

**Implementation note:** Use `Intl.DateTimeFormat` with `timeZone` option for DST resolution. No external timezone library needed -- Node.js 24 has full ICU data.

**Expected outcome:** Pure, thoroughly tested functions for DST-aware schedule time computation.

### Step 6: User Schedule List Endpoint in user-management

**What:** Add an endpoint in `user-management` that lets the scheduler enumerate all users with active reminder schedules.

**Files to create/modify:**
- `services/user-management/src/user/repository.ts` -- add `listUsersWithSchedules(db): Promise<Array<{ userId, reminderCadence, reminderTime, timezone, connectorType, connectorRoutingId }>>` -- queries `user_preferences` for all users where `reminder_cadence` is not `"none"`
- `services/user-management/src/app.ts` -- add `GET /internal/users/with-schedules` route with `schedulerAuth` (caller: scheduler only)
- `packages/types/src/user-management.ts` -- add `UserScheduleListResponse` Zod schema
- `packages/types/src/index.ts` -- export new schema
- `services/user-management/src/__tests__/app.test.ts` -- test the new endpoint

**Expected outcome:** Scheduler can fetch all users who need reminder processing.

### Step 7: Reminder Polling Worker

**What:** Implement the BullMQ repeatable job that polls for users with pending reminders and enqueues individual reminder jobs.

**Files to create/modify:**
- `services/scheduler/src/workers/reminder-poller.ts` -- BullMQ Worker for `reminder-poll` queue (repeatable, runs every 1 minute):
  1. Fetch all users with schedules from `user-management` via `GET /internal/users/with-schedules`
  2. For each user, compute the next firing time using `computeNextFiringUtc()`
  3. Check if a firing is due (now >= firingUtc)
  4. Compute the dedupe key for the current schedule window
  5. Attempt to insert into `reminder_windows` table (UNIQUE constraint on dedupe_key prevents duplicates)
  6. If dedupe key already exists -> skip (already fired/in progress)
  7. If insert succeeds -> enqueue a `reminder-execute` job for this user
- `services/scheduler/src/workers/reminder-executor.ts` -- BullMQ Worker for `reminder-execute` queue:
  1. Fetch upcoming reminders from `monica-integration` via `GET /internal/reminders/upcoming`
  2. Format a reminder digest (connector-neutral text content)
  3. Emit `OutboundMessageIntent` to `delivery` with content type `text`
  4. Update `reminder_windows` status to `sent`
  5. On failure: retry with backoff; on final failure: emit error notification to `delivery`
- `services/scheduler/src/__tests__/reminder-poller.test.ts` -- unit tests
- `services/scheduler/src/__tests__/reminder-executor.test.ts` -- unit tests

**Expected outcome:** Reminders are polled, deduped, and executed per-user with proper failure handling.

### Step 8: Catch-Up Logic for Missed Reminder Windows

**What:** Implement the bounded catch-up behavior: if the scheduler was down and recovers within 6 hours of a missed window, send one catch-up digest; otherwise skip.

**Files to create/modify:**
- `services/scheduler/src/workers/reminder-poller.ts` -- extend the polling logic:
  1. After computing the current window, also check if there are missed windows (firingUtc < now and no corresponding `reminder_windows` row)
  2. For each missed window: check `isWithinCatchUpWindow(scheduledUtc, now, catchUpWindowHours)`
  3. If within window: insert with status `catch_up` and enqueue the reminder-execute job
  4. If outside window: insert with status `skipped` (prevents future re-processing)
  5. At most one catch-up digest per missed window
- `services/scheduler/src/__tests__/catch-up.test.ts` -- tests:
  - Scheduler down for 3 hours -> sends catch-up digest
  - Scheduler down for 7 hours -> skips
  - Scheduler down for exactly 6 hours -> sends (boundary)
  - Multiple missed windows -> each evaluated independently
  - Catch-up digest is sent at most once

**Expected outcome:** Missed reminders are caught up within the 6-hour grace window.

### Step 9: Observability and Redaction

**What:** Add OTel instrumentation inline with workers (during implementation, not as a separate step) and ensure dead-letter payloads are redacted.

**Files to create/modify:**
- `services/scheduler/src/lib/dead-letter.ts` -- dead-letter handler that:
  1. Redacts the job payload using `@monica-companion/redaction`
  2. Logs the DLQ entry with structured attributes (jobId, queue, error, attempt count)
  3. Updates the execution record status to `dead_lettered`
- `services/scheduler/src/__tests__/dead-letter.test.ts` -- tests that sensitive data is redacted

OTel spans are added inline in Steps 3, 4, 7 (not as a separate pass).

**Expected outcome:** Every job and HTTP call is traceable via OTel spans. Dead-letter payloads never contain sensitive data.

### Step 10: Graceful Startup, Shutdown, and Docker Compose Wiring

**What:** Wire up the scheduler's BullMQ workers, HTTP server, and graceful shutdown. Update Docker Compose and env vars.

**Files to create/modify:**
- `services/scheduler/src/index.ts` -- update to:
  1. Load and validate config
  2. Create DB connection
  3. Create Redis connection (for BullMQ)
  4. Create IdempotencyStore
  5. Start BullMQ workers (command-execution, reminder-poll, reminder-execute)
  6. Start Hono HTTP server
  7. Graceful shutdown: close workers, drain queues, close DB, close Redis, flush telemetry
- `services/scheduler/src/app.ts` -- update to accept config, db, idempotencyStore dependencies; mount /internal/execute route
- `services/scheduler/package.json` -- add all new dependencies (bullmq, ioredis, drizzle-orm, postgres, @monica-companion/auth, @monica-companion/types, @monica-companion/idempotency, @monica-companion/redaction)
- `docker-compose.yml` -- update scheduler service environment
- `.env.example` -- document new scheduler env vars

**Expected outcome:** Scheduler starts with all workers and HTTP server, shuts down cleanly, and is properly wired in Docker Compose.

### Step 11: Database Migrations

**What:** Create Drizzle migrations for the new tables.

**Files to create/modify:**
- `services/scheduler/drizzle.config.ts` -- Drizzle Kit config
- Migration SQL for `idempotency_keys`, `command_executions`, `reminder_windows` tables
- Migration files in `services/scheduler/migrations/`

**Expected outcome:** All new tables can be created via migration.

## Test Strategy

### Unit Tests (Vitest)

| Test File | What to test | What to mock |
|-----------|--------------|--------------|
| `packages/idempotency/src/__tests__/store.test.ts` | check/claim/complete/release operations, expired key reclaim | Drizzle DB queries |
| `services/scheduler/src/__tests__/config.test.ts` | Config parsing, defaults, validation errors | Process.env |
| `services/scheduler/src/__tests__/execute.test.ts` | Endpoint validation, auth rejection, idempotency check, duplicate detection | IdempotencyStore, BullMQ Queue |
| `services/scheduler/src/__tests__/command-mapper.test.ts` | Each command type maps to correct monica-integration endpoint/payload | None (pure function) |
| `services/scheduler/src/__tests__/command-worker.test.ts` | Success path, retry on Monica error, DLQ on exhaustion, delivery intent emission | HTTP fetch to monica-integration and delivery |
| `services/scheduler/src/__tests__/schedule-time.test.ts` | DST spring-forward, fall-back, dedupe keys, catch-up window boundaries, multiple IANA timezones | None (pure functions) |
| `services/scheduler/src/__tests__/reminder-poller.test.ts` | User enumeration, window deduplication, catch-up evaluation | User-management client, DB |
| `services/scheduler/src/__tests__/reminder-executor.test.ts` | Reminder fetch, digest formatting, delivery emission, failure handling | Monica-integration client, delivery client |
| `services/scheduler/src/__tests__/dead-letter.test.ts` | Payload redaction, structured logging | @monica-companion/redaction |
| `services/scheduler/src/__tests__/catch-up.test.ts` | Within-window sends, outside-window skips, boundary cases | Schedule-time functions, DB |

### Integration Tests (real Postgres + Redis)

| Test File | What to test |
|-----------|--------------|
| `packages/idempotency/src/__tests__/store.integration.test.ts` | Idempotency key lifecycle against real Postgres |
| `services/scheduler/src/__tests__/execute.integration.test.ts` | Full endpoint flow: HTTP request -> idempotency check -> BullMQ enqueue |
| `services/scheduler/src/__tests__/reminder-windows.integration.test.ts` | Dedupe key uniqueness constraint in real Postgres |

### TDD Sequence

For each step, the failing test comes first:

1. **Step 1 (Idempotency):** Write `store.test.ts` with `check()` returning null for unknown key -> implement.
2. **Step 3 (Execute endpoint):** Write test: POST with valid confirmed payload returns 202 -> implement route.
3. **Step 4 (Command worker):** Write test: worker calls correct monica-integration endpoint -> implement.
4. **Step 5 (Schedule time):** Write test: computeNextFiringUtc for America/New_York at 08:00 returns correct UTC -> implement.
5. **Step 7 (Reminder poller):** Write test: poller fetches users and enqueues jobs for due reminders -> implement.

## Smoke Test Strategy

### Services to start:
```bash
docker compose up -d postgres redis
docker compose --profile app up -d scheduler
```

### HTTP checks:

1. **Health check:** `GET /health` -> `{"status":"ok","service":"scheduler"}`
2. **Auth rejection:** POST /internal/execute without token -> 401
3. **Command execution with valid JWT:** POST /internal/execute -> 202 Accepted
4. **Idempotency replay:** Same request -> 200 with existing result
5. **No public exposure:** Verify scheduler is not reachable through Caddy

## Security Considerations

1. **Service-to-service auth:** `POST /internal/execute` uses `serviceAuth` with `allowedCallers: ["ai-router"]`
2. **Per-endpoint caller allowlists:** Each endpoint has its own allowlist
3. **No public exposure:** Scheduler is on the `internal` network only
4. **Idempotency enforcement:** Prevents duplicate command execution
5. **Redaction:** Dead-letter payloads are redacted via `@monica-companion/redaction`
6. **Credential access:** Scheduler never directly accesses Monica credentials; calls `monica-integration` instead

## Risks & Open Questions

1. **BullMQ version:** Must verify latest stable on npm and pin exactly
2. **Delivery service dependency:** Delivery is the next roadmap item; delivery client should handle failures gracefully since delivery may not be fully implemented yet
3. **User enumeration for reminders:** For V1 with expected small user counts, a full list is acceptable; pagination needed later
4. **Catch-up window races:** Dedupe key UNIQUE constraint ensures only one instance fires a given window
5. **Node.js ICU data:** Verify node:24-slim includes full ICU for timezone support
6. **Reminder poll frequency:** 1-minute interval means up to 1 minute late; acceptable for V1
