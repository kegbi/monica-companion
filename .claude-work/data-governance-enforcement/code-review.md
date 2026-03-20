---
verdict: APPROVED
attempt: 1
biome_pass: true
tests_pass: true
test_summary: "types: 162 passed; ai-router: 298 passed (1 pre-existing integration skip); scheduler: 84 passed; delivery: 31 passed; user-management: 48 passed (3 pre-existing integration failures - no Postgres); telegram-bridge: 84 passed; voice-transcription: 53 passed"
critical_count: 0
high_count: 0
medium_count: 3
---

# Code Review: Data Governance Enforcement

## Automated Checks
- **Biome**: pass. 1 formatting error in `.claude-work/data-governance-enforcement/state.json` (missing trailing newline in work file, not production code). 147 warnings are all pre-existing `any` type warnings in existing code. Zero errors in new/changed production or test code.
- **Tests**:
  - `packages/types`: 10 files, 162 tests passed
  - `services/ai-router`: 29 files passed, 1 failed (pre-existing `repository.integration.test.ts` -- Postgres unavailable), 298 tests passed
  - `services/scheduler`: 15 files, 84 tests passed
  - `services/delivery`: 7 files, 31 tests passed
  - `services/user-management`: 5 files passed, 3 failed (pre-existing integration tests -- Postgres unavailable), 48 tests passed
  - `services/telegram-bridge`: 18 files, 84 tests passed
  - `services/voice-transcription`: 7 files, 53 tests passed

All failures are pre-existing integration tests that require a running Postgres instance. No new test failures introduced.

## Findings

### CRITICAL
(none)

### HIGH
(none)

### MEDIUM
1. [MEDIUM] `services/scheduler/src/__tests__/retention-cleanup-worker.test.ts:25-26` -- `vi.useFakeTimers()` and `vi.setSystemTime()` are called in `beforeEach` but `vi.useRealTimers()` is never called in `afterEach`. This can leak fake timers to subsequent test files in the same Vitest worker, causing flaky failures. -- **Fix:** Add `afterEach(() => { vi.useRealTimers(); });` after line 27.

2. [MEDIUM] `.env.example` -- New environment variables added to `docker-compose.yml` (`AI_ROUTER_URL` for scheduler, `AI_ROUTER_URL`/`SCHEDULER_URL`/`DELIVERY_URL`/`HTTP_TIMEOUT_MS` for user-management) are not documented in `.env.example`. While these have hardcoded defaults in docker-compose and are purely internal service URLs, `.env.example` serves as the canonical reference for all configurable env vars. -- **Fix:** Add a `# -- Data Governance / Purge` section to `.env.example` documenting `HTTP_TIMEOUT_MS` (the only one that is parameterized with `${HTTP_TIMEOUT_MS:-10000}` in docker-compose). The internal service URLs with hardcoded values are less critical to document but could be added for completeness.

3. [MEDIUM] `services/user-management/src/user/disconnect.ts:71-75` -- The `credentialAccessAuditLog` insert does not include an `action` field to distinguish a disconnection audit event from a normal credential access event. The existing schema only has `actorService` and `correlationId`, so there is no way to differentiate disconnect events from regular credential lookups in the audit log. This is a pre-existing schema limitation, not a bug in this implementation, but it reduces the audit trail's usefulness. -- **Fix:** Consider adding an `action` column to `credentialAccessAuditLog` in a future migration (out of scope for this task, but worth noting as a follow-up).

### LOW
1. [LOW] `services/ai-router/src/retention/user-purge-routes.ts:38-39` -- `userId` is logged directly in the structured log output. Per `security.md`, sensitive data should be redacted from logs. However, `userId` is an opaque UUID (not a Telegram user ID or personal data), and other existing endpoints in the codebase log `userId` the same way. This is consistent with the existing pattern. -- **Fix:** No action needed; UUIDs are opaque identifiers, not PII.

2. [LOW] `services/scheduler/src/workers/retention-cleanup-worker.ts:63-65` -- When `aiRouterResponse.ok` is false, the result is silently set to `{ purged: {} }` without logging the failure. Same pattern at line 77-79 for delivery. The overall job still succeeds, masking a partial failure. -- **Fix:** Add a `logger.warn()` call when `response.ok` is false, including the status code, to make partial failures visible in logs.

3. [LOW] `services/user-management/src/purge/executor.ts:56-58` -- The "claim pending requests" query uses `new Date()` for `claimedAt` and a separate `new Date()` in the WHERE clause for `purgeAfter` comparison. In theory, these could differ by a few milliseconds, but this is inconsequential in practice since `purgeAfter` is 30 days in the past. -- **Fix:** No action needed.

## Plan Compliance
The implementation closely follows the approved plan across all 12 steps:

1. **Zod schemas** (Step 1): Implemented as specified with per-service request schemas.
2. **AI-router retention cleanup** (Steps 2, 5): Correctly implements `purgeExpiredConversationTurns` and `purgeExpiredPendingCommands` with terminal-only deletion for pending commands.
3. **Scheduler retention cleanup** (Steps 3, 6): Correctly implements three local cleanup functions and the BullMQ repeatable job with configurable interval.
4. **Delivery retention cleanup** (Steps 4, 5): Correctly implements `purgeExpiredDeliveryAudits`.
5. **Separate Hono sub-apps** (Steps 5, 9): All new endpoints are mounted as separate sub-apps with per-endpoint caller allowlists, exactly as specified.
6. **CTE pattern** (Step 9): Scheduler user purge correctly uses a CTE to atomically delete command executions and their associated idempotency keys.
7. **Data purge requests table** (Step 7): Schema and migration match the plan exactly.
8. **Disconnect function** (Step 8): Transactional semantics with all four operations in a single `db.transaction()`.
9. **Purge executor** (Step 10): Implements stale reclaim with `claimed_at`, failed retry with `maxPurgeRetries`, atomic claim, and `AbortSignal.timeout()` on all outbound calls.
10. **Telegram /disconnect** (Step 11): Handler registered before text handler, unregistered user guard, graceful error message.
11. **Voice audio verification** (Step 12): Test-only step, no code changes, three verification tests.
12. **Docker Compose** (Step 6, 10): Correct env vars added, `ai-router` dependency added to scheduler.

**Justified deviations:**
- Integration tests with real Postgres were omitted (documented in impl-summary) because Postgres is not available in this environment. This is acceptable; they should run in CI.
- No smoke tests were run (Docker environment unavailable). Per `completion.md`, roadmap item should not be marked complete until smoke tests pass.

## Verdict Rationale
All automated checks pass (zero Biome errors in production/test code, zero new test failures). Zero CRITICAL or HIGH findings. The three MEDIUM findings are:
- A minor test hygiene issue (fake timer leak) that does not affect correctness.
- Missing `.env.example` documentation for new env vars (all have defaults).
- A pre-existing schema limitation in the audit log (no `action` column).

None of these represent security vulnerabilities, correctness bugs, or quality gate violations. The implementation is well-structured, follows the plan faithfully, enforces per-endpoint auth with correct caller allowlists, uses Zod validation on all contracts, applies timeouts on all external calls, and has comprehensive test coverage across all affected services.
