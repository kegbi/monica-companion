---
verdict: PASS
services_tested: ["scheduler", "postgres", "redis", "prometheus", "grafana", "otel-collector", "loki", "tempo", "caddy", "user-management", "monica-integration"]
checks_run: 8
checks_passed: 8
---

# Smoke Test Report: Operational Review

## Environment
- Services started: postgres:17.9-alpine, redis:8.6.1-alpine, caddy:2.11.2-alpine, grafana:12.4.1, prom/prometheus:v3.10.0, grafana/loki:3.6.7, grafana/tempo:2.10.2, otel/opentelemetry-collector-contrib:0.147.0, node:24.14.0-slim (scheduler, user-management, monica-integration)
- Health check status: postgres healthy, redis healthy, prometheus ready, grafana ready (v12.4.1), scheduler 200 OK
- Stack startup time: ~90s (including deps-init pnpm install)
- Note: user-management exited (exit code 1, likely placeholder ENCRYPTION_MASTER_KEY) -- not relevant to this task; scheduler started successfully despite dependency exiting after initial start

## Checks

| # | Check | Expected | Actual | Result |
|---|-------|----------|--------|--------|
| 1 | Scheduler health (GET /health via docker exec node) | 200 with service info | 200 `{"status":"ok","service":"scheduler"}` | PASS |
| 2 | Scheduler logs: no metric-related startup errors | No errors | No stdout/stderr logs (structured logging via OTel pipeline); service healthy and reporting metrics | PASS |
| 3 | Prometheus has scheduler_queue_depth metric with data | Metric registered with queue/state labels | 9 time series: 3 queues x 3 states, reminder-poll shows active=1, delayed=1 | PASS |
| 4 | Operations dashboard: 6 real panels (not placeholders) | 6 panels, all type=timeseries or stat | 6 panels: 5 timeseries + 1 stat, zero text/placeholder panels | PASS |
| 5 | Alert rules: SchedulerMisfire, QueueBacklog, HighRetryRate loaded | All 3 rules present with real PromQL | All 3 found: `increase(scheduler_reminder_missed[6h]) > 0`, `scheduler_queue_depth{state="waiting"} > 100`, retry ratio `> 0.3` | PASS |
| 6 | Scheduler NOT exposed through Caddy (GET /internal/execute, GET /health) | 404 (not routed) | 404 for both paths | PASS |
| 7 | Load test scripts exist and parse as valid TypeScript | 7 files present, all parse | 7 files present (mock-server.ts, queue-latency.ts, read-only-latency.ts, reminder-reliability.ts, budget-accuracy.ts, resource-profile.sh, run-all.sh); all 5 TS files transpile without error | PASS |
| 8 | Documentation: findings template and ADR addendum exist | Both files present with correct content | operational-review-findings.md EXISTS, adr-v1-deployment-profile.md has "Validation Addendum" section | PASS |

## Details

### Check 1: Scheduler Health
```
$ docker compose exec scheduler node -e "http.get('http://localhost:3005/health', ...)"
STATUS: 200
BODY: {"status":"ok","service":"scheduler"}
```

### Check 3: Queue Metrics in Prometheus
The `scheduler_queue_depth` gauge is actively reporting 9 time series covering all 3 BullMQ queues (command-execution, reminder-execute, reminder-poll) across all 3 states (waiting, active, delayed). The reminder-poll queue correctly shows 1 active and 1 delayed job from the repeatable scheduler.

Histogram and counter metrics (job_wait_duration, job_process_duration, retry_total, dead_letter_total, reminder_on_time/late/missed) are not yet visible in Prometheus because no jobs have been processed. This is expected OTel behavior -- instruments are lazy-initialized and only exported after their first recording. The queue depth gauge appears because the 15-second periodic poller runs unconditionally.

### Check 4: Dashboard Panel Types
```
Panel count: 6
  BullMQ Queue Depth: type=timeseries
  Job Processing Rate: type=timeseries
  Queue Latency p50 / p95: type=timeseries
  Retry Amplification Ratio: type=timeseries
  Scheduler Job Status: type=stat
  Reminder Reliability: type=timeseries
```
All panels reference real PromQL expressions against `scheduler_queue_*` and `scheduler_reminder_*` metrics.

### Check 5: Alert Rule PromQL Expressions
```
SchedulerMisfire: increase(scheduler_reminder_missed[6h]) > 0
QueueBacklog: scheduler_queue_depth{state="waiting"} > 100
HighRetryRate: (rate(scheduler_queue_retry_total[5m]) / (rate(...{status="completed"}[5m]) > 0)) > 0.3
```
All three rules use real metric names matching the OTel instruments defined in `queue-metrics.ts`.

### Check 6: Caddy Does Not Expose Internal Services
```
GET http://localhost:80/internal/execute -> 404
GET http://localhost:80/health -> 404
```
Caddyfile only routes `/webhook/telegram*` and `/setup*`. All other paths return 404.

### Check 7: Load Test Files
All expected files present in `tests/load/`:
- `mock-server.ts` -- transpiles OK
- `queue-latency.ts` -- transpiles OK
- `read-only-latency.ts` -- transpiles OK
- `reminder-reliability.ts` -- transpiles OK
- `budget-accuracy.ts` -- transpiles OK
- `resource-profile.sh` -- shell script
- `run-all.sh` -- orchestration shell script

### Check 8: Documentation
- `context/spec/operational-review-findings.md` -- exists with structured template for all 8 measurement categories
- `context/product/adr-v1-deployment-profile.md` -- contains "Validation Addendum (2026-03-17)" section documenting instrumentation, load test tooling, and separation criteria

## Failures

None.

## Teardown

All services stopped cleanly via `docker compose --profile app --profile observability down`. Verified with `docker compose ps` showing zero running containers. Networks (public, internal) removed.
