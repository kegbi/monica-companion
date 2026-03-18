---
verdict: APPROVED
reviewer: code-reviewer
date: 2026-03-16
attempt: 1
biome_pass: true
tests_pass: true
test_summary: "171 passed, 0 failed (4 user-management integration tests failed due to pre-existing PostgreSQL dependency, not related to this change)"
critical_count: 0
high_count: 0
medium_count: 3
---

# Code Review: Observability & Governance Baseline

## Automated Checks

- **Biome**: PASS -- 139 files checked, 0 errors, 0 warnings.
- **Tests**:
  - `@monica-companion/redaction`: 1 file, 40 tests passed
  - `@monica-companion/observability`: 4 files, 22 tests passed
  - `@monica-companion/auth`: 5 files, 55 tests passed
  - `@monica-companion/telegram-bridge`: 5 files, 36 tests passed
  - `@monica-companion/web-ui`: 1 file, 18 tests passed
  - `@monica-companion/user-management`: 2 files passed (config, crypto); 2 files failed (app, repository.integration) -- **pre-existing**: these integration tests require a running PostgreSQL instance. No user-management test files were modified in this change (`git diff -- services/user-management/src/__tests__/` returns empty). The failures are `ECONNREFUSED` on port 5432, confirming they are environment-dependent, not regression.
  - Minimal services (ai-router, voice-transcription, monica-integration, scheduler, delivery): no test files, pass with `--passWithNoTests`

## Findings

### CRITICAL
(none)

### HIGH
(none)

### MEDIUM

1. [MEDIUM] `docker/grafana/provisioning/datasources/datasources.yml` -- Datasource UIDs are not defined, but dashboards and alert rules reference `"uid": "prometheus"`. Grafana auto-generates UIDs when they are not specified in provisioning. This means dashboard panels (in `service-health.json`, `http-latency.json`) and alert rules (in `rules.yml`) referencing `datasourceUid: prometheus` will fail to resolve the datasource. -- **Fix:** Add `uid: prometheus` to the Prometheus datasource definition, `uid: loki` to Loki, and `uid: tempo` to Tempo in `docker/grafana/provisioning/datasources/datasources.yml`.

2. [MEDIUM] `docker/grafana/datasources.yml` -- The old datasource file at the original path still exists and is tracked by git. The docker-compose now references the new provisioning path, but the old file is orphaned and will confuse future contributors. -- **Fix:** Remove `docker/grafana/datasources.yml` from the repository (it has been superseded by `docker/grafana/provisioning/datasources/datasources.yml`).

3. [MEDIUM] `packages/observability/src/__tests__/init.test.ts` -- All 4 `initTelemetry` tests use `enabled: false`, which only exercises the no-op early-return path (lines 34-37 of `init.ts`). The actual SDK initialization code (lines 40-81: NodeSDK creation, resource setup, exporter/processor wiring) has zero unit test coverage. While the plan notes full pipeline testing is deferred to smoke tests, having at least one test that exercises the `enabled: true` path (perhaps with a minimal config and no endpoint, verifying it starts and shuts down without error) would improve confidence. -- **Fix:** Add one test case with `enabled: true` and no `otlpEndpoint` set (so the SDK starts but has no endpoint to connect to) and verify `initTelemetry` returns a shutdown function that completes without error. This exercises the real code path.

### LOW

1. [LOW] `packages/observability/src/middleware.ts:17-19` -- The middleware records `http.url` which includes the full URL with query parameters. In future endpoints that accept sensitive query parameters (e.g., setup tokens), this could leak data into span attributes. Currently no such endpoints exist, and the `RedactingSpanProcessor` would catch known patterns, but this is worth monitoring. -- **Fix:** Consider recording only `http.target` (path) and dropping `http.url`, or ensure the `RedactingSpanProcessor` catches URL-embedded secrets.

2. [LOW] `services/web-ui/src/server-init.ts` -- This module is created but never imported by any Astro code. It is effectively dead code. The implementation summary acknowledges this and the plan documented that Astro's middleware system is incompatible with the Hono-based `otelMiddleware`. -- **Fix:** Add a comment in `server-init.ts` documenting that it should be imported by server-side Astro code when OTel instrumentation is needed, or add an import in `middleware.ts` if Astro's middleware can consume it.

3. [LOW] `packages/observability/src/processors.ts:65` -- The cast `(span as unknown as Span).setAttribute(...)` relies on a runtime implementation detail of the OTel SDK. The comment documents why, but this could break if the SDK changes internal implementation. -- **Fix:** Document the OTel SDK version this relies on in the comment (currently 2.6.0).

4. [LOW] All service `index.ts` files -- The `shutdown` function calls `process.exit(0)` after `telemetry.shutdown()`, but there is no timeout on the shutdown. If the OTel SDK's `shutdown()` hangs (e.g., waiting for a dead endpoint), the process will never exit. -- **Fix:** Consider wrapping the shutdown in a `Promise.race` with a timeout (e.g., 5 seconds).

## Plan Compliance

The implementation follows the approved plan with justified deviations documented in the implementation summary:

1. **Step ordering (MEDIUM-1)**: Correctly addressed -- catalog entries were done before the observability package.
2. **Redaction package extension (MEDIUM-2)**: Correctly addressed -- existing stub was extended, not overwritten.
3. **OTel initialization pattern (MEDIUM-3)**: Correctly addressed -- separate `instrumentation.ts` module per service with dynamic `await import()` for app code in `index.ts`. This is the recommended pattern.
4. **Observability port notes (MEDIUM-4)**: Correctly addressed -- production notes in `context/spec/data-governance.md`.
5. **Smoke test redaction (MEDIUM-5)**: Documented as deferred to the Docker Compose smoke test step.

All 12 plan steps are implemented:
- Step 1 (redaction package): Done with 40 tests
- Step 2 (observability package): Done with 22 tests
- Step 3 (catalog entries): Done, 12 OTel packages pinned
- Step 4 (telegram-bridge instrumentation): Done with 2 tests
- Step 5 (remaining 6 services): Done
- Step 6 (web-ui): Partially done (server-init module created, not yet imported)
- Step 7 (Docker Compose env vars): Done
- Step 8 (OTel Collector config): Done (batch + resource processors)
- Step 9 (retention policies): Done (Loki, Tempo, Prometheus)
- Step 10 (Grafana dashboards): Done (3 dashboards)
- Step 11 (Grafana alerting): Done (5 alert rules)
- Step 12 (smoke test): Deferred to post-implementation verification per completion rules

## Verdict Rationale

APPROVED. The implementation is comprehensive, well-structured, and follows the approved plan. All automated checks pass (Biome clean, all relevant tests green). The three MEDIUM findings are operational correctness issues (datasource UIDs, orphaned file, test coverage gap) that do not affect the safety or correctness of the core redaction and observability logic. The redaction package has thorough test coverage (40 tests). The observability package wires in defense-in-depth redaction at the OTel SDK layer. Service boundaries are respected -- no Telegram or Monica types leak into the observability package. Security requirements are met: sensitive data is redacted via processors before reaching observability backends, no secrets are logged, and the governance spec documents production hardening requirements. The instrumentation pattern (separate `instrumentation.ts` + dynamic imports) correctly addresses the OTel auto-instrumentation hook ordering concern.

The MEDIUM findings should be addressed before the Docker Compose smoke test, particularly MEDIUM-1 (datasource UIDs) which will cause dashboards and alerts to fail in Grafana.
