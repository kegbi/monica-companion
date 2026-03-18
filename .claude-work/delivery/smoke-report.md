---
verdict: PASS
services_tested: ["delivery", "postgres", "redis", "caddy"]
checks_run: 8
checks_passed: 8
---

# Smoke Test Report: Delivery

## Environment
- Services started: postgres:17.9-alpine, redis:8.6.1-alpine, caddy:2.11.2-alpine, delivery (node:24.14.0-slim via tsx)
- Health check status: all healthy
- Stack startup time: ~40 seconds (includes deps-init pnpm install)
- Note: pnpm-lock.yaml was out of date for the delivery service's new dependencies (drizzle-orm, postgres, @opentelemetry/api, drizzle-kit, @types/node). This was fixed during the smoke test by running `pnpm install --no-frozen-lockfile` to regenerate the lockfile.

## Pre-test Fix Required
The `pnpm-lock.yaml` was not updated when new dependencies were added to `services/delivery/package.json`. The `deps-init` container failed with `ERR_PNPM_OUTDATED_LOCKFILE`. This was resolved by:
1. Removing stale `.ignored_*` symlinks in local `node_modules`
2. Running `pnpm install --no-frozen-lockfile` to update the lockfile
3. The `delivery_audits` table schema was pushed via `drizzle-kit push` from within the container

## Checks

| # | Check | Expected | Actual | Result |
|---|-------|----------|--------|--------|
| 1 | GET /health on internal network | 200 `{"status":"ok","service":"delivery"}` | 200 `{"status":"ok","service":"delivery"}` | PASS |
| 2 | POST /internal/deliver without auth token | 401 | 401 | PASS |
| 3 | delivery_audits table has all 10 expected columns | id, correlation_id, user_id, connector_type, connector_routing_id, content_type, status, error, created_at, completed_at | All 10 columns present with correct types | PASS |
| 4 | /internal/deliver NOT publicly exposed via Caddy | 404 (Caddy catch-all) | 404 | PASS |
| 5a | POST /internal/deliver with valid JWT + invalid payload | 400 `{"status":"rejected","error":"Invalid payload"}` | 400 `{"status":"rejected","error":"Invalid payload"}` | PASS |
| 5b | POST /internal/deliver with valid intent (connector down) | 502 with deliveryId and status "failed" | 502 `{"deliveryId":"0a06a13e-...","status":"failed","error":"fetch failed"}` | PASS |
| 5c | Audit row persisted in delivery_audits for failed delivery | Row with status="failed", correlation_id="smoke-test-corr-002" | Row found with matching data, both created_at and completed_at set | PASS |
| 6 | POST with disallowed caller (telegram-bridge issuer) | 403 | 403 `{"error":"Caller not allowed"}` | PASS |
| 7 | POST with scheduler caller (allowed) | 502 (connector down, but auth passes) | 502 `{"deliveryId":"1ca7875c-...","status":"failed","error":"fetch failed"}` | PASS |
| 8 | Database indexes on delivery_audits | PK + idx_delivery_audits_user_created + idx_delivery_audits_correlation | All 3 indexes present | PASS |

## Detailed Results

### Check 1: Health Endpoint
- Command: `docker compose exec delivery curl -sf http://localhost:3006/health`
- Expected: `{"status":"ok","service":"delivery"}`
- Actual: `{"status":"ok","service":"delivery"}`
- Status: PASS

### Check 2: Auth Enforcement (No Token)
- Command: `docker compose exec delivery curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:3006/internal/deliver -H "Content-Type: application/json" -d '{}'`
- Expected: 401
- Actual: 401
- Status: PASS

### Check 3: Database Schema
- Command: `docker compose exec postgres psql -U monica -d monica_companion -c "SELECT column_name, data_type FROM information_schema.columns WHERE table_name='delivery_audits' ORDER BY ordinal_position;"`
- Expected: 10 columns (id/uuid, correlation_id/text, user_id/text, connector_type/text, connector_routing_id/text, content_type/text, status/text, error/text, created_at/timestamptz, completed_at/timestamptz)
- Actual: All 10 columns present with correct types
- Status: PASS

