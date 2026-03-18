# Implementation Plan: Operational Review

## Objective

Validate the operational characteristics of the V1 system under realistic load conditions before marking Phase 5 complete. This means:

1. Measuring queue latency, retry amplification, OpenAI spend tracking accuracy, and reminder reliability under concurrent load.
2. Confirming that the separate `delivery` and `voice-transcription` deployables remain justified in V1.
3. Verifying that read-only interactions (queries, clarifications) continue to bypass the scheduler queue and meet the p95 latency targets from acceptance-criteria.md (5s text, 12s voice).

This is a measurement and validation task group, not a feature-building task group. The outputs are instrumentation improvements, load test scripts, updated dashboards, and a decision document capturing findings.

## Scope

### In Scope

- Add BullMQ queue metrics (queue depth, job processing time, wait time, retry count, dead-letter count) via OTel custom metrics in the scheduler service.
- Replace placeholder panels in the Operations & Queues Grafana dashboard with real metric queries.
- Replace the placeholder scheduler-misfire alert rule with a real PromQL expression.
- Write a load test script that generates concurrent confirmed-command and reminder workloads against the scheduler queue, and concurrent read-only queries against ai-router.
- Write integration tests that verify read-only queries never touch the scheduler service.
- Measure and record queue latency p50/p95/p99, retry amplification ratio, dead-letter rate, and reminder on-time delivery rate under simulated load.
- Verify OpenAI spend metric accuracy by comparing guardrail budget Redis values against recorded OTel gauge values.
- Document the delivery and voice-transcription separation decision with measured data in an ADR addendum.
- Verify the read-only bypass path latency stays within acceptance targets.

### Out of Scope

- Building new features or changing service boundaries.
- Implementing production-grade performance testing infrastructure (k6, Locust, etc.).
- Changing the number of services or merging deployables.
- Changing connector contracts or adding new connectors.
- Running tests against real external APIs (OpenAI, Telegram, MonicaHQ).

## Affected Services & Packages

| Package/Service | Changes |
|-----------------|---------|
| `services/scheduler` | Add BullMQ queue metrics collection (OTel counters/histograms). New file `src/lib/queue-metrics.ts`. |
| `docker/grafana/provisioning/dashboards/operations.json` | Replace all 6 placeholder panels with real PromQL queries. |
| `docker/grafana/provisioning/alerting/rules.yml` | Replace scheduler-misfire placeholder with real alert rule. Add queue-depth alert. |
| `tests/load/` (new) | Load test scripts for queue latency, read-only bypass, and concurrent workload measurement. |
| `context/product/adr-v1-deployment-profile.md` | Add validation addendum with measured data. |
| `context/spec/operational-review-findings.md` (new) | Document all measurement results and validation conclusions. |

## Implementation Steps

### Step 1: Add BullMQ Queue Metrics to Scheduler

**What:** Create `services/scheduler/src/lib/queue-metrics.ts` that registers OTel instruments for BullMQ job lifecycle events. Wire into existing BullMQ workers.

**Metrics to instrument:**
- `scheduler.queue.job_wait_duration_seconds` (histogram) — time from enqueue to processing start, by `queue_name`
- `scheduler.queue.job_process_duration_seconds` (histogram) — processing time, by `queue_name` and `status`
- `scheduler.queue.depth` (gauge) — current waiting/active/delayed jobs, by `queue_name` and `state`
- `scheduler.queue.retry_total` (counter) — retries by `queue_name`
- `scheduler.queue.dead_letter_total` (counter) — dead-lettered jobs by `queue_name`
- `scheduler.reminder.on_time` (counter) — reminders delivered within 5 min of scheduled time
- `scheduler.reminder.late` (counter) — reminders delivered >5 min late
- `scheduler.reminder.missed` (counter) — reminders that hit catch-up or skip

**Files to create/modify:**
- Create `services/scheduler/src/lib/queue-metrics.ts`
- Modify `services/scheduler/src/index.ts` to wire metrics into BullMQ worker events and add periodic queue-depth poller (every 15s)
- Modify `services/scheduler/src/workers/command-worker.ts` to record job processing duration
- Modify `services/scheduler/src/workers/reminder-executor.ts` to record on-time vs late delivery
- Modify `services/scheduler/src/lib/dead-letter.ts` to increment dead-letter counter

**TDD:**
1. Write `services/scheduler/src/__tests__/queue-metrics.test.ts` — test `createQueueMetrics()` returns valid metrics object, recording methods don't throw
2. Implement the module

### Step 2: Update Operations Dashboard with Real Panels

**What:** Replace 6 placeholder text panels in `docker/grafana/provisioning/dashboards/operations.json` with real Prometheus query panels.

**Panels:**
1. BullMQ Queue Depth — `scheduler_queue_depth` by queue_name and state
2. Job Processing Rate — `rate(scheduler_queue_job_process_duration_seconds_count[5m])`
3. Queue Latency p50/p95 — histogram quantiles of wait and process durations
4. Retry Amplification Ratio — retries/completions rate
5. Scheduler Job Status — completed/failed/dead-lettered counts
6. Reminder Reliability — on_time/late/missed rates

