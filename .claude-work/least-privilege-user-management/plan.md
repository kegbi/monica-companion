# Implementation Plan: Least-Privilege User Management

## Objective

Implement credential encryption at rest, audited credential access restricted to `monica-integration`, and separate non-secret preference/schedule endpoints accessible to `telegram-bridge`, `ai-router`, and `scheduler`. This replaces the current stub credential endpoint with a production-ready, least-privilege access model for user-management.

## Current State Analysis

### What Exists Today

**Database schema (`services/user-management/src/db/schema.ts`):**
- `setup_tokens` table -- setup token lifecycle
- `setup_token_audit_log` table -- audit trail for token events
- No `users` table, no `user_credentials` table, no `user_preferences` table

**user-management service (`services/user-management/src/app.ts`):**
- Setup-token endpoints: issue, validate, consume, cancel (fully implemented)
- Stub credential endpoint at `GET /internal/users/:userId/monica-credentials` -- **non-production**, guarded by `NODE_ENV !== "production"`, reads from environment variables `MONICA_BASE_URL` and `MONICA_API_TOKEN`, not from database
- Auth middleware configured for `telegram-bridge` (setup tokens) and `web-ui` (validate/consume)
- A `monicaIntegrationAuth` middleware exists inside the stub block, restricted to `monica-integration` caller

**monica-integration service (`services/monica-integration/src/lib/credential-client.ts`):**
- `fetchMonicaCredentials()` calls `GET /internal/users/:userId/monica-credentials` on user-management
- Returns `{ baseUrl, apiToken }` -- this is the contract consumed by `createMonicaClient()` in `routes/shared.ts`
- Tests mock the ServiceClient response

**Other services:**
- `telegram-bridge` has a `user-management-client.ts` that creates a ServiceClient pointed at user-management, but no preference-fetching code yet
- `ai-router` and `scheduler` are skeleton apps with only `/health` endpoints; no user-management dependencies yet

**Environment:**
- `.env.example` includes `ENCRYPTION_MASTER_KEY=change-me-in-production` (placeholder, not yet used anywhere)
- `docs/secret-rotation.md` has a placeholder section for encryption master key rotation

### What Needs To Be Built

1. `users` table with encrypted Monica credentials (AES-256-GCM)
2. `user_preferences` table for non-secret configuration
3. Credential encryption/decryption module using `ENCRYPTION_MASTER_KEY`
4. Production credential endpoint replacing the stub: `GET /internal/users/:userId/monica-credentials` (caller: `monica-integration` only) with audit logging
5. Non-secret preference endpoints: `GET /internal/users/:userId/preferences` (callers: `telegram-bridge`, `ai-router`, `scheduler`)
6. Non-secret schedule endpoint: `GET /internal/users/:userId/schedule` (callers: `scheduler`)
7. Credential access audit log table
8. Key rotation support for `ENCRYPTION_MASTER_KEY`
9. Drizzle migration for new tables

## Scope

### In Scope
- `users` table with encrypted credential columns
- `user_preferences` table (language, confirmation mode, IANA timezone)
- `credential_access_audit_log` table
- AES-256-GCM encryption module for credential at-rest encryption
- Production credential endpoint with audit logging, restricted to `monica-integration`
- Non-secret preference endpoint restricted to `telegram-bridge`, `ai-router`, `scheduler`
- Non-secret schedule endpoint restricted to `scheduler`
- `ENCRYPTION_MASTER_KEY` config parsing and rotation support (current + previous)
- Drizzle migration
- Config updates
- Redaction of credential data in all logging paths

### Out of Scope
- Onboarding form submission (writing user data from web-ui) -- that is web-ui implementation work
- User deletion/disconnection flows
- Preference update endpoints (will be added when web-ui management dashboard is built)
- Reminder schedule CRUD (scheduler task scope)
- Contact resolution or Monica API calls

## Affected Services & Packages

| Package/Service | Changes |
|---|---|
| `services/user-management` | New DB schema (users, user_preferences, credential_access_audit_log), encryption module, credential endpoint, preference endpoints, config update, migration, tests |
| `services/monica-integration` | No code changes -- existing `credential-client.ts` contract is preserved |
| `services/telegram-bridge` | No code changes yet -- preference client will be added in a future task |
| `services/ai-router` | No code changes yet -- preference client will be added in a future task |
| `services/scheduler` | No code changes yet -- schedule client will be added in a future task |
| `packages/types` | New Zod schemas for user preferences and credential responses |
| `packages/redaction` | No changes needed -- existing patterns already cover `credential`, `api_key`, `token` |
| `docker-compose.yml` | Add `ENCRYPTION_MASTER_KEY` env var to `user-management` service |
| `docs/secret-rotation.md` | Define concrete rotation procedure for `ENCRYPTION_MASTER_KEY` |

