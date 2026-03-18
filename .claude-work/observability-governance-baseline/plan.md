# Implementation Plan: Observability & Governance Baseline

## Objective

Instrument all 8 services with OpenTelemetry (logs, metrics, traces), implement the `@monica-companion/redaction` package to sanitize sensitive data before it reaches the observability stack, codify retention and deletion policies, and provision Grafana dashboards with alerting rules for failures, latency, quota exhaustion, and scheduler misfires.

This is the final item in Phase 1 (Security Baseline & Platform Skeleton). It builds on the completed Monorepo Baseline (which stood up the observability Docker Compose infrastructure), the Public Ingress Hardening, Inter-Service Security, and Setup-Link Authentication steps. Completing this step makes every service traceable end-to-end with correlation IDs, ensures sensitive data never reaches logs or traces, and gives operators visibility into system health before business logic development begins in Phase 2.

## Scope

### In Scope

- Implement the `@monica-companion/redaction` package with pattern-based sensitive data sanitization (API keys, tokens, passwords, emails, phone numbers, Telegram user IDs).
- Create a shared `@monica-companion/observability` package that initializes the OpenTelemetry Node.js SDK (traces, metrics, logs) and wires in redaction as a log/span processor.
- Instrument all 7 Hono-based services (`telegram-bridge`, `ai-router`, `voice-transcription`, `monica-integration`, `scheduler`, `delivery`, `user-management`) with the shared observability package.
- Instrument `web-ui` (Astro/Node) with the same observability package, adapted for its runtime.
- Replace all `console.log` calls with structured OTel-backed logging.
- Propagate correlation IDs through trace context across service boundaries.
- Add `OTEL_EXPORTER_OTLP_ENDPOINT` and `OTEL_SERVICE_NAME` environment variables to all services in `docker-compose.yml`.
- Configure Loki retention (14 days), Tempo retention (14 days), and document Prometheus retention.
- Document retention and deletion policies as a governance specification file.
- Provision Grafana dashboards (JSON model files) for: service health, HTTP error rates, API latency (p50/p95/p99), job queue status, and placeholder panels for OpenAI budget burn and scheduler misfires.
- Provision Grafana alerting rules for: sustained high error rate, high latency, service down, and placeholder rules for quota exhaustion and scheduler misfires.
- Unit tests for the redaction package and observability setup.
- Docker Compose smoke tests verifying telemetry flows end-to-end from a service through the OTel Collector to Loki, Tempo, and Prometheus.

### Out of Scope

- BullMQ queue instrumentation (no queues are wired yet; that is Phase 4).
- OpenAI API call instrumentation (no OpenAI client exists yet; that is Phase 3).
- Monica API call instrumentation (no Monica client exists yet; that is Phase 2).
- Actual scheduler misfire detection (scheduler has no jobs yet; dashboard panels are placeholders).
- Custom OTel metrics for business KPIs (deferred to when business logic exists).
- Alertmanager or PagerDuty integration (alerts are configured in Grafana only for development visibility).
- Data deletion automation (policies are documented; automated purge jobs are deferred).
- Conversation state retention enforcement (no conversation state storage exists yet).

## Affected Services & Packages

| Package/Service | Changes |
|-----------------|---------|
| `packages/redaction` | Implement redaction functions: pattern matchers, field redactor, log record processor, span attribute processor |
| `packages/observability` (new) | New shared package: OTel SDK initialization, redacting log processor, redacting span processor, structured logger factory, Hono middleware for HTTP instrumentation |
| `services/telegram-bridge` | Add `@monica-companion/observability` dependency, initialize OTel before server start, replace `console.log` with structured logger, add HTTP instrumentation middleware |
| `services/ai-router` | Same as telegram-bridge |
| `services/voice-transcription` | Same as telegram-bridge |
| `services/monica-integration` | Same as telegram-bridge |
| `services/scheduler` | Same as telegram-bridge |
| `services/delivery` | Same as telegram-bridge |
| `services/user-management` | Same as telegram-bridge |
| `services/web-ui` | Add observability initialization adapted for Astro's Node adapter |
| `docker-compose.yml` | Add `OTEL_EXPORTER_OTLP_ENDPOINT` and `OTEL_SERVICE_NAME` env vars to all 8 app services; add `depends_on` for `otel-collector`; ensure observability profile services start before app services |
| `docker/loki-config.yaml` | Add retention configuration (14 days) |
| `docker/tempo-config.yaml` | Add retention/compaction configuration (14 days) |
| `docker/prometheus.yml` | Document retention flag (14 days via CLI arg in docker-compose) |
| `docker/grafana/provisioning/dashboards/` (new) | Dashboard provisioning config and JSON dashboard files |
| `docker/grafana/provisioning/alerting/` (new) | Alert rule provisioning files |
| `docker/otel-collector.yaml` | Add resource detection processor, batch processor, attributes processor for service metadata |
| `context/spec/data-governance.md` (new) | Retention, deletion, and redaction policy specification |
| `pnpm-workspace.yaml` | Add OpenTelemetry packages to catalog |
| `.env.example` | Already has `OTEL_EXPORTER_OTLP_ENDPOINT`; no changes needed |

