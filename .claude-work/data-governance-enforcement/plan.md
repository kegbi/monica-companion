# Implementation Plan: Data Governance Enforcement

## Objective

Implement the three data governance sub-items from Phase 7 of the roadmap:
1. Automated retention cleanup jobs that purge stale data according to documented retention periods (conversation_turns: 30 days, command_executions/delivery_audits: 90 days, idempotency_keys/reminder_windows: 14 days).
2. Account disconnection flow with immediate credential deletion and user-specific data purge scheduled within 30 days.
3. Verification that voice audio is not retained after transcription completes.

These items close the Data Governance acceptance criteria in `context/product/acceptance-criteria.md` and enforce the retention/deletion policies defined in `context/spec/data-governance.md` and `context/product/architecture.md` section 2.1.

## Scope

### In Scope

- Periodic retention cleanup job in `scheduler` that purges expired rows from `conversation_turns`, `pending_commands`, `command_executions`, `idempotency_keys`, `reminder_windows`, and `delivery_audits` tables across three services.
- Account disconnection endpoint on `user-management` (`DELETE /internal/users/:userId/disconnect`) that immediately revokes credentials and schedules data purge.
- Internal purge endpoints on `ai-router`, `scheduler`, and `delivery` to delete user-specific data on demand (called by `user-management` during disconnection).
- A `data_purge_requests` table in `user-management` to track scheduled purge operations.
- A purge executor in `user-management` that processes pending purge requests after the 30-day grace period.
- A `/disconnect` command in `telegram-bridge` to let users initiate disconnection.
- Verification test suite proving voice audio is transient-only in `voice-transcription`.
- Zod schemas for all new inbound/outbound contracts.
- Unit tests, integration tests, and Docker Compose smoke tests.

### Out of Scope

- Infrastructure-level retention for Loki (336h), Tempo (336h), and Prometheus (14d) -- already configured in `docker/loki-config.yaml`, `docker/tempo-config.yaml`, and `docker-compose.yml`.
- Purge of BullMQ Redis job data -- already handled by `removeOnComplete` and `removeOnFail` count limits on all workers in `services/scheduler/src/index.ts`.
- Emergency/security-investigation purge shortening (documented as an operator manual procedure in `context/spec/data-governance.md`).
- Full account deletion (removing the user row entirely) -- disconnection revokes credentials and schedules data purge but preserves a minimal user stub and security audit log entries per spec.

## Affected Services & Packages

| Package/Service | Changes |
|-----------------|---------|
| `packages/types` | New `src/retention.ts` with Zod schemas for retention cleanup and purge contracts. |
| `services/user-management` | New `DELETE /internal/users/:userId/disconnect` endpoint; new `data_purge_requests` table + migration; new disconnect repository module; new purge executor with periodic sweep. New config fields for downstream service URLs, sweep interval, and HTTP timeout. |
| `services/ai-router` | New `POST /internal/retention-cleanup` endpoint (caller: scheduler) mounted as a separate Hono sub-app; new `DELETE /internal/users/:userId/data` endpoint (caller: user-management) mounted as a separate Hono sub-app; new `src/retention/` module. |
| `services/scheduler` | New `DELETE /internal/users/:userId/data` endpoint (caller: user-management) mounted as a separate Hono sub-app; local retention cleanup functions called directly by the retention-cleanup worker; new `src/retention/` module; new `retention-cleanup` BullMQ repeatable job. |
| `services/delivery` | New `POST /internal/retention-cleanup` endpoint (caller: scheduler) mounted as a separate Hono sub-app; new `DELETE /internal/users/:userId/data` endpoint (caller: user-management) mounted as a separate Hono sub-app; new `src/retention/` module. |
| `services/telegram-bridge` | New `/disconnect` command handler. |
| `services/voice-transcription` | No code changes; new verification tests only. |

## Implementation Steps

### Step 1: Add Zod schemas for retention and purge contracts

**What:** Create `packages/types/src/retention.ts` with Zod schemas for all new inter-service contracts. This ensures strict payload validation (as required by `definition-of-done.md` and `reliability.md`) and defines the contracts before any endpoint implementation.