### Step 3: Replace Scheduler Misfire Placeholder Alert

**What:** Replace placeholder alert in `docker/grafana/provisioning/alerting/rules.yml` with real rules.

**Alert rules:**
1. **SchedulerMisfire** — `increase(scheduler_reminder_missed[6h]) > 0`, severity warning
2. **QueueBacklog** — `scheduler_queue_depth{state="waiting"} > 100` for 5m, severity warning
3. **HighRetryRate** — retry/completion ratio > 0.3 for 5m, severity warning

### Step 4: Write Read-Only Bypass Verification Tests

**What:** Integration tests proving read-only queries never touch the scheduler service.

**File:** `services/ai-router/src/__tests__/read-only-bypass.test.ts`

**Tests:**
1. Contact resolution request does NOT call scheduler URL
2. ai-router config has `deliveryUrl` for direct delivery (not through scheduler)
3. Confirmed command payload WOULD be sent to scheduler

### Step 5: Write Queue Latency and Load Simulation Scripts

**What:** Load test scripts for queue latency, read-only latency, and reminder reliability.

**Files to create:**
- `tests/load/queue-latency.ts` — enqueue N commands via scheduler, poll Prometheus for latency
- `tests/load/read-only-latency.ts` — concurrent contact-resolution requests, measure p95
- `tests/load/reminder-reliability.ts` — insert test schedules, verify firing accuracy
- `tests/load/run-all.sh` — orchestrates all load tests

**Concurrency levels:** 10, 25, 50 simultaneous requests.

### Step 6: Verify OpenAI Spend Metric Accuracy

**What:** Script comparing Redis guardrail budget values against Prometheus gauge values.

**File:** `tests/load/budget-accuracy.ts`

### Step 7: Validate delivery and voice-transcription Separation

**What:** Collect resource profiles and failure isolation data.

**Criteria:**
1. Independent failure domains
2. Independent scaling needs
3. Connector-neutral contract preservation
4. Operational overhead

**Files:**
- `tests/load/resource-profile.sh` — docker stats snapshots during load
- `context/product/adr-v1-deployment-profile.md` — add validation addendum

### Step 8: Measure Read-Only Bypass Latency Under Load

**What:** Measure end-to-end read-only path latency at varying simulated external latencies (100ms, 500ms, 1000ms). Compare against 5s p95 target.

### Step 9: Document Findings

**What:** Collect all measurements into structured findings document.

**File:** `context/spec/operational-review-findings.md`

**Structure:**
1. Queue Latency Measurements
2. Retry Amplification
3. Dead-Letter Rate
4. Reminder Reliability
5. OpenAI Spend Tracking Accuracy
6. Read-Only Bypass Latency
7. Service Separation Analysis
8. Conclusions and Recommendations

### Step 10: Smoke Test

**Services to start:** postgres, redis, otel-collector, prometheus, grafana, loki, tempo, scheduler, ai-router, delivery, voice-transcription, user-management, monica-integration

**Checks:**
1. Queue metrics appear in Prometheus
2. Operations dashboard panels show real queries (not placeholders)
3. Alert rules loaded correctly in Grafana
4. Health checks pass on all services
5. Load test results within expected bounds

## Test Strategy

### Unit Tests (TDD)

| Test File | What | Mocks |
|-----------|------|-------|
| `services/scheduler/src/__tests__/queue-metrics.test.ts` | `createQueueMetrics()` returns valid metrics, recording methods don't throw | OTel `metrics.getMeter()` |
| `services/ai-router/src/__tests__/read-only-bypass.test.ts` | Contact resolution doesn't call scheduler, confirmed commands do | `ServiceClient.fetch` |

### Load/Integration Tests

- Load test scripts run against real Postgres, Redis, and OTel stack
- External services mocked via local mock HTTP server
- Results documented in findings document

## Smoke Test Strategy

**HTTP checks:**
1. `GET http://localhost:9090/api/v1/query?query=scheduler_queue_depth` — metric registered
2. `GET http://localhost:9090/api/v1/query?query=scheduler_queue_job_wait_duration_seconds_bucket` — metric exists
3. Grafana rules endpoint returns `SchedulerMisfire` rule
4. Operations dashboard JSON has no placeholder text panels
5. All service health checks return 200

## Security Considerations

- Load test scripts sign JWTs with dev JWT_SECRET per security rules
- Mock HTTP server runs only on internal Docker network
- No sensitive data in findings document
- Load scripts don't log request/response bodies
- Grafana dashboard queries use only operational labels (queue_name, status, service_name)

## Risks & Open Questions

1. **BullMQ event timing accuracy (LOW):** `job.processedOn` and `job.timestamp` may have slight inaccuracy with Redis latency. Cross-validate with Tempo spans.
2. **Prometheus scrape lag (LOW):** Up to 30s staleness. Load tests wait 30s before querying.
3. **Mock server fidelity (MEDIUM):** Canned responses don't simulate realistic latency distributions. Real-world validation deferred to beta launch.
4. **Environment-specific measurements (MEDIUM):** Docker Desktop on Windows differs from Linux production. Findings note this caveat.
5. **No real production load yet (MEDIUM):** All measurements synthetic. Findings state this explicitly.