## Architecture Decisions

### Shared Observability Package

Rather than duplicating OTel setup code in each service, a shared `@monica-companion/observability` package will export:

1. `initTelemetry(config)` -- initializes the OTel Node.js SDK with trace, metric, and log providers, configures the OTLP HTTP exporter, registers redacting processors, and returns a shutdown function.
2. `createLogger(name)` -- returns a structured logger backed by the OTel Logs API that automatically includes `service.name`, `correlation_id`, and other resource attributes.
3. `otelMiddleware()` -- Hono middleware that creates a span for each HTTP request, records status codes, latency, and route information, and propagates trace context.

This package depends on `@monica-companion/redaction` for sanitization.

### OTel SDK Initialization Pattern

Each service calls `initTelemetry()` as the very first operation in its entrypoint, before importing Hono or starting the HTTP server. This ensures all auto-instrumentation hooks are registered before any HTTP activity occurs.

```
// services/*/src/index.ts
import { initTelemetry } from "@monica-companion/observability";
const shutdown = initTelemetry({ serviceName: "telegram-bridge" });
// ... then import and start the app
```

The `initTelemetry` function uses the `@opentelemetry/sdk-node` `NodeSDK` class, which bundles:
- `@opentelemetry/exporter-trace-otlp-http` for traces
- `@opentelemetry/exporter-logs-otlp-http` for logs
- `@opentelemetry/exporter-metrics-otlp-http` for metrics
- `@opentelemetry/sdk-trace-node` with `BatchSpanProcessor`
- `@opentelemetry/sdk-logs` with `BatchLogRecordProcessor`
- `@opentelemetry/sdk-metrics` with `PeriodicExportingMetricReader`
- `@opentelemetry/resources` with `service.name` and `service.version`
- `@opentelemetry/instrumentation-http` for automatic HTTP client/server instrumentation

### Redaction Strategy

The `@monica-companion/redaction` package provides:

1. **Pattern-based field detection**: A configurable set of regex patterns that identify sensitive values (API keys, JWT tokens, bearer tokens, passwords, email addresses, phone numbers, Telegram user IDs in certain contexts).
2. **Field-name-based detection**: A set of field name patterns that should always have their values redacted (e.g., `authorization`, `api_key`, `password`, `secret`, `token`, `credential`, `x-telegram-bot-api-secret-token`).
3. **`redactValue(key, value)`**: Core function that checks if a field name or value matches sensitive patterns and returns `[REDACTED]` if so.
4. **`redactObject(obj)`**: Deep-clones an object and redacts all sensitive fields/values.
5. **`RedactingLogProcessor`**: An OTel `LogRecordProcessor` that sanitizes log record attributes and body before export.
6. **`RedactingSpanProcessor`**: An OTel `SpanProcessor` that sanitizes span attributes on span end before export.

Redaction is applied at the OTel SDK level (via custom processors) so that no sensitive data can reach the observability backends regardless of what application code logs. This is defense-in-depth: application code should also avoid logging secrets, but the processor catches anything that slips through.

### Retention Policy

Per `context/product/architecture.md` section 2.1 and `context/product/acceptance-criteria.md`:

| Data Category | Retention | Enforcement |
|---------------|-----------|-------------|
| Traces, logs, dead-letter payloads | 14 days | Loki retention config, Tempo compaction config, Prometheus `--storage.tsdb.retention.time` |
| Conversation summaries, pending-command records | 30 days after completion | Application-level (future, when storage exists) |
| Command logs, delivery audits | 90 days | Application-level (future, when storage exists) |
| Voice audio | Not retained post-transcription | Application-level (future) |

For this step, only the infrastructure-level retention (14 days for logs, traces, metrics) is enforced via backend configuration. Application-level retention is documented in the governance spec but enforcement is deferred to when the relevant data stores exist.

### Dashboard and Alert Strategy

Dashboards are provisioned as JSON files via Grafana's file-based provisioning. This makes them version-controlled and reproducible.

**Dashboard 1: Service Health Overview**
- Panels: per-service up/down status (from `/health` scraping or OTel heartbeat metrics), HTTP request rate, HTTP error rate (4xx, 5xx), average response time.

**Dashboard 2: HTTP Latency & Errors**
- Panels: p50/p95/p99 latency histograms per service, error rate time series, top error endpoints.

**Dashboard 3: Infrastructure & Queues (placeholder)**
- Panels: PostgreSQL connection pool status, Redis memory/connections, BullMQ queue depth and processing rate (placeholder until queues are wired).