**Schemas to define:**
- `AiRouterRetentionCleanupRequestSchema` -- body for `POST /internal/retention-cleanup` on ai-router. Fields: `conversationTurnsCutoff: string` (ISO date), `pendingCommandsCutoff: string` (ISO date). Both required.
- `DeliveryRetentionCleanupRequestSchema` -- body for `POST /internal/retention-cleanup` on delivery. Fields: `deliveryAuditsCutoff: string` (ISO date). Required.
- `RetentionCleanupResponseSchema` -- response: `{ purged: Record<string, number> }`.
- `UserDataPurgeResponseSchema` -- response for `DELETE /internal/users/:userId/data`: `{ purged: Record<string, number> }`.
- `DisconnectUserResponseSchema` -- response for disconnect: `{ disconnected: boolean, purgeScheduledAt: string }`.

Note: Per-service request schemas (rather than a single all-optional schema) provide stronger type safety at the call site and make invalid payloads unrepresentable.

**Files to create:**
- `packages/types/src/retention.ts`
- `packages/types/src/__tests__/retention.test.ts`

**Files to modify:**
- `packages/types/src/index.ts` -- export new schemas.

**TDD:** Write tests first that validate schema parsing for valid payloads and rejection of invalid payloads, then implement the schemas.

### Step 2: Add retention purge functions to ai-router

**What:** Create `services/ai-router/src/retention/cleanup.ts` with two pure database-layer functions:
- `purgeExpiredConversationTurns(db, cutoffDate: Date): Promise<number>` -- `DELETE FROM conversation_turns WHERE created_at < cutoffDate`. Returns count.
- `purgeExpiredPendingCommands(db, cutoffDate: Date): Promise<number>` -- `DELETE FROM pending_commands WHERE terminal_at IS NOT NULL AND terminal_at < cutoffDate`. Only terminal (expired/cancelled/executed) commands are purged; active commands are never touched.

**Files to create:**
- `services/ai-router/src/retention/cleanup.ts`
- `services/ai-router/src/retention/__tests__/cleanup.test.ts` (unit test with mocked Drizzle db)
- `services/ai-router/src/retention/__tests__/cleanup.integration.test.ts` (integration test against real Postgres: seed rows with old/new timestamps, run purge, assert only correct rows deleted)

**TDD:** Write failing integration test first: seed a `conversation_turns` row with `created_at = 31 days ago` and one with `created_at = now`, call purge with 30-day cutoff, assert old row is gone and new row remains.

### Step 3: Add retention purge functions to scheduler

**What:** Create `services/scheduler/src/retention/cleanup.ts` with three functions:
- `purgeExpiredExecutions(db, cutoffDate: Date): Promise<number>` -- `DELETE FROM command_executions WHERE created_at < cutoffDate AND status IN ('completed', 'failed', 'dead_lettered')`. Returns count.
- `purgeExpiredIdempotencyKeys(db, cutoffDate: Date): Promise<number>` -- `DELETE FROM idempotency_keys WHERE expires_at < cutoffDate`. Returns count. These keys are already expired, so deletion is safe.
- `purgeExpiredReminderWindows(db, cutoffDate: Date): Promise<number>` -- `DELETE FROM reminder_windows WHERE created_at < cutoffDate AND status IN ('fired', 'skipped')`. Returns count.

**Files to create:**
- `services/scheduler/src/retention/cleanup.ts`
- `services/scheduler/src/retention/__tests__/cleanup.test.ts`
- `services/scheduler/src/retention/__tests__/cleanup.integration.test.ts`

**TDD:** Write failing integration test first for each function with seeded data.

### Step 4: Add retention purge function to delivery

**What:** Create `services/delivery/src/retention/cleanup.ts` with:
- `purgeExpiredDeliveryAudits(db, cutoffDate: Date): Promise<number>` -- `DELETE FROM delivery_audits WHERE created_at < cutoffDate`. Returns count.

**Files to create:**
- `services/delivery/src/retention/cleanup.ts`
- `services/delivery/src/retention/__tests__/cleanup.test.ts`
- `services/delivery/src/retention/__tests__/cleanup.integration.test.ts`

**TDD:** Write failing integration test: seed delivery audits with old timestamps, run purge, verify deletion.

### Step 5: Add retention cleanup endpoints to ai-router and delivery

**What:** Add `POST /internal/retention-cleanup` endpoint to both `ai-router` and `delivery`. These endpoints are called by the scheduler's periodic retention job. Each endpoint:
1. Validates the request body with its per-service Zod schema.
2. Computes cutoff dates from the request.
3. Calls the local cleanup functions from Step 2/4.
4. Returns the purge counts.

