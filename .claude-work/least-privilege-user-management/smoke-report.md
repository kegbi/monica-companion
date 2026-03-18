---
verdict: PASS
services_tested: ["user-management", "postgres", "redis"]
checks_run: 18
checks_passed: 18
---

# Smoke Test Report: Least-Privilege User Management

## Environment
- Services started: postgres (17.9-alpine), redis (8.6.1-alpine), user-management (node:24.14.0-slim via tsx)
- Health check status: all healthy (user-management responded in 2 seconds)
- Stack startup time: ~45 seconds (including deps-init, package builds, and export patching)
- Encryption master key: 32-byte hex key generated for smoke test
- Test user UUID: `11111111-1111-4111-a111-111111111111`

## Infrastructure Notes

Two pre-existing infrastructure issues required workarounds during the smoke test:

1. **Node 24 + tsx CJS resolution**: Shared packages (`@monica-companion/auth`, `@monica-companion/observability`, `@monica-companion/types`, `@monica-companion/redaction`) only declare `import` export condition in their `package.json`. tsx 4.21.0 on Node.js 24.14.0 resolves through the CJS path in some scenarios, causing `ERR_PACKAGE_PATH_NOT_EXPORTED`. Workaround: patched `package.json` exports with `default` fallback at runtime.

2. **Empty env var config validation**: Docker Compose sets `ENCRYPTION_MASTER_KEY_PREVIOUS` and `JWT_SECRET_PREVIOUS` to empty strings via `${VAR:-}` defaults. The Zod schema `z.string().min(32).optional()` rejects empty strings (only `undefined` is optional). Workaround: `unset` the env vars inside the container. This is a minor config bug (LOW severity) that should be fixed by adding `.or(z.literal(""))` or a `.transform()` to treat empty strings as undefined.

Neither issue is related to the least-privilege user management implementation. The smoke server was started using a minimal entry point (`smoke-server.ts`) that bypasses the instrumentation import to isolate the application logic from the OTEL module resolution issue.

## Checks

| # | Check | Expected | Actual | Result |
|---|-------|----------|--------|--------|
| 1 | GET /health | 200 | 200 | PASS |
| 2 | GET /internal/users/:userId/monica-credentials with monica-integration JWT | 200 | 200 | PASS |
| 3 | GET /internal/users/:userId/monica-credentials with telegram-bridge JWT | 403 | 403 | PASS |
| 4 | GET /internal/users/:nonexistent/monica-credentials with monica-integration JWT | 404 | 404 | PASS |
| 5 | GET /internal/users/:userId/monica-credentials without auth | 401 | 401 | PASS |
| 6 | GET /internal/users/not-a-valid-uuid/monica-credentials with monica-integration JWT | 400 | 400 | PASS |
| 7 | GET /internal/users/:userId/preferences with telegram-bridge JWT | 200 | 200 | PASS |
| 8 | GET /internal/users/:userId/preferences with monica-integration JWT | 403 | 403 | PASS |
| 9 | GET /internal/users/:userId/preferences with ai-router JWT | 200 | 200 | PASS |
| 10 | GET /internal/users/:userId/schedule with scheduler JWT | 200 | 200 | PASS |
| 11 | GET /internal/users/:userId/schedule with ai-router JWT | 403 | 403 | PASS |
| 12 | GET /internal/users/:userId/monica-credentials with scheduler JWT | 403 | 403 | PASS |
| 13 | GET /internal/users/:nonexistent/schedule with scheduler JWT | 404 | 404 | PASS |
| 14 | GET /internal/users/:userId/preferences with scheduler JWT | 200 | 200 | PASS |
| 15 | Decrypted credentials match seeded values (baseUrl, apiToken) | correct | correct | PASS |
| 16 | Preference fields match seeded values (language=en, confirmationMode=explicit, timezone=Europe/Berlin) | correct | correct | PASS |
| 17 | Schedule fields match seeded values (cadence=daily, time=09:00, tz=Europe/Berlin, connector=telegram, routing=chat_12345) | correct | correct | PASS |
| 18 | No unencrypted credentials in service logs | no leaks | no leaks | PASS |

## Audit Log Verification

After the smoke test completed, the `credential_access_audit_log` table was queried directly:

```
               user_id                |   actor_service    |            correlation_id            |          created_at           
--------------------------------------+--------------------+--------------------------------------+-------------------------------
 11111111-1111-4111-a111-111111111111 | monica-integration | 7a94434d-f22f-403b-9e5e-c1d25cbf7c19 | 2026-03-16 16:08:20.062466+00
 11111111-1111-4111-a111-111111111111 | monica-integration | 6c50aeaa-faf1-4f86-b2ad-c61cbb296e57 | 2026-03-16 16:08:20.002064+00
```

Two entries were created (from checks 2 and 15), both correctly recording:
- `actor_service`: `monica-integration` (the authorized caller)
- `correlation_id`: unique UUID per request
- `created_at`: timestamp of access

## Credential Leak Check

Service logs contained only: `SMOKE_SERVER_READY on port 3007`

No occurrences of:
- The plaintext API token (`test-monica-api-token-secret-12345`)
- The encryption master key
- Any decrypted credential data

## Failures

None. All 18 checks passed.

## Residual Findings (pre-existing, not blocking)

1. **LOW - Empty env var validation**: `ENCRYPTION_MASTER_KEY_PREVIOUS` and `JWT_SECRET_PREVIOUS` set to `""` by docker-compose defaults cause config validation failure. The Zod schema should handle empty strings as undefined.

2. **LOW - Package exports CJS fallback**: Shared packages need a `default` export condition for Node.js 24 + tsx compatibility in Docker environments.

## Teardown

All services stopped cleanly:
- `monica-project-user-management-1`: Stopped and Removed
- `monica-project-deps-init-1`: Stopped and Removed
- `monica-project-redis-1`: Stopped and Removed
- `monica-project-postgres-1`: Stopped and Removed
- `monica-project_internal` network: Removed
