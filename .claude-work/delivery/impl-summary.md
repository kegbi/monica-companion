# Implementation Summary: Delivery

## Files Changed
| File | Action | Description |
|------|--------|-------------|
| `packages/types/src/delivery.ts` | created | DeliveryResponseStatusSchema (enum: delivered/failed/rejected) and DeliveryResponseSchema Zod schemas |
| `packages/types/src/__tests__/delivery.test.ts` | created | 11 tests for delivery type schemas (valid/invalid status, response fields) |
| `packages/types/src/index.ts` | modified | Added exports for DeliveryResponse, DeliveryResponseSchema, DeliveryResponseStatus, DeliveryResponseStatusSchema |
| `services/delivery/src/db/schema.ts` | created | Drizzle schema for delivery_audits table with uuid PK, correlation_id, user_id, connector_type, connector_routing_id, content_type, status, error, timestamps, and 2 indexes |
| `services/delivery/src/db/connection.ts` | created | Database connection factory returning {db, sql} for Drizzle + postgres.js, enabling sql.end() on shutdown |
| `services/delivery/drizzle.config.ts` | created | Drizzle Kit config for migration generation |
| `services/delivery/drizzle/0000_elite_hex.sql` | created | Generated SQL migration: CREATE TABLE delivery_audits with indexes |
| `services/delivery/drizzle/meta/0000_snapshot.json` | created | Drizzle migration snapshot metadata |
| `services/delivery/drizzle/meta/_journal.json` | created | Drizzle migration journal |
| `services/delivery/src/config.ts` | modified | Added DATABASE_URL (required), HTTP_TIMEOUT_MS (default 10000), databaseUrl and httpTimeoutMs to Config interface |
| `services/delivery/src/__tests__/config.test.ts` | created | 6 tests: DATABASE_URL required, TELEGRAM_BRIDGE_URL required, httpTimeoutMs default, custom HTTP_TIMEOUT_MS, parse DATABASE_URL, parse TELEGRAM_BRIDGE_URL |
| `services/delivery/src/app.ts` | modified | Refactored to accept AppDeps {db}; inserts pending audit, updates to delivered/failed; returns structured DeliveryResponse; AbortSignal.timeout; OpenTelemetry spans; 503 on DB failure |
| `services/delivery/src/__tests__/app.test.ts` | modified | 10 tests: health, auth 401, auth 403, invalid payload rejected, unsupported connector rejected, valid intent delivered with audit, connector failure with failed audit, scheduler caller, timeout with failed audit, DB insert failure 503 |
| `services/delivery/src/index.ts` | modified | Wire createDb(config.databaseUrl) into createApp; sql.end() in shutdown handler |
| `services/delivery/package.json` | modified | Added drizzle-orm, postgres, @opentelemetry/api, @types/node (catalog:), drizzle-kit (dev, catalog:), db:generate and db:push scripts |
| `services/delivery/vitest.config.ts` | created | Vitest alias config for workspace package resolution (following ai-router pattern) |
| `docker-compose.yml` | modified | Added DATABASE_URL and HTTP_TIMEOUT_MS to delivery container environment |

## Tests Added
| Test File | What It Tests |
|-----------|---------------|
| `packages/types/src/__tests__/delivery.test.ts` | DeliveryResponseStatusSchema accepts delivered/failed/rejected, rejects pending/unknown; DeliveryResponseSchema accepts valid responses, rejects missing deliveryId/status, rejects invalid status |
| `services/delivery/src/__tests__/config.test.ts` | Config requires DATABASE_URL, requires TELEGRAM_BRIDGE_URL, defaults httpTimeoutMs to 10000, parses custom HTTP_TIMEOUT_MS |
| `services/delivery/src/__tests__/app.test.ts` | Health endpoint, auth enforcement (401/403), invalid payload returns 400 with rejected status, valid intent returns 200 with deliveryId and delivered status, connector failure returns 502 with failed audit, scheduler caller accepted, timeout returns 502 with failed audit, DB insert failure returns 503 |

## Verification Results
- **Biome**: `pnpm --filter @monica-companion/delivery check` -- 0 errors, 0 warnings (clean). `pnpm biome check --write` fixed 6 files project-wide (formatting only), 95 pre-existing warnings.
- **Tests (types)**: 9 test files, 141 tests passed (including 11 new delivery type tests)
- **Tests (delivery)**: 2 test files, 16 tests passed (6 config + 10 app)
- **Tests (auth)**: 5 test files, 55 tests passed (no regressions)

## Plan Review Findings Addressed

### MEDIUM Findings
1. **Naming:** Used `DeliveryResponseStatusSchema` (not `DeliveryAuditStatusSchema`) for the API response enum. The DB status column uses a separate set including `"pending"` as default.
2. **Smoke test:** Plan for deliver-and-audit path test documented -- would POST a valid intent with service JWT, expect 502 (telegram-bridge not started), and confirm a `"failed"` audit row. Not executed in this phase (requires Docker Compose stack).
3. **AbortSignal.timeout:** Passed `signal: AbortSignal.timeout(config.httpTimeoutMs)` in the `connectorClient.fetch()` options.

### LOW Findings
1. **Catalog versions:** All new dependencies use `catalog:` referencing versions from `pnpm-workspace.yaml`.
2. **sql.end():** Added to the shutdown handler in `index.ts` by returning `{db, sql}` from `createDb()`.

## Plan Deviations
1. **vitest.config.ts added:** The delivery service required a vitest config with workspace alias resolution (following the ai-router pattern). Without it, tests could not resolve `@monica-companion/*` workspace packages. This was not in the original plan but is required infrastructure for tests to run.
2. **Connection module returns {db, sql}:** Modified the connection factory to return both the drizzle db instance and the raw postgres sql client, so the shutdown handler can call `sql.end()`. The scheduler's pattern only returns the drizzle instance, but the plan review LOW finding explicitly requested `sql.end()` support.
3. **Smoke tests not executed:** Docker Compose smoke tests are documented in the plan but require a running Docker stack. They should be run as a follow-up step before marking roadmap items complete.

## Residual Risks
1. **Audit retention (MEDIUM):** 90-day retention purge not implemented. Deferred to Phase 5 per plan.
2. **Empty connectorRoutingId from scheduler (LOW, pre-existing):** Scheduler emits empty string for connectorRoutingId in delivery intents. Fix belongs in scheduler.
3. **Migration application:** The migration SQL is generated but requires `drizzle-kit push` or manual application against the database. The `deps-init` container does not auto-apply service-specific migrations.
4. **Smoke tests pending:** Docker Compose smoke tests need to be executed before marking roadmap items as complete per project rules.