**Dashboard 4: Operations & Alerts**
- Panels: OpenAI budget burn (placeholder), scheduler job status and misfires (placeholder), delivery success/failure rates (placeholder).

**Alert rules:**
- `ServiceDown`: any service `/health` endpoint unreachable for >1 minute.
- `HighErrorRate`: HTTP 5xx rate exceeds 5% of total requests for >2 minutes.
- `HighLatency`: p95 response time exceeds 5 seconds for >2 minutes.
- `QuotaExhaustion` (placeholder): OpenAI API errors with 429 status for >1 minute.
- `SchedulerMisfire` (placeholder): scheduled job missed its window by >6 hours.

## Implementation Steps

### Step 1: Implement `@monica-companion/redaction` core functions

**What:** Build the redaction package with pattern-based sensitive data detection and sanitization functions. This is pure logic with no external dependencies beyond Zod.

**Files to create/modify:**
- `packages/redaction/package.json` -- add `zod` dependency (from catalog)
- `packages/redaction/src/patterns.ts` -- sensitive field name patterns (regex array) and sensitive value patterns (regex array)
- `packages/redaction/src/redact.ts` -- `redactValue(key: string, value: unknown): unknown`, `redactObject<T>(obj: T): T` (deep clone + redact), `redactString(value: string): string` (applies value-pattern matching)
- `packages/redaction/src/index.ts` -- re-export all public API
- `packages/redaction/src/__tests__/redact.test.ts` -- unit tests

**Sensitive field name patterns to match (case-insensitive):**
- `authorization`, `api_key`, `apikey`, `api-key`, `password`, `secret`, `token`, `credential`, `x-telegram-bot-api-secret-token`, `setup_token_secret`, `jwt_secret`, `encryption_master_key`, `monica_api_token`, `openai_api_key`, `cookie`

**Sensitive value patterns to match:**
- Bearer tokens: `Bearer [A-Za-z0-9._-]+`
- JWT-like: `eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}`
- API key patterns: `sk-[A-Za-z0-9]{20,}` (OpenAI style)
- UUID-like tokens in setup URLs: left alone (not inherently secret)
- HMAC signatures: left alone (useless without secret)

**TDD sequence:**
1. Write failing test: `redactValue("authorization", "Bearer abc123")` returns `"[REDACTED]"`.
2. Implement field-name check.
3. Write failing test: `redactValue("x-custom", "Bearer abc123.def.ghi")` returns a redacted string (value pattern match).
4. Implement value-pattern check.
5. Write failing test: `redactObject({ headers: { authorization: "Bearer tok" }, body: "safe" })` returns object with redacted `authorization` but untouched `body`.
6. Implement deep-clone redaction.
7. Write failing test: `redactValue("user_name", "Alice")` returns `"Alice"` (not sensitive).
8. Verify non-sensitive data passes through.
9. Write failing test: nested objects are redacted recursively.
10. Implement recursive handling.

**Expected outcome:** `pnpm test` passes in `packages/redaction`. `pnpm build` produces the dist output.

### Step 2: Create `@monica-companion/observability` shared package with OTel SDK setup

**What:** Create a new shared package that initializes the OpenTelemetry SDK and wires in the redaction processors.

**Files to create:**
- `packages/observability/package.json` -- dependencies: `@monica-companion/redaction` (workspace), `@opentelemetry/sdk-node`, `@opentelemetry/api`, `@opentelemetry/api-logs`, `@opentelemetry/exporter-trace-otlp-http`, `@opentelemetry/exporter-logs-otlp-http`, `@opentelemetry/exporter-metrics-otlp-http`, `@opentelemetry/resources`, `@opentelemetry/semantic-conventions`, `@opentelemetry/instrumentation-http`, `@opentelemetry/sdk-trace-base`, `@opentelemetry/sdk-logs`, `@opentelemetry/sdk-metrics`, `zod` (from catalog). DevDependencies: `typescript`, `tsup`, `vitest` (from catalog).
- `packages/observability/tsconfig.json` -- extends `../../tsconfig.base.json`
- `packages/observability/tsup.config.ts` -- standard config matching other packages
- `packages/observability/src/config.ts` -- Zod schema for telemetry config: `{ serviceName: string, otlpEndpoint?: string, enabled?: boolean }`
- `packages/observability/src/processors.ts` -- `RedactingLogProcessor` (implements `LogRecordProcessor`, calls `redactObject` on attributes and `redactString` on body before delegating to an inner processor) and `RedactingSpanProcessor` (implements `SpanProcessor`, redacts span attributes on `onEnd`)
- `packages/observability/src/init.ts` -- `initTelemetry(config): { shutdown: () => Promise<void> }` function that creates the NodeSDK instance with all providers, exporters, and redacting processors
- `packages/observability/src/logger.ts` -- `createLogger(name: string)` factory that returns a thin wrapper over the OTel Logger API with `info`, `warn`, `error`, `debug` methods that accept structured data
- `packages/observability/src/middleware.ts` -- `otelMiddleware()` Hono middleware that extracts route info, creates/enriches spans, records HTTP metrics (request count, latency histogram), and propagates correlation IDs from the auth context into span attributes
- `packages/observability/src/index.ts` -- re-export public API

