---
verdict: FAIL
services_tested: ["ai-router", "delivery", "scheduler", "user-management", "voice-transcription"]
checks_run: 72
checks_passed: 62
---

# Smoke Test Report: Data Governance Enforcement

## Environment
- Services started: postgres (17.9-alpine), redis (8.6.1-alpine), caddy (2.11.2-alpine), ai-router, delivery, scheduler, user-management, voice-transcription, telegram-bridge, monica-integration, web-ui (all node:24.14.0-slim)
- Health check status: ai-router, delivery, scheduler, user-management -- HEALTHY. voice-transcription -- NOT REACHABLE (pre-existing, unrelated).
- Stack startup time: ~45 seconds
- Migration 0002_data_purge_requests.sql applied manually.
## Vitest Smoke Suite
- Exit code: 1
- Test files: 4 passed, 3 failed / 7 total
- Tests: 62 passed, 10 failed / 72 total
- New tests added: data-governance.smoke.test.ts (21 tests)

## Custom Checks

| # | Check | Expected | Actual | Result |
|---|-------|----------|--------|--------|
| 1 | ai-router POST /internal/retention-cleanup (scheduler) | 200 | 403 | FAIL |
| 2 | delivery POST /internal/retention-cleanup (scheduler) | 200 | 200 | PASS |
| 3 | ai-router retention-cleanup invalid payload | 400 | 403 | FAIL |
| 4 | delivery retention-cleanup invalid payload | 400 | 400 | PASS |
| 5 | ai-router retention-cleanup wrong caller | 403 | 403 | PASS |
| 6 | delivery retention-cleanup wrong caller | 403 | 403 | PASS |
| 7 | ai-router user purge wrong caller | 403 | 403 | PASS |
| 8 | delivery user purge wrong caller | 403 | 403 | PASS |
| 9 | scheduler user purge wrong caller | 403 | 403 | PASS |
| 10 | ai-router retention-cleanup no auth | 401 | 401 | PASS |
| 11 | delivery retention-cleanup no auth | 401 | 401 | PASS |
| 12 | ai-router user purge (user-management) | 200 | 403 | FAIL |
| 13 | scheduler user purge (user-management) | 200 | 500 | FAIL |
| 14 | delivery user purge (user-management) | 200 | 403 | FAIL |
| 15 | ai-router user purge invalid UUID | 400 | 403 | FAIL |
| 16 | disconnect non-existent user | 404 | 404 | PASS |
| 17 | disconnect seeded user + credential revocation | 200 | 200 | PASS |
| 18 | disconnect wrong caller | 403 | 403 | PASS |
| 19 | disconnect invalid UUID | 400 | 400 | PASS |
| 20 | data_purge_requests table columns | present | present | PASS |
| 21 | data_purge_requests indexes | present | present | PASS |
## Failures

### Failure 1: ai-router Hono sub-app middleware ordering (CRITICAL)

**Affected checks:** #1, #3, #12, #15

**Root cause:** In services/ai-router/src/app.ts, four Hono sub-apps are mounted at the same /internal prefix. The first sub-app has serviceAuth with allowedCallers: ["telegram-bridge"] applied as a global middleware. When a request arrives at /internal/retention-cleanup, Hono evaluates sub-apps in registration order. The first sub-app middleware fires for ALL paths under /internal and rejects the scheduler/user-management caller with 403 before the retentionRoutes or userPurgeRoutes sub-app ever gets to handle it.

**Evidence:** delivery retention-cleanup works because its internal sub-app allows scheduler. ai-router fails because its internal sub-app only allows telegram-bridge.

**Fix:** Mount retention and user-purge routes at distinct path prefixes, or use path-scoped auth middleware in the internal sub-app (e.g., internal.use("/process", serviceAuth({allowedCallers: ["telegram-bridge"]}))).

### Failure 2: Scheduler CTE query error

**Affected check:** #13

**Root cause:** scheduler/src/retention/user-purge.ts:30 fails with TypeError: Cannot read properties of undefined (reading "executions_deleted"). The CTE query result format does not match what the code expects.

**Fix:** Handle empty/undefined result case in purgeUserCommandExecutionsAndKeys.

### Failure 3: delivery user-purge middleware collision

**Affected check:** #14

**Root cause:** Same Hono sub-app ordering issue. delivery/src/app.ts first internal sub-app has allowedCallers: ["ai-router", "scheduler"]. user-management caller is blocked.

### Pre-existing: voice-transcription unreachable

4 tests affected. Unrelated to data governance.

## What Passed

- Disconnect endpoint: full flow works (credential revocation, purge request, audit log).
- Migration: data_purge_requests table created correctly.
- Auth enforcement for wrong callers (403) on all new endpoints.
- Auth enforcement for missing auth (401) on retention-cleanup.
- Delivery retention-cleanup works correctly.
- All pre-existing tests pass (except voice-transcription).

## Teardown

All services stopped cleanly. No orphaned containers.