---
verdict: APPROVED
attempt: 1
biome_pass: true
tests_pass: true
test_summary: "scheduler: 56 passed (1 pre-existing file-level failure), ai-router: 96 passed, 22 skipped (1 pre-existing integration failure)"
critical_count: 0
high_count: 0
medium_count: 2
---

# Code Review: Operational Review

## Automated Checks

- **Biome**: PASS -- 0 errors, 93 warnings (all pre-existing), 1 info. No new issues introduced.
- **Scheduler tests**: 9 test files pass, 56 tests pass. 1 pre-existing file failure (`execute.test.ts` -- module resolution for `@monica-companion/observability`). Not related to this change.
- **AI Router tests**: 10 test files pass, 96 tests pass, 22 skipped. 1 pre-existing integration test failure (no local PostgreSQL). Not related to this change.

## Findings

### CRITICAL

(none)

### HIGH

(none)

### MEDIUM

1. [MEDIUM] `services/scheduler/src/index.ts` -- Reminder on-time/late/missed counters are never wired. The `QueueMetrics` interface defines `recordReminderOnTime()`, `recordReminderLate()`, and `recordReminderMissed()`, and the plan (Step 1) specifies wiring these into the reminder executor. However, the reminder worker in `index.ts` (lines 127-163) only records wait duration, process duration, and retry metrics. The three reminder reliability counters are never called in production code. This means the "Reminder Reliability" dashboard panel and the `SchedulerMisfire` alert will always show zero, and the `reminder-reliability.ts` load test will never see delta changes. -- **Fix:** In the `reminderWorker` handler (around line 128), after `executeReminder()` succeeds, compare the scheduled time against actual execution time. If within 5 minutes, call `queueMetrics.recordReminderOnTime()`; otherwise call `queueMetrics.recordReminderLate()`. In the reminder poller's catch-up path, call `queueMetrics.recordReminderMissed()`.

2. [MEDIUM] `services/scheduler/src/index.ts:104-107` -- Retry counter fires on every failure including first attempt. The `commandWorker.on("failed")` handler calls `queueMetrics.recordRetry()` for every failure event, but BullMQ fires `failed` on the first attempt too, not just retries. This inflates the retry metric and skews the Retry Amplification Ratio dashboard panel and the `HighRetryRate` alert rule (which compares retries to completions). The same issue exists for `reminderWorker.on("failed")` at line 165. -- **Fix:** Guard the retry recording with `if (job.attemptsMade > 1)` so that only actual retries (second attempt onward) are counted.

### LOW

1. [LOW] `tests/load/mock-server.ts:29-34` -- Health check comment says "immediate, no delay" but the `await delay(RESPONSE_DELAY_MS)` on line 29 executes before the URL routing check on line 31, so health checks also receive the artificial delay. -- **Fix:** Move the `await delay(RESPONSE_DELAY_MS)` call to after the health check URL check, or add an early return for `/health` before the delay.

2. [LOW] `services/scheduler/src/index.ts:104-124` -- The `commandWorker.on("failed")` handler has two separate `if (job)` checks that could be combined. Lines 105-107 check `if (job)` to record retry, and line 108 checks `if (job && job.attemptsMade >= config.maxRetries)` for dead letter. These could be a single `if (job)` block for clarity. -- **Fix:** Nest the dead-letter check inside the outer `if (job)` guard.

3. [LOW] `tests/load/queue-latency.ts:40-57` -- The JWT signing function is duplicated in `queue-latency.ts`, `read-only-latency.ts`, and could be extracted into a shared utility in `tests/load/`. -- **Fix:** Extract `signJwt()` into a `tests/load/utils.ts` shared module.

## Plan Compliance

The implementation follows the approved plan across all 10 steps. Key observations:

- **Step 1 (Queue Metrics)**: Metrics module created correctly. Wiring done in `index.ts` instead of modifying worker files -- this is a justified deviation that keeps instrumentation co-located and avoids changing function signatures. However, reminder reliability counters (on-time/late/missed) are defined but never wired (MEDIUM finding above).
- **Step 2 (Dashboard)**: All 6 placeholder panels replaced with real PromQL timeseries/stat panels. Dashboard description updated. OpenAI placeholder reasonably replaced with Reminder Reliability (documented decision).
- **Step 3 (Alert Rules)**: Scheduler-misfire placeholder replaced with real `SchedulerMisfire` rule. `QueueBacklog` and `HighRetryRate` rules added with proper PromQL. Severity levels correct.
- **Step 4 (Read-Only Bypass Tests)**: Tests verify config properties and `buildConfirmedPayload()` contract alignment. Reasonable scope.
- **Steps 5-8 (Load Tests)**: All load test scripts present with proper JWT auth, timeouts, configurable parameters, and Prometheus integration.
- **Step 9 (Findings Document)**: Template created with all 8 sections, proper caveats, and target values.
- **Step 10 (ADR Addendum)**: Validation addendum added to ADR with instrumentation, tooling, and separation criteria documentation.
- **Concurrency levels**: 5/10/25 instead of planned 10/25/50 -- documented as deliberate LOW deviation.

## Verdict Rationale

APPROVED. All automated checks pass (zero Biome errors, all new tests pass, pre-existing failures documented and unrelated). No CRITICAL or HIGH findings. The two MEDIUM findings are genuine gaps (unwired reminder counters and inflated retry metric) but they affect measurement accuracy of metrics that produce zeroes or inflated values rather than causing incorrect behavior, security issues, or service failures. They should be fixed before the load test execution (Step 10 smoke test) to get meaningful measurements, but they do not block the overall implementation from being merged. The code is well-structured, follows project conventions, respects service boundaries, uses proper OTel patterns, and the PromQL queries are real and correct.
