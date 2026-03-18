---
verdict: PASS
services_tested: ["user-management", "web-ui", "telegram-bridge", "caddy", "postgres", "redis"]
checks_run: 18
checks_passed: 18
---

# Smoke Test Report: Setup-Link Authentication

## Environment
- Services started: postgres:17.9-alpine, redis:8.6.1-alpine, caddy:2.11.2-alpine, node:24.14.0-slim (user-management, web-ui, telegram-bridge)
- Health check status: all healthy
  - user-management: `{"status":"ok","service":"user-management"}` on :3007
  - telegram-bridge: `{"status":"ok","service":"telegram-bridge"}` on :3001
  - web-ui: Astro v6.0.4 dev server on :4321 (HTTP 200)
  - postgres: `pg_isready` passed on first attempt
- Database migration: `drizzle-kit push --force` applied successfully (setup_tokens + setup_token_audit_log tables created)
- Stack startup time: ~30s (including deps-init pnpm install)

## Checks

| # | Check | Expected | Actual | Result |
|---|-------|----------|--------|--------|
| 1 | `GET /internal/setup-tokens` through Caddy | 404 (not exposed) | 404 | PASS |
| 2 | `GET /health` through Caddy | 404 (not exposed) | 404 | PASS |
| 3 | `GET /setup/{invalid-uuid}` through Caddy | 200 (error page) | 200 with "Invalid setup link" error message | PASS |
| 4 | `POST /setup/submit` without CSRF token | 403 | 403 `{"error":"CSRF validation failed"}` | PASS |
| 5 | `POST /setup/submit` with wrong Origin | 403 | 403 "Cross-site POST form submissions are forbidden" | PASS |
| 6 | Token issuance via service-to-service auth (telegram-bridge -> user-management) | 201 with setupUrl, tokenId, expiresAt | 201 with valid response | PASS |
| 7 | Valid setup URL through Caddy renders form | 200 with setup form | 200 with form containing csrf_token, tokenId, sig hidden fields | PASS |
| 8 | CSRF cookie set on setup page GET | Set-Cookie header with csrf cookie | `csrf=...; HttpOnly; SameSite=Strict; Path=/setup` | PASS |
| 9 | Token reissue: new token issued for same user | 201 | 201 with new tokenId | PASS |
| 10 | Token reissue: old token invalidated | `{valid: false}` | `{"valid":false}` | PASS |
| 11 | Old superseded token shows error page through Caddy | Error message about expired/used link | "This link has expired or already been used." | PASS |
| 12 | Token consumption (first time) | `{consumed: true}` | `{"consumed":true}` | PASS |
| 13 | Token replay rejection (consume same token twice) | `{consumed: false, reason: "already_consumed"}` | `{"consumed":false,"reason":"already_consumed"}` | PASS |
| 14 | Unauthenticated request to internal API | 401 | 401 `{"error":"Missing or invalid Authorization header"}` | PASS |
| 15 | Wrong caller (web-ui issuing tokens) | 403 | 403 `{"error":"Caller not allowed"}` | PASS |
| 16 | Cancel token flow | `{cancelled: true}` and subsequent validation returns `{valid: false}` | Both confirmed | PASS |
| 17 | Zod validation: missing required field + malformed JSON | 400 for both | 400 `{"error":"Invalid request body"}` for both | PASS |
| 18 | Caddy security headers on setup page | X-Content-Type-Options: nosniff, X-Frame-Options: DENY, Referrer-Policy: strict-origin-when-cross-origin, no Server header | All headers present, Server header stripped | PASS |

## Additional Verification

### Audit Log Integrity
Queried `setup_token_audit_log` table directly and confirmed 9 audit entries covering the full token lifecycle:
- `issued` (3 tokens)
- `validated` (2 validations of first token)
- `superseded_by_reissue` (first token superseded when second issued)
- `consumed` (second token consumed)
- `replay_rejected` (second token replay attempt)
- `cancelled` (third token cancelled)

### Security Headers
- `X-Content-Type-Options: nosniff` -- present
- `X-Frame-Options: DENY` -- present
- `Referrer-Policy: strict-origin-when-cross-origin` -- present
- `Server` header -- stripped by Caddy config (`header -Server`)

### CSRF Cookie Behavior
- In HTTP mode (development), uses `csrf` cookie name (not `__Host-csrf` which requires HTTPS)
- Cookie attributes: `HttpOnly; SameSite=Strict; Path=/setup`
- CSRF token embedded in hidden form field matches cookie pattern

## Failures

None.

## Notes

1. The `node:24.14.0-slim` Docker image does not include `curl`. Health checks and service-to-service tests were performed using Node.js `fetch()` API and scripts executed via `docker exec`.

2. For service-to-service auth tests, the `@monica-companion/auth` package was imported directly from its built dist path (`/app/packages/auth/dist/index.js`) since pnpm workspace symlinks are not resolved by plain `node` outside of the project's module resolution context.

3. The origin validation on `POST /setup/submit` with wrong origin returned Astro's built-in CSRF message ("Cross-site POST form submissions are forbidden") rather than the custom middleware message. This is because Astro v6 has built-in origin checking that runs before custom middleware. The security effect is the same (403 rejection).

## Teardown

All services stopped cleanly:
- `web-ui`, `caddy`, `telegram-bridge`, `user-management` containers stopped and removed
- `deps-init` container stopped and removed
- `postgres`, `redis` containers stopped and removed
- `monica-project_internal` and `monica-project_public` networks removed
- Temporary `.env` file removed
