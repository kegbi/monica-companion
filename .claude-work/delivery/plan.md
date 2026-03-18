# Implementation Plan: Delivery

## Objective

Complete the `delivery` service as a standalone deployable in the initial Telegram-only V1 profile. The service receives connector-neutral outbound message intents from `ai-router` and `scheduler`, resolves the target connector, forwards the payload, persists delivery audit records in PostgreSQL, and exposes failure visibility through OpenTelemetry. Formatting remains exclusively in the connector (`telegram-bridge`), not in `delivery`.

## Scope

### In Scope

- Add PostgreSQL (Drizzle) `delivery_audits` table to the `delivery` service
- Add `DATABASE_URL` and `HTTP_TIMEOUT_MS` config entries and database connection
- Persist a delivery audit record for every `/internal/deliver` request (success, failure, or rejection) with correlation ID, connector type, recipient routing metadata, content type tag, status, failure reason, and timestamps
- Add explicit HTTP timeout handling for the outbound connector call via `AbortSignal.timeout()`
- Add a `DeliveryResponseSchema` Zod schema to `@monica-companion/types`
- Add structured logging (via `@monica-companion/observability`) and OpenTelemetry spans for deliver-and-audit operations
- Add redaction via `@monica-companion/redaction` if any structured payload is logged
- Add `drizzle-orm`, `postgres`, `drizzle-kit`, and `@opentelemetry/api` dependencies
- Add `drizzle.config.ts`, migration generation scripts, and migration SQL
- Add comprehensive unit tests (Vitest) following TDD
- Update Docker Compose environment for the `delivery` container
- Smoke test the real Docker Compose network path
- Mark the Delivery roadmap items as complete after verification

### Out of Scope

- Multi-connector routing beyond Telegram (only Telegram connector exists in V1)
- Platform-specific formatting (stays in `telegram-bridge`)
- Retry logic for delivery failures (delivery is best-effort fire-and-forward; callers like `scheduler` own retries)
- Changes to `OutboundMessageIntentSchema` in `@monica-companion/types` (already well-defined)
- Changes to `telegram-bridge`'s `/internal/send` endpoint (already functional)
- Automated 90-day retention purge jobs for delivery audits (documented for Phase 5)
- Fixing the empty `connectorRoutingId` issue in the scheduler's delivery intents (pre-existing, tracked as a risk)

## Affected Services & Packages

| Package/Service | Changes |
|-----------------|---------|
| `packages/types` | Add `DeliveryResponseSchema`, `DeliveryAuditStatus` enum, and tests |
| `services/delivery` | Add DB schema, connection, audit persistence, timeout handling, logging, spans, config update, drizzle config, migration, tests; refactor `app.ts` to accept `AppDeps` |
| `docker-compose.yml` | Add `DATABASE_URL` and `HTTP_TIMEOUT_MS` env vars to the `delivery` container |
| `context/product/roadmap.md` | Mark Delivery items as complete after verification |

## Implementation Steps

### Step 1: Add DeliveryResponseSchema to shared types

**What:** Define a Zod schema for the standardized response from `POST /internal/deliver` and a `DeliveryAuditStatus` type.

**Files to create/modify:**
- Create `packages/types/src/delivery.ts` with `DeliveryAuditStatusSchema` (Zod enum: `"delivered"`, `"failed"`, `"rejected"`) and `DeliveryResponseSchema` (object: `deliveryId: string`, `status: DeliveryAuditStatusSchema`, `error?: string`)
- Modify `packages/types/src/index.ts` to add exports

**TDD sequence:**
1. Write a failing test in `packages/types/src/__tests__/delivery.test.ts`:
   - Accepts `{ deliveryId: "uuid", status: "delivered" }`
   - Accepts `{ deliveryId: "uuid", status: "failed", error: "timeout" }`
   - Rejects missing `deliveryId`
   - Rejects invalid status value `"pending"`
2. Implement `delivery.ts` with the Zod schemas
3. Add exports to `index.ts`

### Step 2: Add Drizzle schema and database connection to delivery

**What:** Define the `delivery_audits` table using Drizzle ORM and set up the database connection, following the pattern in `services/scheduler/src/db/`.

**Files to create:**
- `services/delivery/src/db/schema.ts`
- `services/delivery/src/db/connection.ts`
- `services/delivery/drizzle.config.ts`

**Table: `delivery_audits`**

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid | PK, `gen_random_uuid()` |
| `correlation_id` | text | NOT NULL |
| `user_id` | text | NOT NULL |
| `connector_type` | text | NOT NULL (e.g., "telegram") |
| `connector_routing_id` | text | NOT NULL (e.g., Telegram chat ID) |
| `content_type` | text | NOT NULL (e.g., "text", "confirmation_prompt") |
| `status` | text | NOT NULL, default "pending" |
| `error` | text | NULL, populated on failure |
| `created_at` | timestamptz | NOT NULL, `defaultNow()` |
| `completed_at` | timestamptz | NULL, set when status changes to terminal |

**Indexes:**
- `idx_delivery_audits_user_created` on `(user_id, created_at)`
- `idx_delivery_audits_correlation` on `(correlation_id)`

### Step 3: Update delivery config and add dependencies

**What:** Extend the delivery service config to require `DATABASE_URL` and add `HTTP_TIMEOUT_MS` with a default of 10000ms.

