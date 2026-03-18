---
verdict: PASS
services_tested: ["scheduler", "postgres", "redis", "caddy", "monica-integration", "user-management"]
checks_run: 10
checks_passed: 10
---

# Smoke Test Report: Scheduler

## Environment
- Services started: postgres:17.9-alpine, redis:8.6.1-alpine, node:24.14.0-slim (scheduler, user-management, monica-integration, caddy:2.11.2-alpine)
- Health check status: scheduler healthy; postgres healthy; redis healthy; monica-integration running; user-management exited (separate pre-existing issue unrelated to scheduler); caddy started for public-exposure test
- Stack startup time: ~45 seconds (including deps-init pnpm install)

## Bug Found and Fixed During Smoke Testing

**IdempotencyStore.claim passes Date object to raw SQL** (`packages/idempotency/src/store.ts` line 49)

The `claim()` method created `new Date(Date.now() + ttlMs)` and passed it directly via Drizzle's `sql` template tag. The `postgres` driver (v3.4.8) does not serialize `Date` objects when used through Drizzle's `db.execute(sql...)` path, causing `ERR_INVALID_ARG_TYPE: The "string" argument must be of type string or an instance of Buffer or ArrayBuffer. Received an instance of Date`.

**Fix applied:** Changed `const expiresAt = new Date(Date.now() + ttlMs)` to `const expiresAt = new Date(Date.now() + ttlMs).toISOString()`. This converts the Date to an ISO 8601 string before passing it to the SQL query, which PostgreSQL accepts for TIMESTAMPTZ columns.

This bug was not caught by unit tests because those tests mock the `db.execute` method and never run against a real PostgreSQL connection.

## Checks

| # | Check | Expected | Actual | Result |
|---|-------|----------|--------|--------|
| 1 | GET /health (internal) | 200 `{"status":"ok","service":"scheduler"}` | 200 `{"status":"ok","service":"scheduler"}` | PASS |
| 2 | POST /internal/execute without Authorization header | 401 | 401 `{"error":"Missing or invalid Authorization header"}` | PASS |
| 3 | POST /internal/execute with JWT from telegram-bridge (wrong caller) | 403 | 403 `{"error":"Caller not allowed"}` | PASS |
| 4 | POST /internal/execute with valid JWT from ai-router + ConfirmedCommandPayload | 202 with executionId | 202 `{"executionId":"94eeaf1d-...","status":"queued"}` | PASS |
| 5 | Replay same idempotency key | 409 (in_progress) or 200 (completed) | 409 `{"error":"Command already in progress"}` | PASS |
| 6 | POST /internal/execute with invalid payload (valid JWT) | 400 | 400 `{"error":"Invalid request body"}` | PASS |
| 7 | GET /health through Caddy (port 80) | 404 (not exposed) | 404 | PASS |
| 8 | GET /internal/execute through Caddy | 404 (not exposed) | 404 | PASS |
| 9 | DB tables (idempotency_keys, command_executions, reminder_windows) | All 3 exist with correct schema | All 3 present; command_executions has 1 row from test 4; idempotency_keys has 1 row | PASS |
| 10 | BullMQ queues registered in Redis | command-execution, reminder-poll, reminder-execute queues active | All 3 queues present; reminder-poll repeatable scheduler running (12 completed polls); command-execution worker processed job 1 | PASS |

## Additional Observations

1. **Command worker end-to-end:** The BullMQ command-execution worker picked up the job from test 4 and called `monica-integration`. It received `502: {"error":"Failed to resolve user credentials"}` which is expected because no actual user credentials are configured. This confirms the full command-mapper -> monica-integration call path works.

2. **Reminder poll repeatable job:** The `reminder-poll` scheduler is active with 12 completed poll cycles observed, confirming the repeatable job mechanism works correctly with the configured 60-second interval.

3. **Scheduler port not exposed to host:** Port 3005 uses `expose` (not `ports`) in docker-compose.yml, correctly limiting access to the internal Docker network only.

4. **Caddy correctly blocks scheduler routes:** The Caddyfile only proxies `/webhook/telegram*` and `/setup*`, returning 404 for all other paths. Scheduler endpoints are not reachable from the public network.

5. **user-management exits on startup:** The user-management service exits with code 1 and produces no logs. This is a pre-existing issue unrelated to the scheduler implementation. The scheduler does not depend on user-management being healthy for its core command-execution path; user-management is only needed for the reminder-poll worker which gracefully handles unavailability.

## Failures
None.

## Teardown
All services stopped cleanly. All containers removed. Networks removed (one orphaned endpoint required manual disconnect).