**Files to create for tests:**
- `packages/observability/src/__tests__/processors.test.ts` -- unit tests for redacting processors
- `packages/observability/src/__tests__/init.test.ts` -- unit tests for SDK initialization (verify it does not throw, creates providers, accepts config)
- `packages/observability/src/__tests__/logger.test.ts` -- unit tests for the logger wrapper
- `packages/observability/src/__tests__/middleware.test.ts` -- unit tests for the Hono middleware

**TDD sequence:**
1. Write failing test: `RedactingLogProcessor.onEmit` redacts log attributes containing `authorization` field.
2. Implement `RedactingLogProcessor`.
3. Write failing test: `RedactingSpanProcessor.onEnd` redacts span attributes containing sensitive values.
4. Implement `RedactingSpanProcessor`.
5. Write failing test: `initTelemetry` returns a shutdown function and does not throw.
6. Implement `initTelemetry` with in-memory exporters for testing.
7. Write failing test: `createLogger("test").info("msg", { key: "val" })` does not throw and emits a log record.
8. Implement logger wrapper.
9. Write failing test: `otelMiddleware()` creates a Hono middleware that responds without error on a test app.
10. Implement middleware.

**Dependency versioning note:** Before adding OpenTelemetry packages, verify the latest stable versions on npmjs.com and pin exact versions in `pnpm-workspace.yaml` catalog.

**Expected outcome:** `pnpm build` and `pnpm test` pass. Package exports are usable by services.

### Step 3: Add `pnpm-workspace.yaml` catalog entries for OpenTelemetry

**What:** Pin exact versions of all required OpenTelemetry npm packages in the pnpm catalog so all services and packages use consistent versions.

**Files to modify:**
- `pnpm-workspace.yaml` -- add to catalog section:
  - `@opentelemetry/sdk-node`
  - `@opentelemetry/api`
  - `@opentelemetry/api-logs`
  - `@opentelemetry/exporter-trace-otlp-http`
  - `@opentelemetry/exporter-logs-otlp-http`
  - `@opentelemetry/exporter-metrics-otlp-http`
  - `@opentelemetry/resources`
  - `@opentelemetry/semantic-conventions`
  - `@opentelemetry/instrumentation-http`
  - `@opentelemetry/sdk-trace-base`
  - `@opentelemetry/sdk-logs`
  - `@opentelemetry/sdk-metrics`

**Note:** This step is logically part of Step 2 but separated for clarity. In practice, do this before `pnpm install` for the observability package.

**Expected outcome:** `pnpm install` resolves all OTel packages at pinned versions.

### Step 4: Instrument `telegram-bridge` as the first service (reference implementation)

**What:** Wire the observability package into `telegram-bridge` to establish the pattern that all other services will follow. This service is chosen first because it has the most complete implementation (middleware, auth, route handlers).

**Files to modify:**
- `services/telegram-bridge/package.json` -- add `@monica-companion/observability` (workspace) and `@monica-companion/redaction` (workspace) as dependencies
- `services/telegram-bridge/src/index.ts` -- call `initTelemetry({ serviceName: "telegram-bridge" })` before importing/creating the app; register graceful shutdown; replace `console.log` with `createLogger`
- `services/telegram-bridge/src/app.ts` -- add `otelMiddleware()` to the Hono app (applied globally before route handlers); use structured logger instead of implicit console
- `services/telegram-bridge/src/config.ts` -- add optional `OTEL_EXPORTER_OTLP_ENDPOINT` to config schema

**Files to create:**
- `services/telegram-bridge/src/__tests__/observability.test.ts` -- test that the service starts without error when OTel is configured, and that the middleware adds trace context headers to responses

**TDD sequence:**
1. Write failing test: importing `createApp` after `initTelemetry` does not throw.
2. Wire initTelemetry into index.ts.
3. Write failing test: `GET /health` response includes a `traceparent` header (from OTel HTTP instrumentation).
4. Add otelMiddleware to app.
5. Write failing test: log output from service startup is structured (not raw console.log).
6. Replace console.log with createLogger.

**Expected outcome:** `telegram-bridge` emits traces, logs, and metrics to the OTel Collector endpoint. All existing tests continue to pass.

### Step 5: Instrument remaining 6 Hono services

**What:** Apply the same pattern established in Step 4 to the 6 remaining Hono-based services: `ai-router`, `voice-transcription`, `monica-integration`, `scheduler`, `delivery`, `user-management`.