**IMPORTANT -- Separate Hono sub-apps with per-endpoint auth:** The existing `/internal` sub-app in `ai-router` applies a shared `serviceAuth` with `allowedCallers: config.inboundAllowedCallers` (defaults to `["telegram-bridge"]`) to ALL routes mounted under it. The existing `/internal` sub-app in `delivery` applies `allowedCallers: ["ai-router", "scheduler"]`. Per `security.md`: "Each service must enforce per-endpoint caller allowlists." Therefore, the new retention cleanup endpoints MUST be mounted as separate Hono sub-apps with their own per-endpoint `serviceAuth` middleware, NOT added to the existing shared-auth `internal` sub-app.

**ai-router retention routes:**
- Create a new Hono sub-app in `services/ai-router/src/retention/routes.ts`.
- Apply `serviceAuth({ audience: "ai-router", secrets: config.auth.jwtSecrets, allowedCallers: ["scheduler"] })`.
- POST handler at `/retention-cleanup` accepts `AiRouterRetentionCleanupRequestSchema`.
- Calls `purgeExpiredConversationTurns` and `purgeExpiredPendingCommands`.
- Returns `{ purged: { conversationTurns: N, pendingCommands: N } }`.
- Mount in `app.ts` with `app.route("/internal", retentionRoutes(config, db))`.

**delivery retention routes:**
- Create a new Hono sub-app in `services/delivery/src/retention/routes.ts`.
- Apply `serviceAuth({ audience: "delivery", secrets: config.auth.jwtSecrets, allowedCallers: ["scheduler"] })`.
- POST handler at `/retention-cleanup` accepts `DeliveryRetentionCleanupRequestSchema`.
- Calls `purgeExpiredDeliveryAudits`.
- Returns `{ purged: { deliveryAudits: N } }`.
- Mount in `app.ts` with `app.route("/internal", retentionRoutes(config, deps.db))`.

**Files to create:**
- `services/ai-router/src/retention/routes.ts`
- `services/delivery/src/retention/routes.ts`
- `services/ai-router/src/__tests__/retention-endpoint.test.ts`
- `services/delivery/src/__tests__/retention-endpoint.test.ts`

**Files to modify:**
- `services/ai-router/src/app.ts` -- mount retention routes sub-app.
- `services/delivery/src/app.ts` -- mount retention routes sub-app.

**TDD:** Write failing test that POSTs a valid payload and expects 200 with purge counts.

### Step 6: Add periodic retention cleanup job to scheduler

**What:** Add a new BullMQ repeatable job `retention-cleanup` in the scheduler that runs daily. The worker:
1. Computes cutoff dates: `conversation/pendingCommand cutoff = NOW - 30 days`, `execution/deliveryAudit cutoff = NOW - 90 days`, `idempotencyKey/reminderWindow cutoff = NOW - 14 days`.
2. Calls local scheduler cleanup functions (from Step 3) directly.
3. Calls `POST /internal/retention-cleanup` on `ai-router` with `{ conversationTurnsCutoff, pendingCommandsCutoff }`.
4. Calls `POST /internal/retention-cleanup` on `delivery` with `{ deliveryAuditsCutoff }`.
5. Logs the total purge counts via the structured logger.

**Configuration changes in `services/scheduler/src/config.ts`:**
- `RETENTION_CLEANUP_INTERVAL_MS` (default: 86400000 = 24 hours).
- `CONVERSATION_RETENTION_DAYS` (default: 30).
- `COMMAND_LOG_RETENTION_DAYS` (default: 90).
- `IDEMPOTENCY_KEY_RETENTION_DAYS` (default: 14) -- for `idempotency_keys` table rows.
- `REMINDER_WINDOW_RETENTION_DAYS` (default: 14) -- for `reminder_windows` table rows.
- `AI_ROUTER_URL` (default: `http://ai-router:3002`) -- needed for the cleanup call.

Note: The config uses accurately named fields (`IDEMPOTENCY_KEY_RETENTION_DAYS` and `REMINDER_WINDOW_RETENTION_DAYS`) instead of the misleading `DEAD_LETTER_RETENTION_DAYS`. BullMQ dead-letter payloads in Redis are already handled by `removeOnFail` count limits.

Note: `DELIVERY_URL` already exists in scheduler config.

**Files to modify:**
- `services/scheduler/src/config.ts` -- add retention config fields and `AI_ROUTER_URL`.
- `services/scheduler/src/index.ts` -- add retention cleanup queue, worker, and repeatable job scheduler. Add `aiRouterClient` service client.