## Credential Encryption Approach

### Algorithm: AES-256-GCM

- **Why AES-256-GCM:** Provides authenticated encryption (confidentiality + integrity). Node.js `crypto` module has native support. No additional dependencies needed. NIST-approved.
- **Key derivation:** Use HKDF (HMAC-based Key Derivation Function) to derive a per-purpose key from `ENCRYPTION_MASTER_KEY`. The info parameter is `"monica-credential-encryption"`. This allows the same master key to derive different keys for different purposes in the future without collision risk.
- **IV:** Generate a fresh random 12-byte IV for every encrypt operation (cryptographically random via `crypto.randomBytes`).
- **Auth tag:** 16 bytes, appended to ciphertext.
- **Storage format:** `base64(iv || ciphertext || authTag)` stored as a single `text` column in PostgreSQL. The IV prefix allows decryption without a separate column.
- **Key rotation:** Support `ENCRYPTION_MASTER_KEY` and `ENCRYPTION_MASTER_KEY_PREVIOUS`. On read, try current key first; if decryption fails (bad auth tag), try previous key and re-encrypt with current key on success. On write, always use current key.

### Key Management

- `ENCRYPTION_MASTER_KEY` must be at least 32 bytes (256 bits), provided as base64url or hex string.
- The config module validates the key length at startup and fails fast if it is too short.
- The key is never logged, never stored in the database, and never included in error messages.

## Endpoint Design

### Credential Endpoint (audited, monica-integration only)

```
GET /internal/users/:userId/monica-credentials
```

- **Caller allowlist:** `["monica-integration"]`
- **Auth:** serviceAuth middleware with `audience: "user-management"`
- **Response (200):** `{ baseUrl: string, apiToken: string }`
- **Response (404):** `{ error: "User not found" }` (no credential details leaked)
- **Audit:** Every successful credential access writes to `credential_access_audit_log` with: userId, caller service, correlation ID, timestamp, IP (from request headers, optional).
- **Redaction:** The `apiToken` value is never logged. The response body is not logged by the observability middleware because existing redaction patterns match `apiToken` and `credential` field names.

### Preference Endpoint (non-secret, multiple callers)

```
GET /internal/users/:userId/preferences
```

- **Caller allowlist:** `["telegram-bridge", "ai-router", "scheduler"]`
- **Auth:** serviceAuth middleware
- **Response (200):** `{ language: string, confirmationMode: string, timezone: string }`
- **Response (404):** `{ error: "User not found" }`
- **No audit logging** -- these are non-secret, read-only preference lookups.

### Schedule Endpoint (non-secret, scheduler only)

```
GET /internal/users/:userId/schedule
```

- **Caller allowlist:** `["scheduler"]`
- **Auth:** serviceAuth middleware
- **Response (200):** `{ reminderCadence: string, reminderTime: string, timezone: string, connectorType: string, connectorRoutingId: string }`
- **Response (404):** `{ error: "User not found" }`
- **No audit logging** -- non-secret schedule metadata.

## Implementation Steps

### Step 1: Add Zod schemas for user preferences and credential access to `packages/types`

**Files to create:**
- `packages/types/src/user-preferences.ts`

**What to do:**
- Define `UserPreferencesResponse` Zod schema: `{ language, confirmationMode, timezone }`
- Define `UserScheduleResponse` Zod schema: `{ reminderCadence, reminderTime, timezone, connectorType, connectorRoutingId }`
- Define `MonicaCredentialsResponse` Zod schema: `{ baseUrl, apiToken }` (this schema already exists in `monica-integration/src/lib/credential-client.ts` -- extract it to shared types for contract alignment)
- Export from `packages/types/src/index.ts`

**Expected outcome:** Shared contract schemas available to both user-management (server) and consuming services (clients).

### Step 2: Build the credential encryption module

**Files to create:**
- `services/user-management/src/crypto/credential-cipher.ts`
- `services/user-management/src/crypto/__tests__/credential-cipher.test.ts`

**What to do:**
- Implement `encryptCredential(plaintext: string, masterKey: Buffer): string` -- returns `base64(iv || ciphertext || authTag)`
- Implement `decryptCredential(encrypted: string, masterKey: Buffer): string` -- extracts IV, ciphertext, authTag; decrypts with AES-256-GCM
- Implement `deriveEncryptionKey(masterKey: Buffer): Buffer` -- HKDF with SHA-256, info = `"monica-credential-encryption"`, no salt (deterministic derivation from master key)
- Implement `tryDecryptWithRotation(encrypted: string, currentKey: Buffer, previousKey: Buffer | null): { plaintext: string; needsReEncrypt: boolean }` -- tries current key, falls back to previous key, signals if re-encryption is needed
- All functions are synchronous (Node.js crypto is sync for these operations)

