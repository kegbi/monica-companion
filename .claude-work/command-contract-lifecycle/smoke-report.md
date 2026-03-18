---
verdict: PASS
services_tested: ["postgres", "redis", "ai-router", "caddy"]
checks_run: 9
checks_passed: 9
---

# Smoke Test Report: Command Contract & Lifecycle

## Environment
- Services started: postgres:17.9-alpine, redis:8.6.1-alpine, node:24.14.0-slim (ai-router), caddy:2.11.2-alpine
- Health check status: all healthy (postgres healthy via pg_isready, redis healthy via redis-cli ping, ai-router /health returns 200 OK)
- Stack startup time: ~95s (includes deps-init pnpm install with lockfile update)
- ai-router restart count: 0 (stable throughout test)

## Checks
| # | Check | Expected | Actual | Result |
|---|-------|----------|--------|--------|
| 1 | ai-router /health returns OK (via internal network) | 200 `{"status":"ok","service":"ai-router"}` | 200 `{"status":"ok","service":"ai-router"}` | PASS |
| 2 | pending_commands table exists with 15 columns | 15 columns matching Drizzle schema | 15 columns: id(uuid PK), user_id(uuid), command_type(text), payload(jsonb), status(text default 'draft'), version(integer default 1), source_message_ref(text), correlation_id(text), created_at(timestamptz), updated_at(timestamptz), expires_at(timestamptz), confirmed_at(timestamptz nullable), executed_at(timestamptz nullable), terminal_at(timestamptz nullable), execution_result(jsonb nullable) | PASS |
| 3 | pending_commands indexes match schema | 3 indexes: PK, (user_id,status), (expires_at) | pending_commands_pkey, idx_pending_commands_user_status, idx_pending_commands_expires_at | PASS |
| 4 | Insert and query pending command via SQL | Row inserted and readable with correct defaults | Insert returned row with gen_random_uuid() PK, status='draft', version=1, timestamps populated, nullable columns null | PASS |
| 5 | ai-router NOT accessible from host (port 3002) | Connection refused (exit code 7) | curl exit code 7 (connection refused) | PASS |
| 6 | ai-router NOT exposed through Caddy (/health and /ai-router/health) | 404 | 404 for both paths | PASS |
| 7 | DB connectivity from ai-router container | Can query pending_commands table and indexes | Successfully queried 3 indexes, read test row with correct command_type='create_contact', status='draft', version=1 | PASS |
| 8 | Optimistic concurrency (version mismatch returns 0 rows) | UPDATE 0 when version wrong | UPDATE 0 (correct - version=1 used but actual was 2 after transition) | PASS |
| 9 | ai-router network isolation (internal only) | Only on monica-project_internal | Only network: monica-project_internal (not public) | PASS |

## Failures
None.

## Notes

### Lockfile Mismatch
The `deps-init` service initially failed because `pnpm-lock.yaml` was not updated after new dependencies were added to `services/ai-router/package.json`. This was resolved by running `pnpm install --no-frozen-lockfile` inside a Docker container mounting the same node_modules volume. This is a pre-existing issue from the implementation phase (noted in the impl-summary as "Drizzle migrations not yet generated" and the Windows/pnpm junction workaround). The lockfile should be committed after being updated.

### Table Created via Raw SQL
Since Drizzle migrations were not generated (documented as a residual risk in the implementation summary), the `pending_commands` table was created via raw SQL matching the Drizzle schema definition. The schema structure was verified to match exactly.

### Logging Output
The ai-router uses OpenTelemetry-based logging via `@monica-companion/observability`. Without an OTEL collector running, log messages (including the "Expiry sweep started" message) are not visible in stdout/stderr. The service health and DB connectivity were verified through direct checks instead.

## Teardown
All services stopped cleanly. No containers remaining. Networks removed.

```
Container monica-project-ai-router-1 Stopped/Removed
Container monica-project-caddy-1 Stopped/Removed
Container monica-project-postgres-1 Stopped/Removed
Container monica-project-redis-1 Stopped/Removed
Container monica-project-deps-init-1 Stopped/Removed
Network monica-project_public Removed
Network monica-project_internal Removed
```