**Files to create:**
- `services/scheduler/src/workers/retention-cleanup-worker.ts`
- `services/scheduler/src/__tests__/retention-cleanup-worker.test.ts`

**Docker Compose:**
- Add `AI_ROUTER_URL: http://ai-router:3002` to scheduler environment in `docker-compose.yml`.

**TDD:** Write failing test for the worker that mocks all cleanup functions and service clients, asserts they are called with correct cutoff dates.

### Step 7: Add data_purge_requests table to user-management

**What:** Add a new `data_purge_requests` table to track scheduled user data purges from account disconnection.

**Schema:**
```sql
CREATE TABLE data_purge_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'pending',
  reason TEXT NOT NULL,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  purge_after TIMESTAMPTZ NOT NULL,
  claimed_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  retry_count INTEGER NOT NULL DEFAULT 0,
  error TEXT
);
CREATE INDEX idx_data_purge_requests_status ON data_purge_requests (status, purge_after);
CREATE INDEX idx_data_purge_requests_user_id ON data_purge_requests (user_id);
```

**Files to modify:**
- `services/user-management/src/db/schema.ts` -- add `dataPurgeRequests` table definition.
- `services/user-management/src/db/index.ts` -- export new table.

**Files to create:**
- `services/user-management/drizzle/0002_data_purge_requests.sql` -- migration file.

### Step 8: Implement account disconnection endpoint on user-management

**What:** Add `DELETE /internal/users/:userId/disconnect` to `services/user-management/src/app.ts`.

**Endpoint behavior (all within a single database transaction):**
1. Validates `userId` is a valid UUID.
2. Finds the user by ID. Returns 404 if not found.
3. **Immediately revokes credentials:** Updates the `users` row to set `monica_api_token_encrypted = ''`, `encryption_key_id = 'revoked'`, `monica_base_url = 'revoked'`, `updated_at = NOW()`.
4. **Invalidates active setup tokens:** Updates any `setup_tokens` rows for the user's `telegram_user_id` where `status = 'active'` to `status = 'invalidated'`, `invalidated_at = NOW()`.
5. **Schedules data purge:** Inserts a `data_purge_requests` row with `purge_after = NOW() + 30 days`, `reason = 'account_disconnection'`.
6. **Audit log:** Inserts a `credential_access_audit_log` entry with `actor_service = <caller>`, `correlation_id = <cid>`, recording the disconnection event.
7. Returns `{ disconnected: true, purgeScheduledAt: <ISO date string> }`.

**IMPORTANT -- Transactional semantics:** All four database operations (steps 3-6) MUST execute within a single database transaction using `db.transaction(async (tx) => { ... })`. If any intermediate operation fails, the entire transaction rolls back, preventing an inconsistent state where credentials are revoked but no purge request exists, or vice versa.

**Caller allowlist:** `["telegram-bridge"]`.

**Files to modify:**
- `services/user-management/src/app.ts` -- add disconnect route using `telegramBridgeAuth` middleware.

**Files to create:**
- `services/user-management/src/user/disconnect.ts` -- repository function: `disconnectUser(db, userId, actorService, correlationId): Promise<{ purgeScheduledAt: Date }>` that wraps all four operations in a single transaction.
- `services/user-management/src/user/__tests__/disconnect.test.ts` (unit tests with mocked db)
- `services/user-management/src/user/__tests__/disconnect.integration.test.ts` (integration tests against real Postgres)

**TDD:** Write failing integration test first: create a user with credentials, call disconnect, verify credentials are revoked, setup tokens invalidated, purge request exists with correct `purge_after`, and audit log entry exists. Also test that on partial failure, no state change occurs (transaction rollback).

### Step 9: Add user-specific data purge endpoints to downstream services

**What:** Add `DELETE /internal/users/:userId/data` to `ai-router`, `scheduler`, and `delivery`. Each endpoint deletes all data for the specified user from its own tables.

**IMPORTANT -- Separate Hono sub-apps with per-endpoint auth:** Per `security.md`: "Each service must enforce per-endpoint caller allowlists." The user-data purge endpoints require `allowedCallers: ["user-management"]`, which differs from the existing shared-auth sub-apps. Therefore, the purge endpoints MUST be mounted as separate Hono sub-apps with their own `serviceAuth` middleware.

