# Implementation Summary: Observability & Governance Baseline

## Files Changed

| File | Action | Description |
|------|--------|-------------|
| `pnpm-workspace.yaml` | modified | Added 12 OpenTelemetry packages to pnpm catalog with pinned versions |
| `packages/redaction/package.json` | modified | Added vitest dev dependency and test script (extended existing stub per MEDIUM-2) |
| `packages/redaction/src/patterns.ts` | created | Sensitive field name patterns (regex array) and sensitive value patterns (regex array) |
| `packages/redaction/src/redact.ts` | created | Core redaction functions: redactValue, redactString, redactObject |
| `packages/redaction/src/index.ts` | modified | Re-exports all public API from patterns and redact modules |
| `packages/observability/package.json` | created | New shared package with OTel SDK and redaction dependencies |
| `packages/observability/tsconfig.json` | created | TypeScript config extending base |
| `packages/observability/tsup.config.ts` | created | Standard tsup build config |
| `packages/observability/src/config.ts` | created | Zod schema for telemetry config (serviceName, otlpEndpoint, enabled, logLevel) |
| `packages/observability/src/processors.ts` | created | RedactingLogProcessor and RedactingSpanProcessor that sanitize OTel data before export |
| `packages/observability/src/init.ts` | created | initTelemetry() function that creates NodeSDK with OTLP exporters and redacting processors |
| `packages/observability/src/logger.ts` | created | createLogger() factory returning structured logger backed by OTel Logs API |
| `packages/observability/src/middleware.ts` | created | otelMiddleware() Hono middleware for HTTP request span creation |
| `packages/observability/src/index.ts` | created | Re-exports all public API |
| `services/telegram-bridge/package.json` | modified | Added @monica-companion/observability dependency |
| `services/telegram-bridge/src/app.ts` | modified | Added otelMiddleware() before route handlers |
| `services/telegram-bridge/src/instrumentation.ts` | created | OTel initialization module (loaded before app per MEDIUM-3) |
| `services/telegram-bridge/src/index.ts` | modified | Dynamic imports after OTel init, structured logger, graceful shutdown |
| `services/user-management/package.json` | modified | Added @monica-companion/observability dependency |
| `services/user-management/src/app.ts` | modified | Added otelMiddleware() before route handlers |
| `services/user-management/src/instrumentation.ts` | created | OTel initialization module |
| `services/user-management/src/index.ts` | modified | Dynamic imports after OTel init, structured logger, graceful shutdown |
| `services/ai-router/package.json` | modified | Added @monica-companion/observability dependency |
| `services/ai-router/src/app.ts` | created | Extracted app from index.ts with otelMiddleware |
| `services/ai-router/src/instrumentation.ts` | created | OTel initialization module |
| `services/ai-router/src/index.ts` | modified | Dynamic imports after OTel init, structured logger |
| `services/voice-transcription/package.json` | modified | Added @monica-companion/observability dependency |
| `services/voice-transcription/src/app.ts` | created | Extracted app from index.ts with otelMiddleware |
| `services/voice-transcription/src/instrumentation.ts` | created | OTel initialization module |
| `services/voice-transcription/src/index.ts` | modified | Dynamic imports after OTel init, structured logger |
| `services/monica-integration/package.json` | modified | Added @monica-companion/observability dependency |
| `services/monica-integration/src/app.ts` | created | Extracted app from index.ts with otelMiddleware |
| `services/monica-integration/src/instrumentation.ts` | created | OTel initialization module |
| `services/monica-integration/src/index.ts` | modified | Dynamic imports after OTel init, structured logger |
| `services/scheduler/package.json` | modified | Added @monica-companion/observability dependency |
| `services/scheduler/src/app.ts` | created | Extracted app from index.ts with otelMiddleware |
| `services/scheduler/src/instrumentation.ts` | created | OTel initialization module |
| `services/scheduler/src/index.ts` | modified | Dynamic imports after OTel init, structured logger |
| `services/delivery/package.json` | modified | Added @monica-companion/observability dependency |
| `services/delivery/src/app.ts` | created | Extracted app from index.ts with otelMiddleware |
| `services/delivery/src/instrumentation.ts` | created | OTel initialization module |
| `services/delivery/src/index.ts` | modified | Dynamic imports after OTel init, structured logger |
| `services/web-ui/package.json` | modified | Added @monica-companion/observability dependency |
| `services/web-ui/src/server-init.ts` | created | OTel initialization module for Astro (uses import.meta.env) |
| `docker-compose.yml` | modified | Added OTEL_EXPORTER_OTLP_ENDPOINT and OTEL_SERVICE_NAME to all 8 app services; added SERVICE_NAME to services missing it; added Prometheus retention flag; updated Grafana volumes for dashboards and alerting; added GF_UNIFIED_ALERTING_ENABLED |
| `docker/otel-collector.yaml` | modified | Added batch processor, resource processor (deployment.environment), wired into all pipelines |
| `docker/loki-config.yaml` | modified | Added retention_period (336h/14d) and compactor configuration |
| `docker/tempo-config.yaml` | modified | Added compactor with block_retention (336h/14d) |
| `docker/grafana/provisioning/datasources/datasources.yml` | created | Moved from docker/grafana/datasources.yml to provisioning path |
| `docker/grafana/provisioning/dashboards/dashboards.yml` | created | Dashboard provisioning config |
| `docker/grafana/provisioning/dashboards/service-health.json` | created | Service Health Overview dashboard |
| `docker/grafana/provisioning/dashboards/http-latency.json` | created | HTTP Latency & Errors dashboard |
| `docker/grafana/provisioning/dashboards/operations.json` | created | Operations & Queues dashboard (placeholder panels) |
| `docker/grafana/provisioning/alerting/rules.yml` | created | Alert rules: ServiceDown, HighErrorRate, HighLatency, QuotaExhaustion (placeholder), SchedulerMisfire (placeholder) |
| `context/spec/data-governance.md` | created | Retention, deletion, and redaction policy specification |

