# Implementation Plan: Command Contract & Lifecycle

## Objective

Define the command contract (structured Zod schemas for all V1 create/update/query actions), implement pending-command storage in PostgreSQL with lifecycle state management, and enforce state machine transitions `draft -> pending_confirmation -> confirmed -> executed -> expired/cancelled`. This is the foundation that enables the confirmation flow where AI-generated mutations require user approval before execution, and ensures stale/expired/replayed confirmations are safely rejected.

## Scope

### In Scope

- Zod command schemas for all V1 actions: create contact, create note, create activity, update contact details (birthday, phone, email, address), and read-only queries (birthday lookup, phone lookup, last note).
- A `CommandType` discriminated union covering mutating and read-only command types.
- Pending-command database table in `ai-router`'s schema with `pendingCommandId`, `version`, `userId`, `commandType`, `payload` (JSONB), `status`, `sourceMessageRef`, `correlationId`, TTL (`expiresAt`), and timestamps.
- State machine enforcement: valid transitions only, version-checked confirmations, TTL-based expiry.
- A pending-command repository module in `ai-router` with functions for create, transition, get, expire.
- Shared Zod schemas in `@monica-companion/types` for the command contract and confirmed-command execution payload (consumed by `scheduler`).
- Unit tests for schemas, state machine logic, and repository operations.
- Integration tests against real PostgreSQL for the repository.

### Out of Scope

- LangGraph/LLM integration (Phase 3 "Contact Resolution Boundary" and "Benchmark & Quality Gates").
- Telegram bridge inbound message handling (Phase 4).
- Scheduler job execution logic (Phase 4 "Scheduler" task).
- Delivery service outbound routing (Phase 4 "Delivery" task).
- Auto-confirmation logic based on user preferences.
- Idempotency key derivation for confirmed commands (belongs to scheduler ingress, Phase 4).
- HTTP endpoints on `ai-router` that accept inbound messages from `telegram-bridge`.

## Affected Services & Packages

| Package/Service | Changes |
|-----------------|---------|
| `packages/types` | Add command schemas: `CommandType`, per-action payload schemas, `PendingCommandStatus`, `ConfirmedCommandPayload`, `PendingCommandRecord` |
| `services/ai-router` | Add database connection, Drizzle schema for `pending_commands`, config with `DATABASE_URL`, pending-command repository, state machine module |
| `docker-compose.yml` | Add `DATABASE_URL` environment variable for `ai-router` service |
| `services/scheduler` | No code changes yet, but the `ConfirmedCommandPayload` schema defines the contract `scheduler` will consume in Phase 4 |

## Current State Analysis

1. **`packages/types/src/`** exports `ContactResolutionSummary`, setup token types, and user management response types. No command schemas exist.
2. **`services/ai-router/`** is a minimal Hono skeleton with `/health` endpoint, no database connection, no config module, no auth middleware, no routes beyond health.
3. **`services/scheduler/`** is similarly minimal -- health endpoint only.
4. **`services/user-management/`** has the established pattern: `src/db/connection.ts`, `src/db/schema.ts`, `drizzle.config.ts`, migrations in `drizzle/`.
5. **`services/monica-integration/src/routes/write.ts`** defines Monica-agnostic internal request schemas that represent what `scheduler` sends to `monica-integration`.
6. **PostgreSQL** is shared by all services using `monica_companion` database. `ai-router` currently has no `DATABASE_URL` wired.

## Design Decisions

### Where do command schemas live?
In `packages/types` -- consumed by `ai-router`, `scheduler`, and `delivery`.

### Where does pending-command storage live?
In `ai-router` -- owns the `pending_commands` table and state machine logic per architecture.

### Mutating vs. read-only commands
Read-only queries bypass `scheduler` and stay on the live request path. Only mutating commands go through pending-command lifecycle. The shared `CommandType` enum includes both, but only `MutatingCommandType` produces pending-command records.

### TTL
30-minute inactivity TTL. `expiresAt` is set at creation and refreshed on each edit/disambiguation. Periodic sweep transitions stale commands to `expired`.

### Confirmed command payload
Frozen snapshot with `idempotencyKey` = `${pendingCommandId}:v${version}`.

## Implementation Steps

### Step 1: Define command type enum and action payload schemas in `packages/types`

Create `packages/types/src/commands.ts` with:
- `MutatingCommandType` enum: `create_contact`, `create_note`, `create_activity`, `update_contact_birthday`, `update_contact_phone`, `update_contact_email`, `update_contact_address`
- `ReadOnlyCommandType` enum: `query_birthday`, `query_phone`, `query_last_note`
- `CommandType` = union of both enums
- Per-action Zod payload schemas (Monica-agnostic)
- `MutatingCommandPayload` discriminated union
- `ReadOnlyCommandPayload` discriminated union

Export from `packages/types/src/index.ts`.

### Step 2: Define pending command status and record schemas in `packages/types`

Add to `packages/types/src/commands.ts`:
- `PendingCommandStatus` enum: `draft`, `pending_confirmation`, `confirmed`, `executed`, `expired`, `cancelled`
- `PendingCommandRecord` schema
- `ConfirmedCommandPayload` schema (what `ai-router` sends to `scheduler`)

### Step 3: Write unit tests for command schemas

Create `packages/types/src/__tests__/commands.test.ts` — TDD-first.

### Step 4: Add database connection and config to `ai-router`

Follow `user-management` pattern:
- Create `services/ai-router/src/config.ts`
- Create `services/ai-router/src/db/connection.ts`
- Update `services/ai-router/src/index.ts` and `app.ts`
- Add dependencies to `package.json`
- Add `DATABASE_URL`, `JWT_SECRET`, etc. to Docker Compose