**ai-router:**
- Create `services/ai-router/src/retention/user-purge-routes.ts` as a new Hono sub-app.
- Apply `serviceAuth({ audience: "ai-router", secrets: config.auth.jwtSecrets, allowedCallers: ["user-management"] })`.
- Deletes all `conversation_turns` and all `pending_commands` for the user (regardless of status/age).
- Returns `{ purged: { conversationTurns: N, pendingCommands: N } }`.
- Mount in `app.ts` with `app.route("/internal", userPurgeRoutes(config, db))`.

**scheduler:**
- Create `services/scheduler/src/retention/user-purge-routes.ts` as a new Hono sub-app.
- Apply `serviceAuth({ audience: "scheduler", secrets: config.auth.jwtSecrets, allowedCallers: ["user-management"] })`.
- Uses a PostgreSQL CTE to atomically collect idempotency keys from `command_executions` before deleting those executions: `WITH deleted_executions AS (DELETE FROM command_executions WHERE user_id = :userId RETURNING idempotency_key) DELETE FROM idempotency_keys WHERE key IN (SELECT idempotency_key FROM deleted_executions)`. This avoids the ordering bug where deleting executions first would make the subsequent sub-select return zero rows, leaving orphaned `idempotency_keys` entries.
- Then deletes all `reminder_windows` for the user.
- Returns `{ purged: { commandExecutions: N, idempotencyKeys: N, reminderWindows: N } }`.
- Mount in `app.ts` with `app.route("/internal", userPurgeRoutes(config, db))`.

**delivery:**
- Create `services/delivery/src/retention/user-purge-routes.ts` as a new Hono sub-app.
- Apply `serviceAuth({ audience: "delivery", secrets: config.auth.jwtSecrets, allowedCallers: ["user-management"] })`.
- Deletes all `delivery_audits` where `user_id = :userId` (note: `user_id` is TEXT in this table, so the purge query uses text comparison).
- Returns `{ purged: { deliveryAudits: N } }`.
- Mount in `app.ts` with `app.route("/internal", userPurgeRoutes(config, deps.db))`.

**Files to create:**
- `services/ai-router/src/retention/user-purge.ts` (database-layer purge functions)
- `services/ai-router/src/retention/user-purge-routes.ts` (Hono sub-app)
- `services/scheduler/src/retention/user-purge.ts` (database-layer purge functions using CTE)
- `services/scheduler/src/retention/user-purge-routes.ts` (Hono sub-app)
- `services/delivery/src/retention/user-purge.ts` (database-layer purge functions)
- `services/delivery/src/retention/user-purge-routes.ts` (Hono sub-app)
- Unit tests and integration tests for each.

**Files to modify:**
- `services/ai-router/src/app.ts` -- mount user purge routes sub-app.
- `services/scheduler/src/app.ts` -- mount user purge routes sub-app.
- `services/delivery/src/app.ts` -- mount user purge routes sub-app.

**TDD:** Write failing integration test: seed user data across tables, call purge, verify all rows deleted. For scheduler specifically, verify that after CTE execution both `command_executions` and their associated `idempotency_keys` are deleted. Verify a second call returns zero counts (idempotent).

### Step 10: Implement purge executor in user-management

**What:** Create a periodic purge executor that runs on a timer in `user-management` (same pattern as `startExpirySweep` in ai-router). The executor:

1. Reclaims stale in-progress requests: `UPDATE data_purge_requests SET status = 'pending' WHERE status = 'in_progress' AND claimed_at < NOW() - INTERVAL '<stale_claim_threshold_minutes> minutes'`. Uses `claimed_at` (not `requested_at`) because `requested_at` is set 30+ days before processing begins and would make the check trivially true for all in-progress requests.
2. Resets failed requests for retry: `UPDATE data_purge_requests SET status = 'pending', error = NULL WHERE status = 'failed' AND retry_count < <max_purge_retries>`. Requests that exceed `MAX_PURGE_RETRIES` remain in `failed` status permanently and require operator intervention.
3. Atomically claims pending purge requests: `UPDATE data_purge_requests SET status = 'in_progress', claimed_at = NOW() WHERE status = 'pending' AND purge_after <= NOW() RETURNING *`.
4. For each claimed request, calls `DELETE /internal/users/:userId/data` on `ai-router`, `scheduler`, and `delivery` using authenticated service clients.
5. On success of all three, sets `status = 'completed'`, `completed_at = NOW()`.
6. On failure of any, sets `status = 'failed'`, `error = <message>`, `retry_count = retry_count + 1`.

