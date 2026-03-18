---
verdict: PASS
attempt: 1
services_started: true
health_checks_passed: true
---

# Smoke Test Report: Benchmark & Quality Gates

## Environment
- Services started: postgres:17.9-alpine, redis:8.6.1-alpine, node:24.14.0-slim (deps-init, user-management, monica-integration, ai-router)
- Health check status: all healthy (postgres healthy, redis healthy, ai-router responding 200 on /health)
- Stack startup time: < 5 seconds after deps-init completed

## Checks
| # | Check | Expected | Actual | Result |
|---|-------|----------|--------|--------|
| 1 | ai-router container running | running | running | PASS |
| 2 | GET /health returns 200 with correct JSON | 200 `{"status":"ok","service":"ai-router"}` | 200 `{"status":"ok","service":"ai-router"}` | PASS |
| 3 | POST /internal/resolve-contact without auth | 401 | 401 `{"error":"Missing or invalid Authorization header"}` | PASS |
| 4 | GET /internal/resolve-contact (wrong method) | 404 | 404 | PASS |
| 5 | GET /nonexistent (unknown route) | 404 | 404 | PASS |
| 6 | ai-router port NOT published to host | No published ports | No published ports | PASS |
| 7 | No benchmark import errors in logs | No errors | No errors found (NO_ERRORS_FOUND) | PASS |
| 8 | Infrastructure dependencies healthy | postgres healthy, redis healthy | postgres healthy, redis healthy | PASS |

## Failures
None.

## Notes

This is a minimal smoke test appropriate for the Benchmark & Quality Gates task. The benchmark framework is a build-time test artifact that adds no new runtime endpoints or behavior. The primary verification for this task is the CI gate (`pnpm bench:ai`), which runs the evaluation runner and asserts threshold compliance. The Docker smoke test confirms that the benchmark module's code (fixtures, evaluation runner, barrel exports under `src/benchmark/`) does not introduce import-time side effects, startup failures, or regressions in ai-router's existing runtime behavior.

Key observations:
- ai-router started on the first attempt with no errors
- The health endpoint responds correctly, confirming the Hono app initialized without issues
- The contact resolution endpoint's auth middleware still enforces JWT authentication (401 without token)
- The benchmark directory is excluded from the production runtime path (it is under `src/benchmark/` and not imported by `app.ts` or `index.ts`)

## Teardown
All services stopped and removed cleanly. Networks removed. Temporary .env file deleted.
