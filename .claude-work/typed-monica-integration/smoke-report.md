---
verdict: PASS
checks_passed: 9
checks_failed: 0
checks_total: 9
---

# Smoke Test Report: Typed Monica Integration

## Environment
- Services started: postgres:17.9-alpine, redis:8.6.1-alpine, caddy:2.11.2-alpine, user-management (node:24.14.0-slim), monica-integration (node:24.14.0-slim)
- Health check status: all healthy (both user-management and monica-integration responded on first poll)
- Stack startup time: ~25 seconds (including deps-init pnpm install from cached volume)
- JWT_SECRET: `smoke-test-jwt-secret-2024` (temporary, used only during test)

## Checks

| # | Check | Expected | Actual | Result |
|---|-------|----------|--------|--------|
| 1 | GET /health on monica-integration (internal) | 200 `{"status":"ok","service":"monica-integration"}` | 200 `{"status":"ok","service":"monica-integration"}` | PASS |
| 2 | GET /internal/contacts/resolution-summaries without auth token | 401 | 401 `{"error":"Missing or invalid Authorization header"}` | PASS |
| 3 | GET /internal/contacts/resolution-summaries with issuer=scheduler (wrong caller) | 403 | 403 `{"error":"Caller not allowed"}` | PASS |
| 4 | GET /internal/contacts/resolution-summaries with invalid JWT secret | 401 | 401 `{"error":"Invalid or expired token"}` | PASS |
| 5 | GET /internal/contacts/resolution-summaries with valid auth (issuer=ai-router) | 502 (credential resolution fails, no Monica configured) | 502 `{"error":"Failed to resolve user credentials"}` | PASS |
| 6 | GET /internal/contacts/resolution-summaries via Caddy (port 80) | 404 (not exposed) | 404 | PASS |
| 7 | GET /health via Caddy (port 80) | 404 (not exposed) | 404 | PASS |
| 8 | POST /internal/contacts with issuer=ai-router (wrong caller for scheduler-only endpoint) | 403 | 403 `{"error":"Caller not allowed"}` | PASS |
| 9 | Cross-service: monica-integration -> user-management:3007/health | 200 | 200 `{"status":"ok","service":"user-management"}` | PASS |

## Check Details

### Check 1: Health Endpoint
```
docker compose exec monica-integration node -e "fetch('http://localhost:3004/health').then(r=>r.text()).then(console.log)"
```
Response: `{"status":"ok","service":"monica-integration"}`

### Check 2: Missing Auth Token
```
docker compose exec monica-integration node -e "fetch('http://localhost:3004/internal/contacts/resolution-summaries').then(async r => console.log(r.status, await r.text()))"
```
Response: 401 `{"error":"Missing or invalid Authorization header"}`

### Check 3: Wrong Caller (scheduler on ai-router-only endpoint)
Generated HS256 JWT with `iss: "scheduler"`, `aud: "monica-integration"`, signed with the correct secret. The `/internal/contacts/resolution-summaries` endpoint only allows `["ai-router"]`.
Response: 403 `{"error":"Caller not allowed"}`

### Check 4: Invalid JWT Secret
Generated HS256 JWT with `iss: "ai-router"`, `aud: "monica-integration"`, but signed with `"wrong-secret"` instead of the configured JWT_SECRET.
Response: 401 `{"error":"Invalid or expired token"}`

### Check 5: Valid Auth, Credential Resolution Failure
Generated valid HS256 JWT with `iss: "ai-router"`, `aud: "monica-integration"`, `sub: "test-user-123"`, signed with the correct secret. The request passed auth, reached the handler, attempted to fetch Monica credentials from user-management. Since MONICA_BASE_URL and MONICA_API_TOKEN are not set, the stub credential endpoint on user-management returned 404, which monica-integration maps to 502.
Response: 502 `{"error":"Failed to resolve user credentials"}`

This confirms the entire auth chain works (JWT validation, caller allowlist, user ID extraction, cross-service credential resolution attempt).

### Check 6: Internal Endpoint Not Exposed via Caddy
```
curl -s -o /dev/null -w '%{http_code}' http://localhost:80/internal/contacts/resolution-summaries
```
Response: 404 (Caddy's catch-all handler)

The Caddyfile only routes `/webhook/telegram*` and `/setup*`. All other paths return 404. `monica-integration` is on the `internal` network only, not the `public` network, and has no Caddy route.

### Check 7: Health Endpoint Not Exposed via Caddy
```
curl -s -o /dev/null -w '%{http_code}' http://localhost:80/health
```
Response: 404

### Check 8: Write Endpoint Caller Allowlist
Generated valid JWT with `iss: "ai-router"` calling `POST /internal/contacts` (allowed callers: `["scheduler"]` only).
Response: 403 `{"error":"Caller not allowed"}`

### Check 9: Cross-Service Networking
```
docker compose exec monica-integration node -e "fetch('http://user-management:3007/health').then(async r => console.log(r.status, await r.text()))"
```
Response: 200 `{"status":"ok","service":"user-management"}`

Confirms Docker internal network DNS resolution and connectivity between services.

## Failures
None.

## Teardown
All services stopped cleanly via `docker compose --profile app down` followed by `docker compose down`. Both `internal` and `public` networks removed. Temporary `.env` file removed from project root.
