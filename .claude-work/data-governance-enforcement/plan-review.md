---
verdict: REJECTED
attempt: 1
critical_count: 0
high_count: 1
medium_count: 5
---

# Plan Review: Data Governance Enforcement

## Findings

### CRITICAL
(none)

### HIGH

1. [HIGH] **Step 9: Scheduler user-data purge has an idempotency key deletion ordering bug.** The plan states: "Deletes all `command_executions` for the user, then deletes `idempotency_keys` whose `key` matches any deleted execution's `idempotency_key` (sub-select)." If `command_executions` rows are deleted first, a subsequent sub-select `FROM command_executions WHERE user_id = :userId` returns zero rows because those rows no longer exist. This leaves orphaned `idempotency_keys` entries, violating the 30-day data purge commitment from the data governance spec. -- **Fix:** Specify that the implementation must use a PostgreSQL CTE: `WITH deleted AS (DELETE FROM command_executions WHERE user_id = :userId RETURNING idempotency_key) DELETE FROM idempotency_keys WHERE key IN (SELECT idempotency_key FROM deleted)`. Alternatively, explicitly state the keys must be collected before the executions are deleted.

### MEDIUM

1. [MEDIUM] **Steps 5 and 9: Auth middleware routing conflicts with existing code patterns.** In `services/ai-router/src/app.ts`, the existing `/internal` Hono sub-app applies a shared `serviceAuth` with `allowedCallers: config.inboundAllowedCallers` (defaults to `["telegram-bridge"]`) to ALL routes mounted under it. The plan's new endpoints (`/internal/retention-cleanup` caller: scheduler, `/internal/users/:userId/data` caller: user-management) require different caller allowlists. Similarly, `services/delivery/src/app.ts` has a shared `serviceAuth` with `allowedCallers: ["ai-router", "scheduler"]`; the user-data purge endpoint needs `["user-management"]` which is not in that list. Per `security.md` rule: "Each service must enforce per-endpoint caller allowlists." -- **Fix:** Explicitly state in Steps 5 and 9 that the new retention and purge routes must be mounted as separate Hono sub-apps with their own per-endpoint `serviceAuth` middleware, not added to the existing shared-auth `internal` sub-app.

2. [MEDIUM] **Step 6: Misleading config name `DEAD_LETTER_RETENTION_DAYS`.** This config controls the retention period for `idempotency_keys` and `reminder_windows`, neither of which are dead-letter payloads. Dead-letter payloads in BullMQ Redis are already handled by `removeOnFail` count limits. -- **Fix:** Rename to `TRANSIENT_DATA_RETENTION_DAYS` or split into `IDEMPOTENCY_KEY_RETENTION_DAYS` and `REMINDER_WINDOW_RETENTION_DAYS`.

3. [MEDIUM] **Step 8: Disconnect endpoint does not specify transactional semantics.** The endpoint performs four sequential database operations: (1) revoke credentials, (2) invalidate setup tokens, (3) insert purge request, (4) insert audit log. If any intermediate operation fails, the system enters an inconsistent state. -- **Fix:** Explicitly state that all four database operations must execute within a single database transaction.

4. [MEDIUM] **Step 11: `/disconnect` command handler registration ordering not specified.** In grammY, middleware runs in registration order. If `bot.command("disconnect", ...)` is registered after `bot.on("message:text", ...)`, the text handler will process `/disconnect` as regular user input and forward it to ai-router. -- **Fix:** Specify that `bot.command("disconnect", ...)` must be registered BEFORE `bot.on("message:text", ...)` in `setupBot`.

5. [MEDIUM] **Step 10: Missing explicit timeout handling on purge executor outbound calls.** The purge executor makes HTTP calls to ai-router, scheduler, and delivery. The `createServiceClient` has no default timeout. Without a timeout, a hung downstream service blocks the entire purge sweep indefinitely. Per `reliability.md`: "All external API calls must have explicit timeout handling." -- **Fix:** Add `HTTP_TIMEOUT_MS` to the user-management config and specify that each outbound `fetch` call passes `signal: AbortSignal.timeout(config.httpTimeoutMs)`.

### LOW

1. [LOW] **Affected services table inconsistency.** The table lists `POST /internal/retention-cleanup` for scheduler as "(called locally)" but Step 6 describes calling local cleanup functions directly. -- **Fix:** Remove the entry from the scheduler row or clarify as "local function call, not an HTTP endpoint."

2. [LOW] **Shared `RetentionCleanupRequestSchema` with all-optional fields.** Consider separate per-service schemas for stronger type safety.

3. [LOW] **Purge executor stale `in_progress` reclaim.** If user-management crashes after claiming purge requests, those requests remain stuck in `in_progress` indefinitely. -- **Fix:** Add a stale-claim reclaim for requests in `in_progress` status older than a configurable threshold.

## Verdict Rationale

The plan is well-structured and covers all three roadmap sub-items. However, the HIGH finding (idempotency key purge ordering) would silently leave orphaned user data, violating the 30-day deletion commitment. The MEDIUM findings address auth routing correctness, config naming, transactional safety, handler ordering, and timeout handling. These should be resolved before implementation.