**TDD sequence:**
1. Write failing test: `encryptCredential` returns a non-empty base64 string
2. Implement encrypt
3. Write failing test: `decryptCredential` round-trips correctly
4. Implement decrypt
5. Write failing test: tampered ciphertext throws
6. Verify auth tag validation
7. Write failing test: `tryDecryptWithRotation` falls back to previous key
8. Implement rotation logic

### Step 3: Add database tables for users, preferences, and credential audit log

**Files to modify:**
- `services/user-management/src/db/schema.ts`

**What to do:**
- Add `users` table:
  - `id` UUID PK (gen_random_uuid)
  - `telegram_user_id` TEXT UNIQUE NOT NULL (links to Telegram identity)
  - `monica_base_url` TEXT NOT NULL (canonical HTTPS URL, not secret)
  - `monica_api_token_encrypted` TEXT NOT NULL (AES-256-GCM ciphertext)
  - `encryption_key_id` TEXT NOT NULL DEFAULT `'current'` (tracks which key version encrypted the token)
  - `created_at` TIMESTAMPTZ NOT NULL DEFAULT now()
  - `updated_at` TIMESTAMPTZ NOT NULL DEFAULT now()
- Add `user_preferences` table:
  - `id` UUID PK (gen_random_uuid)
  - `user_id` UUID NOT NULL UNIQUE FK -> users.id
  - `language` TEXT NOT NULL DEFAULT `'en'`
  - `confirmation_mode` TEXT NOT NULL DEFAULT `'explicit'` (values: `'explicit'`, `'auto'`)
  - `timezone` TEXT NOT NULL (IANA timezone string)
  - `reminder_cadence` TEXT NOT NULL DEFAULT `'daily'` (values: `'daily'`, `'weekly'`, `'none'`)
  - `reminder_time` TEXT NOT NULL DEFAULT `'08:00'` (HH:MM local time)
  - `connector_type` TEXT NOT NULL DEFAULT `'telegram'`
  - `connector_routing_id` TEXT NOT NULL (Telegram chat ID or equivalent)
  - `created_at` TIMESTAMPTZ NOT NULL DEFAULT now()
  - `updated_at` TIMESTAMPTZ NOT NULL DEFAULT now()
- Add `credential_access_audit_log` table:
  - `id` UUID PK (gen_random_uuid)
  - `user_id` UUID NOT NULL (FK -> users.id)
  - `actor_service` TEXT NOT NULL
  - `correlation_id` TEXT
  - `created_at` TIMESTAMPTZ NOT NULL DEFAULT now()
  - Index on `user_id`
  - Index on `created_at` for retention queries

**Then generate migration:**
- Run `pnpm --filter @monica-companion/user-management db:generate` to create the Drizzle migration SQL

### Step 4: Add credential and preference repository functions

**Files to create:**
- `services/user-management/src/user/repository.ts`
- `services/user-management/src/user/__tests__/repository.integration.test.ts`

**What to do:**
- `findUserById(db, userId)` -- returns user row or null
- `findUserByTelegramId(db, telegramUserId)` -- returns user row or null
- `getDecryptedCredentials(db, userId, masterKey, previousMasterKey?)` -- fetches user, decrypts apiToken, returns `{ baseUrl, apiToken }`, handles key rotation
- `getUserPreferences(db, userId)` -- returns preferences row or null
- `getUserSchedule(db, userId)` -- returns schedule-relevant fields or null
- `logCredentialAccess(db, params: { userId, actorService, correlationId })` -- inserts into credential_access_audit_log
- `createUser(db, params)` -- private helper for test seeding and future onboarding

**TDD sequence (integration tests against real Postgres):**
1. Write failing test: `findUserById` returns null for nonexistent user
2. Implement query
3. Write failing test: `getDecryptedCredentials` returns decrypted apiToken for an inserted user
4. Implement decrypt + query logic
5. Write failing test: `logCredentialAccess` creates audit record
6. Implement audit insert
7. Write failing test: `getUserPreferences` returns preferences for a user
8. Implement preference query

### Step 5: Update config to require `ENCRYPTION_MASTER_KEY`

**Files to modify:**
- `services/user-management/src/config.ts`
- `services/user-management/src/__tests__/config.test.ts`