### Step 5: Define Drizzle schema for `pending_commands` table

Create `services/ai-router/src/db/schema.ts` with:
- `id` (uuid PK)
- `user_id` (uuid, not null, no FK -- cross-service reference)
- `command_type` (text, not null)
- `payload` (jsonb, not null)
- `status` (text, not null, default `draft`)
- `version` (integer, not null, default 1)
- `source_message_ref` (text, not null)
- `correlation_id` (text, not null)
- `created_at`, `updated_at`, `expires_at` (timestamptz)
- `confirmed_at`, `executed_at`, `terminal_at` (nullable timestamptz)
- `execution_result` (jsonb, nullable)

Indexes on `(user_id, status)` and `(expires_at)`.

Generate migration with `drizzle-kit generate`.

### Step 6: Implement state machine transition logic

Create `services/ai-router/src/pending-command/state-machine.ts`:
- `assertTransition(from, to)` — throws on invalid
- `isTerminal(status)`, `isActive(status)`
- Valid transitions map

### Step 7: Write unit tests for state machine (TDD first)

### Step 8: Implement pending-command repository

Create `services/ai-router/src/pending-command/repository.ts`:
- `createPendingCommand(db, params)` — inserts draft with TTL
- `getPendingCommand(db, id)` — fetch by ID
- `getActivePendingCommandForUser(db, userId)` — most recent active
- `transitionStatus(db, id, expectedVersion, from, to)` — atomic with version check
- `updateDraftPayload(db, id, expectedVersion, newPayload)` — update + version bump + TTL refresh
- `expireStaleCommands(db, now)` — batch expire

### Step 9: Write integration tests for pending-command repository

Against real PostgreSQL.

### Step 10: Create confirmed-command helper

`buildConfirmedPayload(record)` — produces `ConfirmedCommandPayload` with deterministic `idempotencyKey`.

### Step 11: Write unit tests for confirmed-command helper

### Step 12: Add expiry sweep as a periodic task

`startExpirySweep(db, intervalMs)` — runs `expireStaleCommands` on interval.

### Step 13: Add config test for `ai-router`

### Step 14: Export pending-command module

Create `services/ai-router/src/pending-command/index.ts`.

## Test Strategy

### Unit Tests
- `packages/types/src/__tests__/commands.test.ts` — all command schemas
- `services/ai-router/src/pending-command/__tests__/state-machine.test.ts` — transitions
- `services/ai-router/src/pending-command/__tests__/confirm.test.ts` — confirm helper
- `services/ai-router/src/__tests__/config.test.ts` — config validation

### Integration Tests
- `services/ai-router/src/pending-command/__tests__/repository.integration.test.ts` — full CRUD against real Postgres

## Smoke Test Strategy

Start `postgres`, `redis`, `ai-router` via Docker Compose. Verify:
1. Health endpoint returns OK
2. Service starts without DB errors
3. `pending_commands` table exists in PostgreSQL
4. Expiry sweep starts (visible in logs)

## Security Considerations

1. **TTL enforcement** — 30-minute TTL with periodic sweep
2. **Version-checked confirmations** — prevents executing wrong action version
3. **Correlation ID propagation** — end-to-end tracing
4. **Deterministic idempotency key** — prevents duplicate execution
5. **No sensitive data in payload** — no API keys or credentials
6. **JSONB re-validation** — payloads re-validated through Zod on read
7. **No public exposure** — ai-router on internal network only

## Files to Create

| File | Purpose |
|------|---------|
| `packages/types/src/commands.ts` | Command schemas |
| `packages/types/src/__tests__/commands.test.ts` | Schema tests |
| `services/ai-router/src/config.ts` | Config module |
| `services/ai-router/src/__tests__/config.test.ts` | Config tests |
| `services/ai-router/src/db/connection.ts` | DB connection |
| `services/ai-router/src/db/schema.ts` | Pending commands table |
| `services/ai-router/src/db/index.ts` | DB re-exports |
| `services/ai-router/drizzle.config.ts` | Drizzle config |
| `services/ai-router/vitest.config.ts` | Vitest config |
| `services/ai-router/src/pending-command/state-machine.ts` | Transition logic |
| `services/ai-router/src/pending-command/__tests__/state-machine.test.ts` | State machine tests |
| `services/ai-router/src/pending-command/repository.ts` | CRUD + lifecycle |
| `services/ai-router/src/pending-command/__tests__/repository.integration.test.ts` | Integration tests |
| `services/ai-router/src/pending-command/confirm.ts` | Confirmed payload builder |
| `services/ai-router/src/pending-command/__tests__/confirm.test.ts` | Confirm tests |
| `services/ai-router/src/pending-command/expiry-sweep.ts` | Periodic TTL enforcement |
| `services/ai-router/src/pending-command/index.ts` | Module exports |

## Files to Modify

| File | Change |
|------|--------|
| `packages/types/src/index.ts` | Export command schemas |
| `services/ai-router/src/index.ts` | Load config, DB, start sweep |
| `services/ai-router/src/app.ts` | Accept Config and DB params |
| `services/ai-router/package.json` | Add dependencies |
| `docker-compose.yml` | Add ai-router env vars |

## Risks

1. **Cross-service table references** — `user_id` has no FK constraint. Application-level validation is sufficient for V1.
2. **Contact resolution not yet available** — Payloads include `contactId` which assumes resolution happened. Schema is ready; resolution comes in Phase 3.
3. **`contactFieldTypeId` leak** — Monica-specific ID in phone/email payloads. Accepted V1 pragmatism.
4. **Single active command per user** — Policy enforced by ai-router pipeline, not repository.
5. **Migration coordination** — Both `user-management` and `ai-router` have Drizzle schemas targeting same DB. Table names don't conflict.