**For each service, modify:**
- `services/{name}/package.json` -- add `@monica-companion/observability` and `@monica-companion/redaction` as workspace dependencies
- `services/{name}/src/index.ts` -- add `initTelemetry({ serviceName: "{name}" })` as first call, replace `console.log` with structured logger, register graceful shutdown
- For services that already have an `app.ts` (`user-management`): add `otelMiddleware()` globally
- For services without an `app.ts` (inline Hono in `index.ts`): refactor to `createApp()` pattern if needed, then add `otelMiddleware()`

**Order:** Start with `user-management` (has the most code), then the four minimal services (`ai-router`, `voice-transcription`, `monica-integration`, `scheduler`, `delivery`).

**For `user-management` specifically:**
- `services/user-management/src/app.ts` -- add `otelMiddleware()` before existing middleware
- `services/user-management/src/index.ts` -- add `initTelemetry` before app creation; replace `console.log` with logger

**TDD sequence (per service):**
1. Write failing test: `GET /health` response includes `traceparent` header after otelMiddleware is applied.
2. Add otelMiddleware.
3. Verify existing tests still pass.

**Expected outcome:** All 7 Hono services emit telemetry. All existing tests pass.

### Step 6: Instrument `web-ui` (Astro)

**What:** Add OpenTelemetry to the Astro service. Astro runs on Node.js via `@astrojs/node`, so the same SDK works, but initialization must happen in Astro's server entry point.

**Files to modify:**
- `services/web-ui/package.json` -- add `@monica-companion/observability` and `@monica-companion/redaction` as dependencies
- `services/web-ui/src/middleware.ts` -- add OTel trace context propagation to the existing CSRF middleware (enrich spans with route info and correlation ID)
- `services/web-ui/src/server-init.ts` (new) -- call `initTelemetry({ serviceName: "web-ui" })` and export the logger; this file is imported by the Astro config or server entry

**Approach:** Astro's Node adapter allows a custom server entry. We can use Astro's `astro:server:setup` integration hook or simply import the init module at the top of middleware.ts (which runs on every request). The simplest approach is to create a module-level side effect in a file that middleware.ts imports, ensuring OTel is initialized once on first request.

**Expected outcome:** `web-ui` emits traces and logs. CSRF middleware and setup page handling are visible in traces.

### Step 7: Update Docker Compose with OTel environment variables

**What:** Add the `OTEL_EXPORTER_OTLP_ENDPOINT` and `OTEL_SERVICE_NAME` environment variables to all 8 application services, and ensure they depend on the observability stack being up.

**Files to modify:**
- `docker-compose.yml`:
  - For each of the 8 app services, add:
    ```yaml
    environment:
      OTEL_EXPORTER_OTLP_ENDPOINT: http://otel-collector:4318
      OTEL_SERVICE_NAME: {service-name}
    ```
  - Add `depends_on` for `otel-collector` to each app service (conditional on the observability profile being active; if otel-collector is not running, the SDK should gracefully handle connection failures)

**Design note:** The OTel SDK should not crash the service if the collector is unreachable. The `initTelemetry` function must handle this gracefully: log a warning and continue with a noop exporter, never crash the service.

**Expected outcome:** When running `docker compose --profile app --profile observability up`, all services export telemetry to the collector.

### Step 8: Enhance OTel Collector configuration

**What:** Add resource detection, batch processing, and attribute enrichment to the OTel Collector pipeline for better data quality.

**Files to modify:**
- `docker/otel-collector.yaml`:
  - Add `batch` processor with sensible defaults (timeout: 5s, send_batch_size: 512)
  - Add `resource` processor to ensure `service.name` is present on all telemetry
  - Add `attributes` processor to add `deployment.environment: development` to all telemetry
  - Wire processors into all three pipelines (traces, logs, metrics)

**Expected outcome:** Telemetry data in backends has consistent resource attributes and is batched for efficiency.

### Step 9: Configure retention policies in observability backends

**What:** Set 14-day retention for logs (Loki), traces (Tempo), and metrics (Prometheus) as documented in the architecture specification.

**Files to modify:**
- `docker/loki-config.yaml` -- add `limits_config.retention_period: 336h` (14 days) and `compactor` configuration to enforce deletion
- `docker/tempo-config.yaml` -- add `compactor.compaction.block_retention: 336h` (14 days)
- `docker-compose.yml` -- add `--storage.tsdb.retention.time=14d` command arg to the `prometheus` service

**Files to create:**
- `context/spec/data-governance.md` -- formalize the retention, deletion, and redaction policies documented in `architecture.md` section 2.1, including:
  - Traces, logs, dead-letter payloads: 14 days
  - Conversation summaries, pending-command records: 30 days after completion
  - Command logs, delivery audits: 90 days
  - Voice audio: not retained post-transcription
  - Account disconnection: immediate credential deletion, 30-day purge of user data
  - Redaction scope: all logs, traces, dead letters, queue payloads, support tooling
  - Emergency purge: shorter retention allowed for security investigation
  - Note that application-level retention enforcement is deferred to when the relevant data stores are implemented