**Explicit timeout handling:** Per `reliability.md`: "All external API calls must have explicit timeout handling." Each outbound `fetch` call to ai-router, scheduler, and delivery MUST pass `signal: AbortSignal.timeout(config.httpTimeoutMs)` to prevent a hung downstream service from blocking the entire purge sweep indefinitely.

**Configuration in `services/user-management/src/config.ts`:**
- `PURGE_SWEEP_INTERVAL_MS` (default: 3600000 = 1 hour).
- `HTTP_TIMEOUT_MS` (default: 10000 = 10 seconds).
- `STALE_CLAIM_THRESHOLD_MINUTES` (default: 30) -- how long an `in_progress` request can sit before being reclaimed. Uses `claimed_at` column for detection.
- `MAX_PURGE_RETRIES` (default: 5) -- maximum retry attempts for failed purge requests before they become permanently failed.
- `AI_ROUTER_URL` (default: `http://ai-router:3002`).
- `SCHEDULER_URL` (default: `http://scheduler:3005`).
- `DELIVERY_URL` (default: `http://delivery:3006`).

**Files to create:**
- `services/user-management/src/purge/executor.ts`
- `services/user-management/src/purge/__tests__/executor.test.ts`

**Files to modify:**
- `services/user-management/src/config.ts` -- add config fields.
- `services/user-management/src/index.ts` -- create service clients, start purge sweep timer, register shutdown cleanup (clearInterval).
- `docker-compose.yml` -- add `AI_ROUTER_URL`, `SCHEDULER_URL`, `DELIVERY_URL`, `HTTP_TIMEOUT_MS` env vars to `user-management` service.

**TDD:** Write failing test: mock service clients, seed a pending purge request with `purge_after` in the past, call `processPendingPurges`, assert all three service clients were called with `signal: AbortSignal.timeout(...)` and request status is `completed`. Also test: (1) stale `in_progress` reclaim: seed an `in_progress` request with old `claimed_at`, run executor, assert it is reclaimed to `pending` and then processed; (2) failed request retry: seed a `failed` request with `retry_count < MAX_PURGE_RETRIES`, run executor, assert it is retried; (3) permanently failed: seed a `failed` request with `retry_count >= MAX_PURGE_RETRIES`, run executor, assert it is NOT retried.

### Step 11: Add /disconnect command to telegram-bridge

**What:** Add a `/disconnect` command handler to `telegram-bridge` that:
1. Checks if the user is registered by verifying `ctx.userId` exists. If absent (unregistered user), replies with "You are not connected. Use /start to set up your account." and returns early.
2. Calls `DELETE /internal/users/:userId/disconnect` on `user-management`.
3. On success, replies: "Your account has been disconnected. Your Monica credentials have been deleted immediately. All your data will be purged within 30 days."
4. On failure, replies with a graceful error message.

**IMPORTANT -- Handler registration ordering:** In grammY, middleware runs in registration order. `bot.command("disconnect", ...)` MUST be registered BEFORE `bot.on("message:text", ...)` in `setupBot`. If registered after, the text handler would process `/disconnect` as regular user input and forward it to ai-router as a free-form text message. The updated `setupBot` order is:

```
1. bot.use(privateChatOnly)
2. bot.use(createUserResolver(...))
3. bot.command("disconnect", ...)     <-- NEW, before text handler
4. bot.on("message:text", ...)
5. bot.on("message:voice", ...)
6. bot.on("callback_query:data", ...)
7. bot.catch(...)
```

**Files to create:**
- `services/telegram-bridge/src/bot/handlers/disconnect-command.ts`
- `services/telegram-bridge/src/bot/handlers/__tests__/disconnect-command.test.ts`

**Files to modify:**
- `services/telegram-bridge/src/bot/setup.ts` -- add `DisconnectFn` to `SetupDeps`, register `bot.command("disconnect", ...)` BEFORE `bot.on("message:text", ...)`.
- `services/telegram-bridge/src/lib/user-management-client.ts` -- add `disconnectUser(userId: string, correlationId?: string): Promise<{ disconnected: boolean; purgeScheduledAt: string }>` method.
- `services/telegram-bridge/src/app.ts` -- pass the new disconnect dependency to `setupBot`.