**Files to modify:**
- `services/delivery/src/config.ts`
- `services/delivery/package.json` (add `drizzle-orm`, `postgres`, `@opentelemetry/api`, `drizzle-kit`)

**TDD sequence:**
1. Write failing tests: `loadConfig()` throws without `DATABASE_URL`, defaults `httpTimeoutMs` to 10000
2. Update config schema and interface

### Step 4: Refactor app.ts with audit persistence, timeout, and tracing

**What:** Refactor `createApp` to accept `AppDeps` with database. For each `/internal/deliver`:
1. Validate inbound intent
2. Reject unsupported connector type with audit
3. Insert `delivery_audits` record with status `"pending"`
4. Forward to connector with `AbortSignal.timeout(config.httpTimeoutMs)`
5. On success: update audit to `"delivered"`, return `{ deliveryId, status: "delivered" }`
6. On failure: update audit to `"failed"`, return `{ deliveryId, status: "failed", error }` with 502
7. On validation failure: insert audit with `"rejected"`, return 400

**AppDeps interface:**
```typescript
export interface AppDeps {
  db: Database;
}
```

**Tracing:** `tracer.startActiveSpan("delivery.forward", ...)` with attributes:
- `delivery.audit_id`, `delivery.correlation_id`, `delivery.connector_type`
- `delivery.content_type`, `delivery.status`, `delivery.duration_ms`

**Critical decision:** If audit insert fails (DB down), request fails with 503. Audit persistence is a compliance requirement.

**TDD sequence:**
1. Valid intent returns 200 with `{ deliveryId, status: "delivered" }` + audit
2. Connector failure returns 502 with `{ deliveryId, status: "failed" }` + audit
3. Invalid payload returns 400 with `{ status: "rejected" }` + audit
4. Unsupported connector returns 400 with `{ status: "rejected" }` + audit
5. Timeout triggers failure audit and 502
6. DB insert failure returns 503
7. Update all existing tests for `AppDeps` pattern

### Step 5: Update index.ts to wire database connection

**What:** Wire `createDb(config.databaseUrl)` into `createApp(config, { db })`.

### Step 6: Update Docker Compose and generate migration

**What:** Add `DATABASE_URL` and `HTTP_TIMEOUT_MS` to delivery container environment. Generate migration SQL.

**Docker Compose additions:**
```yaml
DATABASE_URL: postgresql://monica:monica_dev@postgres:5432/monica_companion
HTTP_TIMEOUT_MS: ${HTTP_TIMEOUT_MS:-10000}
```

### Step 7: Run all unit tests

```bash
pnpm --filter @monica-companion/types test
pnpm --filter @monica-companion/delivery test
pnpm test
```

### Step 8: Smoke test against Docker Compose

See Smoke Test Strategy below.

### Step 9: Mark roadmap complete

Update `context/product/roadmap.md` to mark all four Delivery sub-items as `[x]`.

## Test Strategy

### Unit Tests (Vitest)

**`packages/types/src/__tests__/delivery.test.ts`:**
- Accepts valid delivered/failed/rejected responses
- Rejects missing deliveryId and invalid status values

**`services/delivery/src/__tests__/config.test.ts`:**
- Requires DATABASE_URL, defaults httpTimeoutMs to 10000, parses custom HTTP_TIMEOUT_MS

**`services/delivery/src/__tests__/app.test.ts`:**
- Health endpoint returns 200
- Auth enforcement returns 401 without token
- Caller allowlist returns 403 for disallowed caller
- Invalid payload returns 400 with audit status "rejected"
- Unsupported connector returns 400 with audit status "rejected"
- Valid intent returns 200 with `{ deliveryId, status: "delivered" }`
- Connector failure returns 502 with `{ deliveryId, status: "failed" }`
- Scheduler caller succeeds
- Timeout returns 502 with failure audit
- DB insert failure returns 503

**Mocking:** Mock `db` with fake insert/update tracking. Mock `fetch` via `config.fetchFn`.

## Smoke Test Strategy

### Services to Start
```bash
docker compose up -d postgres redis
docker compose --profile app up -d deps-init delivery
```

### HTTP Checks (via docker compose exec)
1. Health: `curl -sf http://localhost:3006/health` → 200
2. Auth: POST without token → 401
3. Table exists: `psql` query on `delivery_audits` columns
4. Not publicly exposed: `curl http://localhost/internal/deliver` → 404

## Security Considerations

1. **Service-to-service auth:** Already implemented. JWT with `audience: "delivery"`, callers `["ai-router", "scheduler"]`.
2. **No public exposure:** Internal network only. Caddyfile has no delivery routes.
3. **Redaction:** Intent payloads never logged in full. Only routing metadata in logs.
4. **Minimal audit data:** `content_type` stores only the discriminator tag, never message body.
5. **No sensitive data in errors:** Transport-level failure info only.
6. **Correlation ID propagation:** Every audit carries correlation ID for end-to-end tracing.

## Risks & Open Questions

1. **Audit retention (MEDIUM):** 90-day retention required, no automated purge yet. Deferred to Phase 5.
2. **Empty connectorRoutingId from scheduler (LOW, pre-existing):** Scheduler emits empty string. Fix belongs in scheduler, out of scope.
3. **Shared Postgres (LOW):** Per-service schemas, no cross-service migration orchestration. Works for V1.
4. **DB failure = delivery failure (design decision):** Audit persistence is compliance-required. Returns 503 on DB failure.
5. **No delivery-level retries (by design):** Callers own retry semantics.
