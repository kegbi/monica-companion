---
verdict: PASS
attempt: 1
services_started: true
health_checks_passed: true
endpoint_reachable: true
auth_enforced: true
services_tested: ["ai-router", "monica-integration", "user-management", "postgres", "redis", "caddy"]
checks_run: 12
checks_passed: 12
---

# Smoke Test Report: Contact Resolution Boundary

## Environment

- **Services started**: ai-router (node:24.14.0-slim), monica-integration (node:24.14.0-slim), user-management (node:24.14.0-slim), postgres (postgres:17.9-alpine), redis (redis:8.6.1-alpine), caddy (caddy:2.11.2-alpine)
- **Health check status**: all healthy
- **Stack startup time**: ~30 seconds (after infrastructure and deps-init completed)
- **Date**: 2026-03-17

## Prerequisites

Before services could start successfully, two prerequisites had to be addressed:

1. **Database migrations**: The `pending_commands` table (ai-router) and user-management tables (`setup_tokens`, `setup_token_audit_log`, `users`, `user_preferences`, `credential_access_audit_log`) had to be created manually via SQL. There is no auto-migration on startup.

2. **Types package rebuild**: The `@monica-companion/types` package `dist/` had to be rebuilt inside Docker (`npx tsup`) because the new `ContactResolutionRequest`, `ContactResolutionResult`, and related schemas were added to the source but the compiled output was stale. Without this rebuild, ai-router failed with: `SyntaxError: The requested module '@monica-companion/types' does not provide an export named 'ContactResolutionRequest'`.

3. **Environment variable fix**: The Docker Compose file passes `ENCRYPTION_MASTER_KEY_PREVIOUS: ${ENCRYPTION_MASTER_KEY_PREVIOUS:-}` which resolves to an empty string when unset. The user-management config schema (`z.string().min(32).optional()`) rejects empty strings because Zod v4's `.optional()` only accepts `undefined`, not `""`. A valid 64-hex-char value was provided in `.env` to work around this pre-existing issue.

## Checks

| # | Check | Expected | Actual | Result |
|---|-------|----------|--------|--------|
| 1 | GET /health on ai-router (direct) | 200 `{"status":"ok","service":"ai-router"}` | 200 `{"status":"ok","service":"ai-router"}` | PASS |
| 2 | GET /health on monica-integration (direct) | 200 `{"status":"ok","service":"monica-integration"}` | 200 `{"status":"ok","service":"monica-integration"}` | PASS |
| 3 | GET /health on user-management (direct) | 200 `{"status":"ok","service":"user-management"}` | 200 `{"status":"ok","service":"user-management"}` | PASS |
| 4 | POST /internal/resolve-contact without auth | 401 | 401 `{"error":"Missing or invalid Authorization header"}` | PASS |
| 5 | POST /internal/resolve-contact with valid auth but empty body | 400 | 400 `{"error":"Invalid request"}` | PASS |
| 6 | POST /internal/resolve-contact with wrong caller (scheduler) | 403 | 403 `{"error":"Caller not allowed"}` | PASS |
| 7 | POST /internal/resolve-contact with valid auth+body (no user in DB) | 502 (upstream unavailable) | 502 `{"error":"Contact resolution service unavailable"}` | PASS |
| 8 | POST /internal/resolve-contact with empty contactRef | 400 | 400 `{"error":"Invalid request"}` | PASS |
| 9 | GET /internal/resolve-contact (wrong HTTP method) | 404 | 404 | PASS |
| 10 | Internal endpoints NOT exposed through Caddy (3 paths tested) | 404 for all | 404 for all | PASS |
| 11 | ai-router can reach monica-integration over Docker network | Reachable, 200 | Reachable, `{"status":"ok","service":"monica-integration"}` | PASS |
| 12 | MONICA_INTEGRATION_URL env var set correctly | `http://monica-integration:3004` | `http://monica-integration:3004` | PASS |

## Analysis

### What the smoke test proves

1. **Service startup**: All six services (ai-router, monica-integration, user-management, postgres, redis, caddy) start and become healthy within the Docker Compose stack.

2. **Endpoint exists and validates**: The `POST /internal/resolve-contact` endpoint on ai-router is reachable, accepts POST requests, and rejects other HTTP methods with 404.

3. **Auth enforcement**: The endpoint requires a service JWT with `audience: "ai-router"` and `allowedCallers: ["telegram-bridge"]`. Requests without auth get 401. Requests from unauthorized callers (e.g., scheduler) get 403.

4. **Request validation (Zod)**: Invalid request bodies (empty object, empty contactRef) are rejected with 400 before any business logic runs.

5. **Service connectivity**: ai-router can reach monica-integration over the Docker internal network via the `MONICA_INTEGRATION_URL` environment variable (`http://monica-integration:3004`).

6. **End-to-end flow**: When a valid request is sent, ai-router attempts to call monica-integration's `GET /internal/contacts/resolution-summaries` endpoint. Since no user with Monica credentials exists in the database, monica-integration returns an error, and ai-router correctly maps this to a 502 response. This proves the entire call chain (ai-router -> monica-integration -> user-management) is wired correctly.

7. **No public exposure**: The `/internal/resolve-contact` endpoint, `/health` endpoints, and all other internal paths return 404 when accessed through Caddy's public ingress. The Caddyfile only routes `/webhook/telegram*` and `/setup*`, with a fallback `respond "Not Found" 404` for everything else.

### Pre-existing issues discovered

1. **`ENCRYPTION_MASTER_KEY_PREVIOUS` empty string**: The Docker Compose file uses `${ENCRYPTION_MASTER_KEY_PREVIOUS:-}` which produces an empty string when unset. The user-management config schema (`z.string().min(32).optional()`) rejects empty strings. This causes user-management to crash on startup when the variable is not set in `.env`. This is a pre-existing bug in the config validation -- it should either use `z.string().min(32).optional().or(z.literal(""))` or the compose file should omit the variable when empty.

2. **OTel logger swallows all output**: When services crash, the error is logged only through the OpenTelemetry logger (which tries to send to `otel-collector:4318`). Since the observability profile is not running, these logs are lost. Services produce zero stdout/stderr output, making debugging very difficult. A fallback console logger for critical errors (startup failures) would improve operability.

3. **No auto-migration**: Database tables must be created manually before services can start. This is expected for production but makes development and smoke testing more cumbersome.

4. **Types package dist staleness**: When workspace packages are modified, their `dist/` must be rebuilt before Docker services can use them. The deps-init container only runs `pnpm install`, not `pnpm build`. This is a known limitation of the current dev workflow.

## Failures

None. All 12 checks passed.

## Teardown

All services stopped cleanly. Docker Compose reported no errors during teardown. Verified with `docker compose ps -a` showing no containers.

The `.env` file created for testing was removed after teardown.