**Expected outcome:** Backends automatically expire data older than 14 days. Policy is documented.

### Step 10: Create Grafana dashboard provisioning

**What:** Set up Grafana file-based dashboard provisioning and create the initial dashboard JSON files.

**Files to create:**
- `docker/grafana/provisioning/dashboards/dashboards.yml` -- Grafana dashboard provisioning config pointing to `/etc/grafana/provisioning/dashboards/*.json`
- `docker/grafana/provisioning/dashboards/service-health.json` -- Dashboard 1: Service Health Overview
  - Row: per-service HTTP request rate (from OTel `http.server.request.duration` metric)
  - Row: per-service HTTP error rate (5xx / total)
  - Row: per-service up/down status
- `docker/grafana/provisioning/dashboards/http-latency.json` -- Dashboard 2: HTTP Latency & Errors
  - Row: p50/p95/p99 latency histograms per service
  - Row: error rate time series by service and route
  - Row: top slow endpoints
- `docker/grafana/provisioning/dashboards/operations.json` -- Dashboard 3: Operations
  - Row: placeholder panels for BullMQ queue depth and processing rate
  - Row: placeholder panels for OpenAI budget burn rate
  - Row: placeholder panels for scheduler job status and misfires
  - Row: placeholder panels for delivery success/failure rates

**Files to modify:**
- `docker-compose.yml` -- add volume mount for `./docker/grafana/provisioning/dashboards/` to the grafana service
- `docker/grafana/datasources.yml` -- move to `docker/grafana/provisioning/datasources/datasources.yml` for consistency with Grafana provisioning conventions (update the grafana volume mount accordingly)

**Expected outcome:** Starting Grafana automatically loads all dashboards. No manual import needed.

### Step 11: Create Grafana alerting rules

**What:** Define alert rules that fire on operational anomalies.

**Files to create:**
- `docker/grafana/provisioning/alerting/rules.yml` -- Grafana Unified Alerting provisioning file with:
  - `ServiceDown` -- any service HTTP metric absent for >1 minute (based on `http.server.request.duration` metric label)
  - `HighErrorRate` -- HTTP 5xx rate > 5% of total request rate over 2 minutes, per service
  - `HighLatency` -- p95 response time > 5 seconds over 2 minutes, per service
  - `QuotaExhaustion` (placeholder) -- description notes this will be wired when OpenAI metrics exist
  - `SchedulerMisfire` (placeholder) -- description notes this will be wired when scheduler job metrics exist

**Files to modify:**
- `docker-compose.yml` -- add volume mount for alerting provisioning to grafana service; add `GF_UNIFIED_ALERTING_ENABLED: "true"` env var

**Expected outcome:** Grafana shows alert rules in the alerting UI. Active rules evaluate but only fire when conditions are met.

### Step 12: End-to-end smoke test

**What:** Verify the full telemetry pipeline works from application services through the OTel Collector to all three backends, and that dashboards and alerts are provisioned.

**Steps:**
1. Start full stack: `docker compose --profile app --profile observability up -d`
2. Wait for health checks on all services.
3. Generate traffic: send HTTP requests to services (via docker exec curl to internal endpoints).
4. Verify traces appear in Tempo (query the Tempo API via Grafana or directly).
5. Verify logs appear in Loki (query the Loki API).
6. Verify metrics appear in Prometheus (query the Prometheus API).
7. Verify dashboards are loaded in Grafana (query provisioning API).
8. Verify alert rules are loaded in Grafana (query alerting API).
9. Verify redaction: check that no sensitive data appears in logs or trace attributes stored in backends.
10. Tear down.

See Smoke Test Strategy section for detailed commands.

## Test Strategy

### Unit Tests (Vitest)

| Module | What to test | What to mock |
|--------|-------------|--------------|
| `packages/redaction/src/redact.ts` | Field-name pattern matching, value pattern matching, deep object redaction, arrays, nested objects, non-sensitive passthrough, edge cases (null, undefined, numbers) | Nothing (pure functions) |
| `packages/observability/src/processors.ts` | `RedactingLogProcessor` redacts log attributes and body; `RedactingSpanProcessor` redacts span attributes | OTel `LogRecord` and `ReadableSpan` interfaces (create test doubles) |
| `packages/observability/src/init.ts` | `initTelemetry` creates providers without throwing, returns shutdown function, handles missing endpoint gracefully | OTel SDK internals (use in-memory/noop exporters) |
| `packages/observability/src/logger.ts` | Logger methods emit log records with correct severity, attributes, and body | OTel Logger API (use in-memory log exporter) |
| `packages/observability/src/middleware.ts` | Hono middleware sets span attributes for route, method, status; propagates correlation ID from auth context | Hono test app (use `app.request()`) |