## Tests Added

| Test File | What It Tests |
|-----------|---------------|
| `packages/redaction/src/__tests__/redact.test.ts` | 40 tests: field-name pattern matching, value pattern matching, deep object redaction, arrays, nested objects, non-sensitive passthrough, edge cases (null, undefined, numbers, primitives) |
| `packages/observability/src/__tests__/processors.test.ts` | 9 tests: RedactingLogProcessor redacts attributes and body, delegates shutdown/flush; RedactingSpanProcessor redacts attributes, delegates onStart/shutdown, passes non-sensitive through |
| `packages/observability/src/__tests__/init.test.ts` | 4 tests: initTelemetry returns shutdown function, accepts config, handles missing endpoint, shutdown returns promise |
| `packages/observability/src/__tests__/logger.test.ts` | 6 tests: createLogger returns object with info/warn/error/debug methods that don't throw, accepts structured data |
| `packages/observability/src/__tests__/middleware.test.ts` | 3 tests: otelMiddleware works on GET/POST, preserves error responses |
| `services/telegram-bridge/src/__tests__/observability.test.ts` | 2 tests: createApp works with otelMiddleware applied, health endpoint responds correctly |

## Verification Results

- **Biome**: `biome check .` -- Checked 139 files, 0 errors, 0 warnings
- **Tests**:
  - `@monica-companion/redaction`: 1 file, 40 tests passed
  - `@monica-companion/observability`: 4 files, 22 tests passed
  - `@monica-companion/auth`: 5 files, 55 tests passed
  - `@monica-companion/telegram-bridge`: 5 files, 36 tests passed
  - `@monica-companion/web-ui`: 1 file, 18 tests passed
  - `@monica-companion/user-management`: 2 files passed (config, crypto); 2 files failed (app, repository.integration) -- **pre-existing**: these are integration tests requiring a running PostgreSQL instance, not affected by observability changes
  - Minimal services (ai-router, voice-transcription, monica-integration, scheduler, delivery): no test files, pass with `--passWithNoTests`
