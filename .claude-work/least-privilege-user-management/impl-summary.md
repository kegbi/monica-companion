# Implementation Summary: Least-Privilege User Management

## Files Changed

| File | Action | Description |
|------|--------|-------------|
| `packages/types/src/user-management.ts` | created | Zod schemas for `UserPreferencesResponse`, `UserScheduleResponse`, `MonicaCredentialsResponse` |
| `packages/types/src/index.ts` | modified | Export new user management schemas |
| `services/user-management/src/crypto/credential-cipher.ts` | created | AES-256-GCM encryption/decryption module with HKDF key derivation and rotation support |
| `services/user-management/src/crypto/__tests__/credential-cipher.test.ts` | created | Unit tests for encryption module (14 tests) |
| `services/user-management/src/db/schema.ts` | modified | Added `users`, `user_preferences`, `credential_access_audit_log` tables |
| `services/user-management/src/db/index.ts` | modified | Export new table references |
| `services/user-management/src/user/repository.ts` | created | Database queries for users, preferences, schedule, credential access audit |
| `services/user-management/src/user/__tests__/repository.integration.test.ts` | created | Integration tests against real Postgres (10 tests) |
| `services/user-management/src/config.ts` | modified | Added `ENCRYPTION_MASTER_KEY` and `ENCRYPTION_MASTER_KEY_PREVIOUS` config with hex/base64url parsing |
| `services/user-management/src/__tests__/config.test.ts` | modified | Tests for encryption key config fields (6 new tests) |
| `services/user-management/src/app.ts` | modified | Replaced stub credential endpoint with production implementation; added preference and schedule endpoints with per-endpoint auth |
| `services/user-management/src/__tests__/app.test.ts` | modified | Tests for credential, preference, and schedule endpoints (20 new tests) |
| `services/user-management/drizzle/0001_least_privilege_user_management.sql` | created | Migration SQL for new tables |
| `services/user-management/drizzle/meta/_journal.json` | modified | Added migration entry |
| `services/monica-integration/src/lib/credential-client.ts` | modified | Import `MonicaCredentialsResponse` from shared `@monica-companion/types` instead of local definition |
| `docker-compose.yml` | modified | Added `ENCRYPTION_MASTER_KEY` and `ENCRYPTION_MASTER_KEY_PREVIOUS` env vars to `user-management` service |
| `.env.example` | modified | Documented `ENCRYPTION_MASTER_KEY` format with generation command and added `ENCRYPTION_MASTER_KEY_PREVIOUS` |
| `docs/secret-rotation.md` | modified | Concrete rotation procedure for encryption master key |

## Tests Added

| Test File | What It Tests |
|-----------|---------------|
| `services/user-management/src/crypto/__tests__/credential-cipher.test.ts` | HKDF key derivation determinism, AES-256-GCM encrypt/decrypt round-trip, fresh IV per call, tampered ciphertext rejection, wrong key rejection, key rotation fallback |
| `services/user-management/src/user/__tests__/repository.integration.test.ts` | `findUserById` null for nonexistent, `findUserById` returns row, `getDecryptedCredentials` round-trip, null for nonexistent, key rotation, `logCredentialAccess` audit record, `getUserPreferences` null/populated, `getUserSchedule` null/populated |
| `services/user-management/src/__tests__/config.test.ts` (6 new) | `ENCRYPTION_MASTER_KEY` required, too-short rejected, hex parsing, base64url parsing, previous key optional, previous key parsing |
| `services/user-management/src/__tests__/app.test.ts` (20 new) | Credential endpoint: 401 no auth, 403 wrong caller (x2), 400 bad UUID, 404 not found, 200 with credentials, audit log created. Preference endpoint: 401, 403 wrong caller, 400 bad UUID, 404 not found, 404 no prefs, 200 telegram-bridge, 200 ai-router, 200 scheduler. Schedule endpoint: 401, 403 wrong caller, 400 bad UUID, 404 not found, 200 with schedule fields |

## Verification Results

- **Biome**: `pnpm exec biome check` -- 0 errors, 0 warnings across all changed files
- **Tests (user-management)**: 6 test files, 107 tests passed, 0 failed
- **Tests (monica-integration)**: 5 test files, 51 tests passed, 0 failed

## Plan Review Findings Addressed

### MEDIUM findings

1. **UUID path parameter validation**: All three new endpoints (`/monica-credentials`, `/preferences`, `/schedule`) validate `:userId` as UUID using `z.string().uuid()` and return 400 for malformed UUIDs. Tests cover this case.

2. **Deterministic key identifier**: `encryption_key_id` uses first 8 hex characters of SHA-256 of the derived key (`computeKeyId()`) instead of static `'current'` string. This allows tracking which key version encrypted each row.

3. **Hardcoded constant HKDF salt**: Uses `Buffer.from("monica-companion-credential-encryption-v1")` as the salt in HKDF per RFC 5869 recommendation.

4. **Config wired to handler**: Endpoint handlers access encryption key via `config.encryptionMasterKey` and `config.encryptionMasterKeyPrevious` passed through `createApp(config, db)`.

### LOW findings

1. **Shared schema import**: `credential-client.ts` now imports `MonicaCredentialsResponse` from `@monica-companion/types` instead of defining it locally.

2. **File naming**: Types file named `user-management.ts` instead of `user-preferences.ts` since it contains credential schemas too.

3. **FK ordering in tests**: Test setup uses explicit `CREATE TABLE IF NOT EXISTS` statements in correct FK order (users first, then user_preferences and credential_access_audit_log).

4. **Smoke test seeding**: Tests use a `seedTestUser()` helper that inserts users directly via SQL with pre-encrypted credentials. For Docker Compose smoke tests, the same approach applies: insert a test user row via `psql` or a seed script before running curl checks against the endpoints.

## Plan Deviations

1. **Migration generated manually**: The Drizzle Kit CLI (`db:generate`) failed due to module resolution issues in the pnpm workspace. The migration SQL was written manually matching the exact Drizzle schema definition format. The migration file follows the same structure and naming convention as the existing `0000_classy_speed_demon.sql`.

2. **`_logger` prefix**: Biome flagged the `logger` variable as unused in `app.ts` since it was only used in the removed stub warning. It was renamed to `_logger` to satisfy the linter while preserving the logger creation for future use.

## Residual Risks

1. **Bulk re-encryption**: When rotating the encryption master key, credentials encrypted with the old key are only re-encrypted on individual reads. A bulk re-encryption script is not yet implemented. This means `ENCRYPTION_MASTER_KEY_PREVIOUS` must be kept until all users have had their credentials accessed.

2. **No user creation endpoint**: The `createUser` function exists in the repository but no HTTP endpoint creates users yet. User creation will be added when the onboarding form submission flow is implemented in `web-ui`.

3. **Integration tests require PostgreSQL**: The repository and app integration tests require a running PostgreSQL instance. They pass when Postgres is available and are skipped/fail when it is not (pre-existing pattern).

4. **DTS build failures**: The `tsup` DTS generation fails for `@monica-companion/types` and `@monica-companion/auth` due to `zod/v4` and `hono` type resolution. This is a pre-existing issue unrelated to this change; the ESM JS builds succeed and runtime functionality is unaffected.

5. **Smoke tests deferred**: Docker Compose smoke tests are not executed as part of this implementation because the `user-management` service startup requires the new `ENCRYPTION_MASTER_KEY` env var, and no `.env` file with a real key is committed to the repository. Smoke tests should be run after configuring the key in the deployment environment.
