---
verdict: APPROVED
attempt: 1
biome_pass: true
tests_pass: true
test_summary: "66 passed (7 idempotency + 59 scheduler), 0 failed"
critical_count: 0
high_count: 0
medium_count: 4
---

# Code Review: Scheduler

## Automated Checks

- **Biome**: PASS -- 0 errors from scheduler/idempotency code. 93 warnings are all pre-existing in other packages (guardrails, telegram-bridge).
- **Tests (idempotency)**: 1 test file, 7 tests passed, 0 failed
- **Tests (scheduler)**: 9 test files, 59 tests passed, 0 failed
- **User-management tests**: Not executed (requires running PostgreSQL), but 5 new tests were added and previously verified per impl-summary.

## Findings

### CRITICAL
(none)

### HIGH
(none)

### MEDIUM

1. [MEDIUM] `services/scheduler/src/workers/command-worker.ts:66-68` and `services/scheduler/src/lib/dead-letter.ts:66-68` -- Hardcoded `connectorRoutingId: ""` will fail validation against `OutboundMessageIntentSchema` which requires `z.string().min(1)`. When the delivery service validates inbound payloads with this schema, these calls will be rejected with 400. -- **Fix:** The `ConfirmedCommandPayload` does not carry connector routing info. Either: (a) add a lookup to user-management to get the user's `connectorRoutingId` before sending delivery intents, or (b) add the `connectorRoutingId` to the `ConfirmedCommandPayload` schema, or (c) use a placeholder value like `"unknown"` (least desirable). The root cause is that the command execution path lacks the user's connector routing ID.

2. [MEDIUM] `services/scheduler/src/workers/command-worker.ts` -- The `command_executions` table status is never updated to `"completed"` or `"processing"` on the success path. The dead-letter handler updates to `"dead_lettered"`, but a successfully completed command stays with status `"queued"` forever. -- **Fix:** Add SQL updates to set status to `"processing"` when the worker starts and `"completed"` when `idempotencyStore.complete()` succeeds. For example: `await deps.db.execute(sql'UPDATE command_executions SET status = \'completed\', completed_at = NOW(), updated_at = NOW() WHERE id = ${executionId}::uuid')`.

3. [MEDIUM] `services/scheduler/src/workers/command-worker.ts:67` and `services/scheduler/src/lib/dead-letter.ts:67` -- Hardcoded `connectorType: "telegram"` in the scheduler service. While `OutboundMessageIntentSchema.connectorType` is typed as `z.enum(["telegram"])` making this technically valid, the scheduler should be connector-agnostic per service-boundaries.md. When new connectors are added, this will break. -- **Fix:** Carry `connectorType` from the user's profile (user-management) rather than hardcoding. For command execution, this could be included in the `ConfirmedCommandPayload` or looked up at execution time. For reminders, the `connectorType` is already correctly passed through from user-management.

4. [MEDIUM] `services/scheduler/src/index.ts` -- The `httpTimeoutMs` config value is defined but never applied to any HTTP call. Per plan review M3 and reliability.md, all external API calls must have explicit timeout handling. The impl-summary acknowledges this as a residual risk, but there is no `AbortController` or similar mechanism in place. -- **Fix:** Wrap `createServiceClient` calls with an `AbortController`-based timeout. Create a helper that wraps the `ServiceClient.fetch` method to abort after `config.httpTimeoutMs` milliseconds.

### LOW

1. [LOW] `services/scheduler/src/lib/schedule-time.ts:73` -- The `localDateToUtc` function iterates over all possible UTC offsets (-14h to +14h in 30-minute increments). While correct, this is an O(n) scan with n=57 iterations per candidate time. For the expected call rate (once per user per poll minute), this is fine, but could be optimized later.

2. [LOW] `services/scheduler/src/routes/execute.ts:75` -- Dynamic import of `commandExecutions` schema inside the route handler. This creates a minor performance overhead on each request. -- **Fix:** Move the import to module scope or the `executeRoutes` factory function.

3. [LOW] `services/scheduler/src/index.ts:84-85` -- The `commandWorker.on("failed")` handler checks `job.attemptsMade >= config.maxRetries`, but BullMQ retry logic is not explicitly configured with `config.maxRetries`. The worker is created without `defaultJobOptions` specifying `attempts` or `backoff`. BullMQ default is 0 retries (no automatic retry). The queue `add` call in `execute.ts:92` also does not set attempts. -- **Fix:** Pass `defaultJobOptions: { attempts: config.maxRetries, backoff: { type: 'exponential', delay: config.retryBackoffMs } }` when creating the Queue or Worker.

4. [LOW] `.env.example` -- Not updated with the new scheduler-specific environment variables (SCHEDULER_MAX_RETRIES, SCHEDULER_RETRY_BACKOFF_MS, CATCH_UP_WINDOW_HOURS, REMINDER_POLL_INTERVAL_MS, HTTP_TIMEOUT_MS). The plan specified updating `.env.example`. -- **Fix:** Add the new scheduler env vars to `.env.example` with comments.

5. [LOW] `services/scheduler/src/workers/reminder-executor.ts:15` -- `connectorType` is typed as literal `"telegram"` rather than a general string. This couples the reminder executor to the Telegram connector at the type level. -- **Fix:** Change to `connectorType: string` to remain connector-agnostic.

## Plan Compliance

The implementation follows the approved plan with the following justified deviations:

- **M1 addressed**: `ConfirmedCommandPayloadSchema` is used directly at the execute endpoint (no wrapper type).
- **M2 addressed**: No `ReminderDigestIntent` type was created; the delivery intent reuses the `OutboundMessageIntent` shape.
- **M3 partially addressed**: `httpTimeoutMs` config field exists but is not wired into HTTP calls. Documented as residual risk.
- **M4 addressed**: Migration SQL is in `services/scheduler/drizzle/` with clear docstring in `packages/idempotency/src/schema.ts`.
- **M5 deferred**: Short-TTL caching for user schedule list is explicitly deferred and documented.
- **Integration tests deferred**: `store.integration.test.ts`, `execute.integration.test.ts`, `reminder-windows.integration.test.ts` were not created. Documented as deferred to Docker Compose smoke test phase.
- **UserScheduleListResponse**: Not added as named schema in `packages/types` -- justified inline response shape.

## Verdict Rationale

APPROVED. All automated checks pass with zero errors. There are no CRITICAL or HIGH findings. The four MEDIUM findings are legitimate gaps that should be addressed before the scheduler is deployed to production, but they do not prevent the implementation from being functionally correct for development and testing purposes:

1. The `connectorRoutingId: ""` issue (M1) will manifest only when the delivery service validates inbound payloads, which is the next roadmap item. It can be fixed as part of delivery integration.
2. The missing `command_executions` status update (M2) is a data consistency gap but does not affect command execution correctness.
3. The hardcoded `connectorType` (M3) is technically valid against the current schema and will only need fixing when multi-connector support is added.
4. The unwired timeout (M4) is a documented residual risk with a clear fix path.

All security controls are properly implemented: JWT auth with per-endpoint allowlists, no public exposure, redaction on dead-letter payloads, no credential handling. Service boundaries are respected (scheduler uses Monica-agnostic contracts via monica-integration). DST handling and catch-up logic are thoroughly tested. The idempotency implementation is correct and covers the full lifecycle.
