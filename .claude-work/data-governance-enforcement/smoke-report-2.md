---
verdict: PASS
services_tested: ["ai-router", "scheduler", "delivery", "user-management"]
checks_run: 16
checks_passed: 16
---

# Smoke Test Report: Data Governance Enforcement (Attempt 2)

## Environment
- Services started: ai-router (port 3002), scheduler (port 3005), delivery (port 3006), user-management (port 3007), postgres (port 5432), redis (port 6379)
- Node.js image: node:24.14.0-slim
- Health check status: all healthy
- Stack was already running; services were restarted to pick up latest code after bug fixes
- Migration `0002_data_purge_requests.sql` confirmed applied

## Bug Fixes Verified (from attempt 1)
1. **ai-router:** Path-scoped auth on `/process` -- confirmed no interference with `/retention-cleanup` or `/users/:userId/data`
2. **delivery:** Path-scoped auth on `/deliver` -- confirmed no interference with `/retention-cleanup` or `/users/:userId/data`
3. **scheduler:** CTE result extraction with `result.rows[0]` -- retention cleanup returns correct numeric counts

## Custom Checks

| # | Check | Expected | Actual | Result |
|---|-------|----------|--------|--------|
| 1 | GET /health ai-router | 200 | 200 | PASS |
| 2 | GET /health scheduler | 200 | 200 | PASS |
| 3 | GET /health delivery | 200 | 200 | PASS |
| 4 | GET /health user-management | 200 | 200 | PASS |
| 5 | POST /internal/retention-cleanup on ai-router (iss=scheduler) | 200 + `{purged:{conversationTurns:0,pendingCommands:0}}` | 200 + matching body | PASS |
| 6 | POST /internal/retention-cleanup on delivery (iss=scheduler) | 200 + `{purged:{deliveryAudits:0}}` | 200 + matching body | PASS |
| 7 | POST /internal/retention-cleanup on ai-router (iss=telegram-bridge, wrong caller) | 403 | 403 | PASS |
| 8 | DELETE /internal/users/:id/data on ai-router (iss=user-management) | 200 + `{purged:{conversationTurns:0,pendingCommands:0}}` | 200 + matching body | PASS |
| 9 | DELETE /internal/users/:id/data on scheduler (iss=user-management) | 200 + `{purged:{commandExecutions:0,idempotencyKeys:0,reminderWindows:0}}` | 200 + matching body | PASS |
| 10 | DELETE /internal/users/:id/data on delivery (iss=user-management) | 200 + `{purged:{deliveryAudits:0}}` | 200 + matching body | PASS |
| 11 | DELETE /internal/users/:id/data on ai-router (iss=scheduler, wrong caller) | 403 | 403 | PASS |
| 12 | POST /internal/retention-cleanup with no auth header | 401 | 401 | PASS |
| 13 | DELETE /internal/users/:id/data with no auth header | 401 | 401 | PASS |
| 14 | DELETE /internal/users/:id/disconnect on user-management (iss=telegram-bridge) | 200 + `{disconnected:true, purgeScheduledAt:...}` | 200 + matching body | PASS |
| 15 | DELETE /internal/users/:id/disconnect (iss=scheduler, wrong caller) | 403 | 403 | PASS |
| 16 | DELETE /internal/users/:id/disconnect for non-existent user | 404 | 404 | PASS |

## Database Verifications (post-disconnect)

| Check | Expected | Actual | Result |
|-------|----------|--------|--------|
| User credentials revoked | `monica_base_url='revoked'`, `encryption_key_id='revoked'`, token cleared | Confirmed | PASS |
| Purge request created | `status='pending'`, `reason='account_disconnection'`, `purge_after` ~30 days out | Confirmed (purge_after = 2026-04-19) | PASS |
| Audit log entry | `actor_service='telegram-bridge'` | Confirmed | PASS |

## JWT Generation Approach
- Used `jose` library (v6.2.1) from pnpm store to sign HS256 tokens
- JWT_SECRET: `change-me-in-production` (from `.env`)
- Tokens signed with proper `iss` (issuer/caller), `aud` (audience/target), `jti`, `iat`, `exp` (120s TTL)
- UUID format note: Zod v4 enforces strict RFC 4122 UUID validation; test UUIDs used version-4 format (`a0000000-0000-4000-8000-...`)

## Failures
None.

## Teardown
All services stopped cleanly. Networks removed. Test user data cleaned from database before teardown.