### Integration Tests

| Test | What needs real infra |
|------|----------------------|
| OTel pipeline test | OTel Collector + Loki/Tempo (verifies that telemetry exported from SDK actually arrives in backends) -- this is covered by the smoke test rather than an automated integration test, because it requires the full Docker Compose stack |

### TDD Sequence Summary

For each step, the workflow is:
1. Write the failing test for the next behavior slice.
2. Run `pnpm test` in the relevant package to confirm it fails with the expected assertion error.
3. Write the minimal implementation to make it pass.
4. Refactor if needed.
5. Continue to next test.

The primary TDD-driven work is in Steps 1 (redaction) and 2 (observability package). Steps 4-6 (service instrumentation) primarily verify that existing tests still pass and add a small number of new tests for the middleware behavior.

## Smoke Test Strategy

### Docker Compose Services to Start

```bash
# Start infrastructure and observability
docker compose up -d postgres redis caddy
docker compose --profile observability up -d

# Wait for observability stack to be ready
sleep 10

# Start app services
docker compose --profile app up -d
```

Wait for health checks:
```bash
# Verify services are healthy
docker exec $(docker compose ps -q telegram-bridge) curl -sf http://localhost:3001/health
docker exec $(docker compose ps -q user-management) curl -sf http://localhost:3007/health
docker exec $(docker compose ps -q ai-router) curl -sf http://localhost:3002/health
```

### HTTP Checks to Run

**Check 1: Services emit traces**
```bash
# Generate traffic
docker exec $(docker compose ps -q telegram-bridge) curl -sf http://localhost:3001/health
# Wait for batch export
sleep 10
# Query Tempo for traces from telegram-bridge
curl -sf "http://localhost:3200/api/search?tags=service.name%3Dtelegram-bridge&limit=1" | grep -q "traceID"
# Expected: at least one trace found
```

**Check 2: Services emit logs to Loki**
```bash
# Query Loki for logs from telegram-bridge
curl -sf "http://localhost:3100/loki/api/v1/query?query=%7Bservice_name%3D%22telegram-bridge%22%7D&limit=5"
# Expected: log entries present
```

**Check 3: Metrics are available in Prometheus**
```bash
# Query Prometheus for HTTP metrics
curl -sf "http://localhost:9090/api/v1/query?query=http_server_request_duration_seconds_count" | grep -q "telegram-bridge"
# Expected: metric with telegram-bridge label present
```

**Check 4: Dashboards are provisioned in Grafana**
```bash
# Query Grafana provisioning API
curl -sf "http://localhost:3000/api/search?type=dash-db" | grep -q "Service Health"
# Expected: dashboard found
```

**Check 5: Alert rules are provisioned in Grafana**
```bash
# Query Grafana alerting API
curl -sf "http://localhost:3000/api/v1/provisioning/alert-rules" | grep -q "HighErrorRate"
# Expected: alert rule found
```

**Check 6: Redaction is working**
```bash
# Send a request with an Authorization header to an internal endpoint
docker exec $(docker compose ps -q telegram-bridge) curl -sf \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.test.test" \
  http://localhost:3001/health

# Wait for export
sleep 10

# Query Loki for any log containing the token value
RESULT=$(curl -sf "http://localhost:3100/loki/api/v1/query?query=%7Bservice_name%3D%22telegram-bridge%22%7D%20%7C~%20%22eyJhbGciOiJIUzI1NiJ9%22&limit=1")
# Expected: no results (token was redacted before export)
```

**Check 7: Retention config is active**
```bash
# Verify Loki retention config
curl -sf "http://localhost:3100/config" | grep -q "retention_period"
# Expected: retention_period is set

# Verify Prometheus retention
curl -sf "http://localhost:9090/api/v1/status/flags" | grep -q "storage.tsdb.retention.time"
# Expected: 14d
```

### What the Smoke Test Proves

- All 8 services export traces, logs, and metrics to the OTel Collector.
- The OTel Collector correctly routes telemetry to Loki (logs), Tempo (traces), and Prometheus (metrics).
- Grafana can query all three backends and dashboards are auto-provisioned.
- Alert rules are loaded and evaluating.
- Sensitive data (JWT tokens, authorization headers) is redacted before reaching Loki/Tempo.
- Retention policies are configured in all backends.
- The observability pipeline does not break existing service functionality.

### Teardown

```bash
docker compose --profile app --profile observability down
docker compose down
```

## Security Considerations

1. **Redaction as defense-in-depth** (ref: `security.md` -- sensitive data never logged): The `RedactingLogProcessor` and `RedactingSpanProcessor` operate at the OTel SDK level, ensuring that even if application code accidentally logs a secret, it is sanitized before export. This is the last line of defense; application code should still avoid logging secrets.