### Check 4: Not Publicly Exposed via Caddy
- Command: `curl -s -o /dev/null -w "%{http_code}" http://localhost/internal/deliver`
- Expected: 404 (Caddy catch-all responds "Not Found")
- Actual: 404
- Also verified: `curl http://localhost/health` returns 404
- Status: PASS

### Check 5a: Invalid Payload with Valid Auth
- Command: POST with valid JWT (issuer: ai-router, audience: delivery) but invalid body `{"invalid": "payload"}`
- Expected: 400 with `{"status":"rejected","error":"Invalid payload"}`
- Actual: 400 `{"status":"rejected","error":"Invalid payload"}`
- Status: PASS

### Check 5b: Valid Intent with Connector Down
- Command: POST with valid JWT and valid OutboundMessageIntent (telegram connector)
- Expected: 502 with deliveryId and status "failed" (telegram-bridge not running)
- Actual: 502 `{"deliveryId":"0a06a13e-0ae5-45d7-b518-a605f2bbaa74","status":"failed","error":"fetch failed"}`
- Status: PASS

### Check 5c: Audit Persistence Verification
- Command: `SELECT * FROM delivery_audits WHERE correlation_id = 'smoke-test-corr-002'`
- Expected: Row with status="failed", connector_type="telegram", error="fetch failed"
- Actual: Row found with all fields correctly populated, including created_at and completed_at timestamps
- Status: PASS

### Check 6: Disallowed Caller (Caller Allowlist)
- Command: POST with JWT signed by telegram-bridge (not in allowed callers list)
- Expected: 403
- Actual: 403 `{"error":"Caller not allowed"}`
- Status: PASS

### Check 7: Scheduler Caller Accepted
- Command: POST with JWT signed by scheduler (in allowed callers list) with valid intent
- Expected: 502 (auth passes, connector down)
- Actual: 502 `{"deliveryId":"1ca7875c-dcdf-4dbc-9a71-527fa7c4ef63","status":"failed","error":"fetch failed"}`
- Status: PASS

### Check 8: Database Indexes
- Command: `SELECT indexname FROM pg_indexes WHERE tablename = 'delivery_audits'`
- Expected: delivery_audits_pkey, idx_delivery_audits_user_created, idx_delivery_audits_correlation
- Actual: All 3 indexes present
- Status: PASS

## Issues Found

### Lockfile Not Updated (Pre-existing, Fixed During Test)
The `pnpm-lock.yaml` was not updated when the delivery service gained new dependencies (`drizzle-orm`, `postgres`, `@opentelemetry/api`, `drizzle-kit`, `@types/node`). This caused `deps-init` to fail with `ERR_PNPM_OUTDATED_LOCKFILE`. The lockfile was regenerated during this smoke test session. This is a residual issue from the implementation phase that should be committed.

## Failures
None. All 8 checks passed.

## Teardown
All services stopped cleanly. `docker compose ps -a` confirms no containers remain.
```
NAME      IMAGE     COMMAND   SERVICE   CREATED   STATUS    PORTS
```

## Summary
All 8 smoke checks passed. The delivery service correctly:
1. Serves health endpoint on internal network
2. Enforces JWT authentication (401 without token)
3. Enforces caller allowlist (403 for disallowed callers, accepts ai-router and scheduler)
4. Validates inbound payloads via Zod schema (400 for invalid payloads)
5. Persists audit records in PostgreSQL for every delivery attempt
6. Returns structured DeliveryResponse with deliveryId, status, and error
7. Handles connector failures gracefully (502 with failed audit)
8. Is NOT exposed publicly through the Caddy reverse proxy
9. Has proper database indexes for query performance

One pre-existing issue was found and fixed: the pnpm lockfile was out of date for the delivery service's new dependencies. This fix should be committed alongside the delivery implementation.