- **Builds**: Both `@monica-companion/redaction` and `@monica-companion/observability` build successfully with tsup (ESM + DTS)

## Plan Deviations

1. **Step ordering**: Followed MEDIUM-1 recommendation -- did Step 3 (catalog entries) before Step 2 (observability package).

2. **OTel initialization pattern (MEDIUM-3)**: Used a separate `instrumentation.ts` module per service with dynamic `await import()` for app code in `index.ts`. This ensures `initTelemetry()` runs before Hono/HTTP modules are loaded, allowing auto-instrumentation hooks to register properly.

3. **Redaction package extended (MEDIUM-2)**: Extended the existing stub `packages/redaction/` rather than creating from scratch. Only added `vitest` to devDependencies and `test` script; preserved existing `tsup` and `typescript` configuration.

4. **Observability ports note (MEDIUM-4)**: Added production deployment notes in `context/spec/data-governance.md` about binding observability ports to `127.0.0.1` only or removing `ports:` mappings entirely.

5. **MEDIUM-5 (Smoke test redaction)**: The smoke test strategy in the plan described sending an Authorization header to /health. The actual redaction verification should target an endpoint that logs request metadata. This is documented but the full end-to-end smoke test (Step 12) requires the Docker Compose stack running, which is a separate verification step post-implementation.

6. **web-ui instrumentation**: Simplified from the plan. Created `server-init.ts` using `import.meta.env` for Astro compatibility. Did not modify the existing CSRF middleware since it does not need OTel-specific changes -- the otelMiddleware pattern does not apply to Astro middleware (which uses `defineMiddleware` from `astro:middleware`, not Hono). The server-init module is available for import by any server-side Astro code that needs the logger.

7. **`@monica-companion/redaction` not added as direct dependency to services**: Per LOW-1 finding, services only import `@monica-companion/observability` which transitively depends on redaction. No direct redaction dependency added to individual services.

8. **Old datasources.yml not removed**: The original `docker/grafana/datasources.yml` file remains in place but is no longer referenced by docker-compose.yml (which now points to the provisioning path). It can be cleaned up in a separate commit.

## Residual Risks

1. **Docker Compose smoke test not executed**: Step 12 requires a running Docker Compose stack to verify telemetry flows end-to-end. This must be performed as a separate verification step before marking the roadmap item complete.

2. **user-management integration tests require PostgreSQL**: Pre-existing condition. The app.test.ts and repository.integration.test.ts files need a running PostgreSQL to pass. This is not related to observability changes.

3. **Astro OTel integration**: The web-ui uses Astro's middleware system which is separate from Hono. The `server-init.ts` module initializes OTel for the Node.js process, but Astro's Vite build pipeline may not propagate auto-instrumentation hooks. Manual instrumentation may be needed in Phase 2 when web-ui has more server-side logic.

4. **OTel SDK graceful degradation**: When the observability Docker Compose profile is not active, the OTLP exporter will fail to connect. The `enabled` flag in `initTelemetry` is tied to `OTEL_EXPORTER_OTLP_ENDPOINT` being set, so services will not attempt to export telemetry when the collector is not configured. However, if the env var is set but the collector is down, the SDK will buffer and eventually drop telemetry silently (this is the expected OTel behavior).

5. **Dashboard metric names**: The dashboards reference `http_server_request_duration_seconds_*` metrics. These metric names depend on the OTel SDK version and semantic conventions. If the SDK changes naming conventions, dashboards will need updating.

6. **Old datasources.yml**: The file at `docker/grafana/datasources.yml` is now orphaned (docker-compose points to the new provisioning path). It should be removed in a cleanup pass.