**TDD:** Write failing test: mock user-management client, call handler with a registered user context, assert disconnect was called and reply was sent.

### Step 12: Verify voice audio transient handling

**What:** Add explicit verification tests proving voice audio is not retained after transcription. This is a test-only step -- no code changes to `voice-transcription`.

**Evidence from code review:**
- Audio is received as `FormData` (in-memory `Blob`), passed to `whisperClient.transcribe()` as a `Blob`, and never written to disk or database.
- Fetched audio is returned as `ArrayBuffer` (in-memory), never persisted.
- No database connection exists in `voice-transcription`.
- No file system write operations exist anywhere in the service.

**Tests to write:**
1. Assert that no `fs` module write functions are called during a transcription request.
2. Assert that the service has no database dependency.
3. Assert that the `AudioFetchResult` from `fetchAudio` contains only an in-memory `ArrayBuffer` and no file path reference.

**Files to create:**
- `services/voice-transcription/src/__tests__/audio-retention.test.ts`

## Test Strategy

### TDD Sequence (failing test first)

For each step, the implementer MUST:
1. **RED:** Write the failing test that asserts the expected behavior.
2. **Observe:** Run the test suite and confirm the test fails for the right reason.
3. **GREEN:** Write the minimal implementation to make the test pass.
4. **REFACTOR:** Clean up if needed without changing behavior.

### Smoke Test Strategy

**Services to Start:**
```bash
docker compose --profile app up -d postgres redis user-management ai-router scheduler delivery telegram-bridge
```

**Smoke Test 1: Automated Retention Cleanup**
- Seed stale data via psql (conversation_turns 31 days old, command_executions 91 days old, delivery_audits 91 days old)
- Trigger retention cleanup (reduce interval or call directly)
- Verify old rows deleted, recent rows remain

**Smoke Test 2: Account Disconnection Flow**
- Seed a test user with credentials and data across services
- Call disconnect endpoint with valid JWT
- Verify credentials immediately revoked
- Verify purge request created with 30-day purge_after
- Fast-forward purge_after, wait for executor sweep
- Verify all user data purged across services

**Smoke Test 3: Service Auth Enforcement**
- Attempt to call `POST /internal/retention-cleanup` on ai-router with a JWT issued by a caller not in the allowlist (e.g., `telegram-bridge`)
- Verify 403 Forbidden response
- Attempt to call `DELETE /internal/users/:userId/data` on delivery with a JWT from `scheduler`
- Verify 403 Forbidden response

## Security Considerations

1. **Immediate credential revocation**: Disconnect endpoint zeroes out credentials within a single database transaction.
2. **Service auth on all new endpoints** with per-endpoint caller allowlists. New endpoints are mounted as separate Hono sub-apps with their own `serviceAuth` middleware, never added to existing shared-auth sub-apps.
3. **Audit logging preserved**: Security audit tables (`credential_access_audit_log`, `setup_token_audit_log`) are NOT purged during disconnection.
4. **Redaction**: All purge/cleanup log messages route through RedactingLogProcessor.
5. **No public exposure**: All new endpoints are `/internal/` only.
6. **Correlation ID propagation** across all downstream calls.
7. **Timeout handling**: Purge executor outbound calls use `AbortSignal.timeout(config.httpTimeoutMs)` to prevent indefinite blocking.

## Risks & Mitigations

1. **`delivery_audits.user_id` is TEXT, not UUID** -- purge query uses text comparison.
2. **`idempotency_keys` lacks `user_id`** -- delete via CTE that collects keys from `command_executions` before deleting them, ensuring no orphaned keys.
3. **Purge executor concurrency** -- atomic `UPDATE ... RETURNING` ensures single-instance claim.
4. **Stale in_progress purge requests** -- reclaim mechanism uses `claimed_at` column (set at claim time) to detect requests stuck in `in_progress` longer than `STALE_CLAIM_THRESHOLD_MINUTES`, resetting them to `pending`.
5a. **Failed purge retry** -- failed requests are retried up to `MAX_PURGE_RETRIES` times. Permanently failed requests remain in `failed` status for operator alerting.
5. **Partial purge failure** -- re-calling DELETE is idempotent (returns zero counts). Failed requests are reset to pending for retry.
6. **User stub after disconnection** -- preserved for identification; re-registration requires new onboarding.
7. **Transaction rollback on disconnect** -- all four disconnect operations are wrapped in a single transaction, preventing partial state changes.
