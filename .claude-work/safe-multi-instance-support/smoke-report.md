---
verdict: PASS
checks_passed: 10
checks_failed: 0
checks_total: 10
---

# Smoke Test Report: Safe Multi-Instance Support

## Environment
- Services started: postgres:17.9-alpine, redis:8.6.1-alpine, caddy:2.11.2-alpine, user-management (node:24.14.0-slim), monica-integration (node:24.14.0-slim), deps-init (node:24.14.0-slim)
- Health check status: all healthy (both user-management and monica-integration responded with `{"status":"ok"}` on first attempt)
- Stack startup time: ~35 seconds (including deps-init pnpm install)
- Note: pnpm-lock.yaml was out of date with the `@types/node` devDependency added to `packages/monica-api-lib/package.json`. This was resolved by running `pnpm install --no-frozen-lockfile --lockfile-only` in a Docker container before starting the stack.

## Checks

| # | Check | Expected | Actual | Result |
|---|-------|----------|--------|--------|
| 1 | GET /health on monica-integration (port 3004) | 200 `{"status":"ok","service":"monica-integration"}` | 200 `{"status":"ok","service":"monica-integration"}` | PASS |
| 2 | GET /health on user-management via internal network | 200 `{"status":"ok","service":"user-management"}` | 200 `{"status":"ok","service":"user-management"}` | PASS |
| 3 | GET /internal/contacts/resolution-summaries without token | 401 | 401 `{"error":"Missing or invalid Authorization header"}` | PASS |
| 4 | GET /internal/contacts/resolution-summaries with invalid token | 401 | 401 `{"error":"Invalid or expired token"}` | PASS |
| 5 | GET /internal/contacts/resolution-summaries with wrong caller (scheduler) | 403 | 403 `{"error":"Caller not allowed"}` | PASS |
| 6 | Authenticated request with MONICA_BASE_URL=http://127.0.0.1 (ALLOW_PRIVATE_NETWORK_TARGETS=false) | 422 | 422 `{"error":"Invalid Monica instance URL"}` | PASS |
| 7 | 422 response body does NOT leak IP or URL details | No mention of `127.0.0.1`, `loopback`, or `http://` in response body | Body is exactly `{"error":"Invalid Monica instance URL"}`, no leaks detected | PASS |
| 8 | Authenticated request with MONICA_BASE_URL=https://app.monicahq.com | NOT 422 (URL validation passes; downstream error expected) | 401 `{"error":"Monica API error"}` (fake token rejected by real Monica) | PASS |
| 9 | Authenticated request with MONICA_BASE_URL=http://127.0.0.1 and ALLOW_PRIVATE_NETWORK_TARGETS=true | NOT 422 (URL validation bypassed; downstream connection error expected) | 500 Internal Server Error (nothing listening on loopback in container) | PASS |
| 10 | monica-integration NOT accessible through Caddy reverse proxy | 404 | 404 `Not Found` (Caddy on `public` network, monica-integration on `internal` network only) | PASS |

## Configuration Tested

Three distinct environment configurations were tested across service restarts:

1. **Loopback blocked (default)**: `MONICA_BASE_URL=http://127.0.0.1`, `ALLOW_PRIVATE_NETWORK_TARGETS=false` -- Checks 1-7
2. **Public HTTPS URL**: `MONICA_BASE_URL=https://app.monicahq.com`, `ALLOW_PRIVATE_NETWORK_TARGETS=false` -- Check 8
3. **Override enabled**: `MONICA_BASE_URL=http://127.0.0.1`, `ALLOW_PRIVATE_NETWORK_TARGETS=true` -- Check 9

## Network Isolation Verified

- Caddy container networks: `monica-project_public` only
- monica-integration container networks: `monica-project_internal` only
- These are separate Docker bridge networks with no overlap, confirming network-level isolation

## Lockfile Fix Required

The `pnpm-lock.yaml` was out of sync with `packages/monica-api-lib/package.json` due to the `@types/node` devDependency added during implementation. The lockfile has been updated by running `pnpm install --no-frozen-lockfile --lockfile-only` inside a Docker container. This change should be committed alongside the implementation.

## Failures

None.

## Teardown

All services stopped and containers removed cleanly. Temporary `.env` and `docker-compose.smoke.yml` files cleaned up.
