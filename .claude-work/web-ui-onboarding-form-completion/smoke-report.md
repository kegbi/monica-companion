---
verdict: PASS
services_tested: ["web-ui", "user-management", "caddy", "postgres", "redis", "ai-router", "telegram-bridge", "monica-integration", "delivery", "scheduler"]
checks_run: 100
checks_passed: 97
---

# Smoke Test Report: Web-UI Onboarding Form Completion

## Environment
- Services started: postgres:17.9-alpine, redis:8.6.1-alpine, caddy:2.11.2-alpine, node:24.14.0-slim (all app services)
- Health check status: all healthy except voice-transcription (pre-existing timeout issue, unrelated to onboarding)
- Stack startup time: ~90s (including deps-init pnpm install)
- Port remapping: postgres 15432->5432, redis 16379->6379 (Hyper-V port exclusions on Windows)

## Vitest Smoke Suite
- Exit code: 1 (due to pre-existing voice-transcription failures only)
- Test files: 7 passed / 2 failed (9 total)
- Tests: 97 passed / 3 failed (100 total)
- New tests added: 16 tests in `onboarding.smoke.test.ts`
  - 7 Caddy proxy tests (success page, error pages, XSS safety, security headers)
  - 3 direct web-ui tests (success page, error page variants)
  - 5 end-to-end flow tests (token issuance, form load, form submit, DB verification, replay rejection)
  - 2 CSRF protection tests (missing origin, missing CSRF cookie)

### New test file: `tests/smoke/onboarding.smoke.test.ts`
| # | Test | Result |
|---|------|--------|
| 1 | GET /setup/success via Caddy returns 200 with completion message | PASS |
| 2 | GET /setup/error?reason=expired via Caddy returns expired message | PASS |
| 3 | GET /setup/error?reason=already_consumed via Caddy returns appropriate message | PASS |
| 4 | GET /setup/error with unknown reason does not render raw param (XSS safety) | PASS |
| 5 | Caddy sets security headers on /setup routes (nosniff, DENY, strict-origin) | PASS |
| 6 | Caddy strips Server header on /setup routes | PASS |
| 7 | GET /setup/success direct to web-ui returns 200 with HTML | PASS |
| 8 | GET /setup/error?reason=validation_failed direct to web-ui | PASS |
| 9 | GET /setup/error without reason param shows generic message | PASS |
| 10 | Issue setup token via user-management (telegram-bridge caller) | PASS |
| 11 | Form page loads with all 7 onboarding fields and CSRF cookie | PASS |
| 12 | Form submission with CSRF creates user and redirects to /setup/success | PASS |
| 13 | User record + preferences created in DB with encrypted credentials | PASS |
| 14 | Replaying consumed token redirects to /setup/error | PASS |
| 15 | POST without Origin header returns 403 (CSRF protection) | PASS |
| 16 | POST without CSRF cookie returns 403 (CSRF protection) | PASS |

### Pre-existing failures (NOT related to onboarding)
| # | Test | Expected | Actual | Notes |
|---|------|----------|--------|-------|
| 1 | voice-transcription /health | 200 | timeout | Service not responding on port 3003 |
| 2 | voice-transcription /internal/transcribe no auth | 401 | timeout | Same root cause |
| 3 | voice-transcription /internal/transcribe wrong caller | 403 | timeout | Same root cause |

## Custom Checks
All task-specific behaviors covered by the Vitest suite; no additional custom checks needed.

The onboarding smoke tests verify the complete flow through the real network path:
1. Token issuance (user-management API with JWT auth)
2. Form rendering (Astro SSR through Caddy reverse proxy)
3. CSRF protection (Astro built-in + custom double-submit cookie)
4. Form submission (through Caddy -> web-ui -> user-management with transaction)
5. Database verification (user + preferences created with encrypted credentials)
6. Replay protection (consumed token cannot be reused)
7. Security headers (X-Content-Type-Options, X-Frame-Options, Referrer-Policy, no Server header)
8. XSS safety (error page allowlist prevents raw query param rendering)

## Infrastructure Changes
- `docker-compose.yml`: Postgres host port remapped from 5432 to 15432 (Hyper-V exclusion)
- `docker-compose.yml`: Redis host port remapped from 6379 to 16379 (Hyper-V exclusion)
- `docker-compose.smoke.yml`: Added web-ui port exposure (4321:4321)
- `tests/smoke/smoke-config.ts`: Added WEB_UI_URL config (default http://localhost:4321), updated POSTGRES_URL default port
- `tests/smoke/run.sh`: Added WEB_UI_URL export, updated POSTGRES_URL default port

## Failures
The 3 failures are all in voice-transcription and are pre-existing -- the service container is running but not responding to HTTP requests. This is unrelated to the onboarding form feature. All other 97 tests pass, including all 16 new onboarding tests.

## Teardown
All services stopped cleanly. Networks removed.

## Verdict Rationale
PASS. All 16 onboarding-specific smoke tests pass. The complete end-to-end flow works through the real network path (Caddy reverse proxy -> web-ui Astro SSR -> user-management API -> PostgreSQL). The 3 voice-transcription failures are pre-existing timeouts unrelated to this feature. No regressions were introduced by the onboarding form implementation.
