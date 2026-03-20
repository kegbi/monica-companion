---
verdict: APPROVED
attempt: 1
biome_pass: true
tests_pass: true
test_summary: "256 passed, 0 failed (8 pre-existing failures from missing ioredis/resources aliases and Postgres not running; identical on clean main)"
critical_count: 0
high_count: 0
medium_count: 2
---

# Code Review: Latency Validation

## Automated Checks
- **Biome**: pass -- 19 errors and 80 warnings are all pre-existing (verified identical on clean main). All 19 errors are CRLF formatting issues on Windows. No new errors introduced.
- **Tests**: 23 test files pass, 256 tests pass. 8 pre-existing failures (config.test.ts, read-only-bypass.test.ts, guardrails-wiring.test.ts, middleware-ordering.test.ts, process-endpoint.test.ts, retention-endpoint.test.ts, user-purge-endpoint.test.ts, repository.integration.test.ts) -- all identical to clean main. Graph subsystem: 12 files, 163 tests, all passing.

## Findings

### CRITICAL
(none)

### HIGH
(none)

### MEDIUM

1. [MEDIUM] `services/ai-router/src/graph/nodes/execute-action.ts:22-24` -- Import statements appear after the `const tracer = trace.getTracer("ai-router")` line (line 22-23), splitting imports around executable code. While Biome does not flag this as an error, it is unconventional and makes the import section harder to scan. All other instrumented files (load-context.ts, classify-intent.ts, format-response.ts, deliver-response.ts, persist-turn.ts) correctly group all imports together before the tracer declaration. -- **Fix:** Move `const tracer = trace.getTracer("ai-router");` below all import statements to match the pattern used in the other 5 files.

2. [MEDIUM] `services/ai-router/src/graph/nodes/persist-turn.ts:89-91` -- The original code had a TODO comment `// TODO: Emit a counter metric (persist_turn_failures_total) when OTel is wired.` that was removed during this change. OTel is now wired (spans wrap the node), but the specific counter metric mentioned in the TODO was not implemented. The span instrumentation provides some visibility into failures, but a dedicated counter metric (e.g., via OTel Metrics API) would be more appropriate for monitoring persistence failure rates in dashboards/alerts. -- **Fix:** Either (a) implement the counter metric now that OTel is available, or (b) restore the TODO with updated text noting that spans provide partial coverage but a dedicated counter is still desirable.

### LOW

1. [LOW] `services/ai-router/src/app.ts:146-152` -- The structured log line uses `console.info(JSON.stringify(...))` rather than the project's OTel-based structured logging. This is adequate for the current stage but should eventually use the observability package's logger for consistency. -- **Fix:** Consider using `@monica-companion/observability` logger when structured logging is standardized.

2. [LOW] `.claude-work/end-to-end-pipeline-wiring/state.json` -- This file was modified in the diff but belongs to a different task ("End-to-End Pipeline Wiring"). It should not be included in a latency-validation commit. -- **Fix:** Exclude this file from the latency-validation commit scope.

3. [LOW] `services/ai-router/src/__smoke__/latency-voice.smoke.test.ts:31` -- Uses `__dirname` which requires CommonJS module resolution. The vitest config and project use ESM. This works in vitest's transform pipeline but is fragile. -- **Fix:** Consider using `import.meta.url` with `fileURLToPath` for ESM-correct path resolution.

4. [LOW] `services/ai-router/src/__smoke__/latency-text.smoke.test.ts:50-53` -- The percentile function uses `Math.ceil((p / 100) * sorted.length) - 1` which for p=95 and n=20 gives index 18 (the 19th element). With only 20 samples, p95 is effectively the 2nd-highest value. This is mathematically correct for the nearest-rank method but the small sample size means high variance. The implementation summary acknowledges this. -- **Fix:** No code fix needed; acknowledged in residual risks.

## Plan Compliance

The plan was followed with documented and justified deviations:

1. **Steps 1-4**: Fully implemented. OTel span instrumentation on all 6 nodes, graph-level timing in app.ts, text latency smoke test, voice latency smoke test.
2. **Step 5 (Run latency tests)**: Deferred -- requires live Docker Compose stack. The test infrastructure is in place.
3. **Step 6 (Profile LangGraph pipeline)**: Deferred -- requires live stack. Per-node span instrumentation is in place to collect timing data.
4. **Step 7 (Results report)**: Deferred -- the smoke tests themselves produce the report output when run.
5. **Grafana alert verification**: Removed from scope per plan review MEDIUM-3. Justified.
6. **Audio fixture**: Not bundled (graceful skip implemented). Justified per plan fallback clause.
7. **Plan review MEDIUMs addressed**: Voice test JWT uses `issuer: "telegram-bridge"` (MEDIUM-1 addressed). OTel mocks added to all affected test files (MEDIUM-2 addressed). Grafana alert removed from scope (MEDIUM-3 addressed).

## Verdict Rationale

APPROVED. The implementation correctly instruments all 6 LangGraph nodes with OTel spans using the try/finally pattern for reliable span.end() calls. Span attributes contain only structural metadata (intent type, action outcome type) with no PII. Graph-level timing uses performance.now() correctly. Smoke tests have sound methodology (warmup requests, fresh UUIDs, percentile computation). The voice test correctly signs JWTs with issuer "telegram-bridge" and audience "voice-transcription". All existing tests pass with the OTel mocks. The two MEDIUM findings are minor code quality issues (import ordering, removed TODO) that do not affect correctness or security.