2. **Redaction pattern coverage** (ref: `security.md` -- sensitive data in logs, traces, queue payloads, dead letters, support tooling): The pattern set covers JWT tokens, Bearer headers, API keys (OpenAI `sk-` pattern), MonicaHQ API tokens, setup token secrets, encryption keys, passwords, authorization headers, cookies, and the `X-Telegram-Bot-Api-Secret-Token` header. The pattern set must be reviewed and extended whenever new secret types are introduced.

3. **OTel Collector is internal-only** (ref: `security.md` -- internal APIs not publicly exposed): The OTel Collector listens on ports 4317/4318 on the `internal` Docker network only. It is not exposed through Caddy. The Grafana UI on port 3000 is also internal-only and not routed through Caddy.

4. **No PII in trace attributes** (ref: `security.md` -- keep personal data out of traces): The `otelMiddleware()` records route, method, status code, and correlation ID in span attributes. It does not record request/response bodies, user IDs, or other PII. If future middleware needs to add user context to spans, it must go through `redactValue` first.

5. **Log body redaction** (ref: `security.md` -- redaction in dead letters, queue payloads): Log record bodies are passed through `redactString` before export. This catches accidental logging of secrets in message strings (e.g., `logger.info("Token: abc123")`). However, pattern matching on free-text is inherently imperfect; the primary defense is to never log secrets in application code.

6. **Observability credentials** (ref: `security.md` -- keep secrets out of logs): Grafana is configured with `GF_SECURITY_ADMIN_PASSWORD: admin` for development only. Production deployments must use proper secrets. This is documented in the data governance spec.

7. **Retention limits security data exposure window** (ref: `architecture.md` section 2.1): The 14-day retention limit bounds the window during which any inadvertently captured data is accessible. Emergency purge procedures are documented in the governance spec for security incidents requiring shorter retention.

## Risks & Open Questions

1. **OpenTelemetry package versioning:** The OTel JS ecosystem has many interrelated packages that must be version-compatible. Before implementation, the implementer must verify the latest stable `@opentelemetry/sdk-node` version and ensure all other OTel packages are from the same release train. Pin exact versions after verification.

2. **Astro OTel integration:** Astro's Node adapter runs in a standard Node.js process, so the OTel Node SDK should work. However, Astro's Vite-based build pipeline may have issues with OTel's auto-instrumentation hooks if they rely on module patching. The fallback is to use manual instrumentation (explicit span creation) rather than `@opentelemetry/instrumentation-http` for the web-ui service.

3. **OTel SDK graceful degradation:** When the `observability` Docker Compose profile is not active, the OTel Collector is not running, and the OTLP exporter will fail to connect. The `initTelemetry` function must handle this gracefully: log a warning and continue with a noop exporter, never crash the service.

4. **Grafana dashboard JSON complexity:** Hand-authoring Grafana dashboard JSON is tedious and error-prone. The dashboards in this plan are intentionally minimal (a few panels per dashboard). They should be built in the Grafana UI first, exported as JSON, and then committed as provisioning files. The plan describes the panels; the exact JSON will be generated during implementation.

5. **Placeholder panels and alerts:** Several dashboard panels and alert rules are placeholders because the underlying metrics do not exist yet (no BullMQ queues, no OpenAI calls, no scheduler jobs). These placeholders must be updated when the corresponding services are implemented in Phases 2-4. They are included now to establish the dashboard structure and avoid later churn.

6. **Prometheus scrape config for service metrics:** The current `prometheus.yml` only scrapes the OTel Collector. If services expose their own Prometheus endpoints (e.g., for Node.js runtime metrics), additional scrape targets will need to be added. For V1, all metrics flow through the OTel Collector, so no direct service scraping is needed.

7. **Log volume in development:** With all services emitting structured logs via OTel, the development-time log volume may be noisy. Consider adding a `LOG_LEVEL` environment variable to `initTelemetry` config that defaults to `info` and can be set to `warn` or `error` for quieter development.

8. **Grafana provisioning directory restructure:** The current datasources file is at `docker/grafana/datasources.yml` but Grafana provisioning expects `provisioning/datasources/` and `provisioning/dashboards/` subdirectories. Step 10 moves the datasources file to the correct provisioning path. This changes the volume mount in docker-compose.yml.

9. **Redaction false positives:** Aggressive pattern matching may redact non-sensitive values that happen to match patterns (e.g., a user message containing "Bearer" as a word). The patterns should be tuned to minimize false positives while ensuring all known secret formats are caught. The `redactValue` function operates on key-value pairs, not free text in user messages, which limits this risk.

10. **Metric naming conventions:** OTel semantic conventions define standard metric names (e.g., `http.server.request.duration`). Grafana dashboards must use these exact names. If the OTel SDK version changes metric naming conventions, dashboards will need updating. Pin to a specific OTel version and document the expected metric names.