**What to do:**
- Add `ENCRYPTION_MASTER_KEY` to the config schema (required, min 32 chars)
- Add optional `ENCRYPTION_MASTER_KEY_PREVIOUS` for key rotation
- Parse keys from hex or base64url string into Buffer
- Add `encryptionMasterKey: Buffer` and `encryptionMasterKeyPrevious: Buffer | null` to the Config interface

### Step 6: Replace stub credential endpoint with production implementation

**Files to modify:**
- `services/user-management/src/app.ts`
- `services/user-management/src/__tests__/app.test.ts`

**What to do:**
- Remove the `if (process.env.NODE_ENV !== "production")` stub block entirely
- Add `monicaIntegrationAuth` middleware at module scope (no longer conditional)
- Implement `GET /internal/users/:userId/monica-credentials` with database-backed credential resolution and audit logging

### Step 7: Add non-secret preference and schedule endpoints

**Files to modify:**
- `services/user-management/src/app.ts`
- `services/user-management/src/__tests__/app.test.ts`

**What to do:**
- Add `preferenceAuth` middleware: `allowedCallers: ["telegram-bridge", "ai-router", "scheduler"]`
- Implement `GET /internal/users/:userId/preferences`
- Add `schedulerAuth` middleware: `allowedCallers: ["scheduler"]`
- Implement `GET /internal/users/:userId/schedule`

### Step 8: Update Docker Compose and environment config

**Files to modify:**
- `docker-compose.yml`
- `.env.example`

### Step 9: Document encryption master key rotation procedure

**Files to modify:**
- `docs/secret-rotation.md`

### Step 10: Run Drizzle migration and verify

## Test Strategy

### Unit Tests (Vitest)

**`services/user-management/src/crypto/__tests__/credential-cipher.test.ts`:**
- Round-trip encrypt/decrypt
- Fresh IV each time (different ciphertexts for same plaintext)
- Tampered ciphertext throws
- Wrong key throws
- Key rotation fallback

**`services/user-management/src/__tests__/config.test.ts`:**
- ENCRYPTION_MASTER_KEY required
- Short key rejected
- Previous key optional

**`services/user-management/src/__tests__/app.test.ts`:**
- Per-endpoint auth enforcement (401, 403)
- 404 for nonexistent user
- 200 with correct response shape
- Audit log creation

### Integration Tests (Real Postgres)

**`services/user-management/src/user/__tests__/repository.integration.test.ts`:**
- CRUD operations against real database
- Encryption round-trip
- Key rotation
- Audit logging

## Smoke Test Strategy

Start `postgres`, `user-management`, and `monica-integration` via Docker Compose. Verify:
1. Credential access succeeds for `monica-integration`, rejected for others
2. Preference access succeeds for allowed callers, rejected for `monica-integration`
3. Schedule access succeeds for `scheduler`, rejected for others
4. Audit log entries created on credential access
5. No unencrypted credentials in container logs

## Security Considerations

- AES-256-GCM authenticated encryption with fresh IV per operation
- HKDF key derivation isolates credential key from master key
- Per-endpoint caller allowlists (not service-wide)
- Append-only audit log for credential access
- Existing redaction patterns cover all sensitive field names
- Master key validated at startup, never logged

## Files That Will Be Created

| File | Purpose |
|---|---|
| `packages/types/src/user-preferences.ts` | Zod schemas for preference, schedule, and credential responses |
| `services/user-management/src/crypto/credential-cipher.ts` | AES-256-GCM encryption/decryption module |
| `services/user-management/src/crypto/__tests__/credential-cipher.test.ts` | Unit tests for encryption module |
| `services/user-management/src/user/repository.ts` | Database queries for users, preferences, credential access audit |
| `services/user-management/src/user/__tests__/repository.integration.test.ts` | Integration tests against real Postgres |
| `services/user-management/drizzle/XXXX_*.sql` | Generated migration for new tables |

## Files That Will Be Modified

| File | Changes |
|---|---|
| `packages/types/src/index.ts` | Export new schemas |
| `services/user-management/src/db/schema.ts` | Add users, user_preferences, credential_access_audit_log tables |
| `services/user-management/src/db/index.ts` | Export new table references |
| `services/user-management/src/config.ts` | Add ENCRYPTION_MASTER_KEY config fields |
| `services/user-management/src/app.ts` | Replace stub with production endpoints; add preference/schedule routes |
| `services/user-management/src/__tests__/config.test.ts` | Tests for new config fields |
| `services/user-management/src/__tests__/app.test.ts` | Tests for new endpoints |
| `docker-compose.yml` | Add ENCRYPTION_MASTER_KEY env vars to user-management |
| `.env.example` | Document ENCRYPTION_MASTER_KEY format |
| `docs/secret-rotation.md` | Concrete rotation procedure for encryption key |
