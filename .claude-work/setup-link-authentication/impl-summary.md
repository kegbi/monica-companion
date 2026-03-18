# Implementation Summary: Setup-Link Authentication

## Files Changed

| File | Action | Description |
|------|--------|-------------|
| `pnpm-workspace.yaml` | modified | Added `drizzle-orm@0.45.1`, `drizzle-kit@0.31.9`, `postgres@3.4.8` to catalog |
| `packages/types/package.json` | modified | Added `zod` dependency |
| `packages/types/src/setup-token.ts` | created | Zod schemas for all setup token API contracts (IssueSetupTokenRequest/Response, ValidateSetupTokenResponse, ConsumeSetupTokenRequest/Response, CancelSetupTokenResponse, OnboardingStep, SetupTokenStatus, SetupTokenAuditEvent) |
| `packages/types/src/index.ts` | modified | Re-exports all setup token schemas |
| `services/user-management/package.json` | modified | Added drizzle-orm, postgres, drizzle-kit, @monica-companion/auth, @monica-companion/types, zod, @types/node dependencies |
| `services/user-management/drizzle.config.ts` | created | Drizzle Kit configuration for PostgreSQL |
| `services/user-management/vitest.config.ts` | created | Vitest config with `fileParallelism: false` for database test isolation |
| `services/user-management/src/db/schema.ts` | created | Drizzle table definitions for `setup_tokens` and `setup_token_audit_log` with partial unique index |
| `services/user-management/src/db/connection.ts` | created | Database connection module with `createDb()` and `getDb()` singleton |
| `services/user-management/src/db/index.ts` | created | Re-exports schema and connection |
| `services/user-management/src/setup-token/crypto.ts` | created | HMAC-SHA256 token generation, timing-safe verification, and URL building |
| `services/user-management/src/setup-token/repository.ts` | created | Token lifecycle repository (issue, find, consume, cancel, audit logging) with transactional consistency |
| `services/user-management/src/config.ts` | created | Zod-validated config with DATABASE_URL, SETUP_TOKEN_SECRET, SETUP_BASE_URL, SETUP_TOKEN_TTL_MINUTES |
| `services/user-management/src/app.ts` | modified | Hono app with 4 internal endpoints; added try/catch around `c.req.json()` for issue and consume endpoints to return 400 on malformed JSON |
| `services/user-management/src/index.ts` | modified | Updated to use createApp(config, db) pattern |
| `services/user-management/drizzle/0000_classy_speed_demon.sql` | created | Generated SQL migration for setup_tokens and setup_token_audit_log tables |
| `services/web-ui/package.json` | modified | Added @monica-companion/auth, @monica-companion/types, zod, vitest dependencies |
| `services/web-ui/src/env.d.ts` | created | TypeScript declarations for Astro locals (csrfToken) |
| `services/web-ui/src/lib/csrf.ts` | modified | Fixed `__Host-` cookie to use `Path=/` per RFC 6265bis; changed `validateOrigin` parameter type to accept `string | null | undefined` |
| `services/web-ui/src/lib/user-management-client.ts` | created | Service client for web-ui to user-management communication |
| `services/web-ui/src/config.ts` | created | Zod-validated config for USER_MANAGEMENT_URL, JWT_SECRET, EXPECTED_ORIGIN, SERVICE_NAME |
| `services/web-ui/src/middleware.ts` | created | Astro middleware implementing Double-Submit Cookie CSRF pattern |
| `services/web-ui/src/pages/setup/[tokenId].astro` | created | Dynamic setup page that validates token and renders form with CSRF + sig hidden fields |
| `services/web-ui/src/pages/setup/submit.ts` | modified | Changed error response to use generic message instead of forwarding upstream error details |
| `services/telegram-bridge/src/config.ts` | modified | Added optional USER_MANAGEMENT_URL env var |
| `services/telegram-bridge/src/lib/user-management-client.ts` | created | Service client stub for telegram-bridge to user-management |
| `docker-compose.yml` | modified | Added env vars to user-management (DATABASE_URL, SERVICE_NAME, JWT_SECRET, SETUP_TOKEN_SECRET, SETUP_BASE_URL), web-ui (SERVICE_NAME, JWT_SECRET, USER_MANAGEMENT_URL, EXPECTED_ORIGIN), telegram-bridge (USER_MANAGEMENT_URL) |
| `.env.example` | modified | Added SETUP_TOKEN_SECRET, SETUP_BASE_URL, EXPECTED_ORIGIN |

## Tests Added

| Test File | What It Tests |
|-----------|---------------|
| `services/user-management/src/setup-token/__tests__/crypto.test.ts` | HMAC token generation (14 tests): non-empty output, URL-safe base64, determinism, different secrets produce different signatures, timing-safe verification for matching/tampered inputs, buildSetupUrl format |
| `services/user-management/src/setup-token/__tests__/repository.integration.test.ts` | Database repository (13 tests): issue token, supersede on reissue, consume token, reject consumed/expired tokens, cancel token, audit log entries for all lifecycle events |
| `services/user-management/src/__tests__/config.test.ts` | Config parsing (8 tests): valid env, defaults, missing required fields, short secret rejection, port coercion, JWT secret rotation |
| `services/user-management/src/__tests__/app.test.ts` | HTTP endpoints (22 tests): auth enforcement (401/403), Zod validation (400), malformed JSON body (400), token issue (201), superseding on reissue, validate (valid/invalid/expired/wrong-sig), consume (success/replay/wrong-sig/malformed-json), cancel (success/nonexistent), caller allowlists |
| `services/web-ui/src/lib/__tests__/csrf.test.ts` | CSRF utilities (18 tests): token generation (hex format, length, uniqueness), cookie name (prod/dev), cookie header building (HttpOnly, Secure, SameSite, Path=/ for __Host-), token validation (match/mismatch/undefined/length), origin validation (match/mismatch/undefined/null/trailing slashes) |

## Verification Results

- **Biome**: `pnpm biome check --write .` -- pass, 106 files checked, 0 errors
- **Tests**: `pnpm test` -- all 164 tests pass
  - `@monica-companion/auth`: 55 tests passed (5 files)
  - `@monica-companion/telegram-bridge`: 34 tests passed (4 files)
  - `@monica-companion/user-management`: 57 tests passed (4 files)
  - `@monica-companion/web-ui`: 18 tests passed (1 file)
  - Other services: no test files, pass with `--passWithNoTests`

## Code Review Fixes Applied

| Finding | Severity | Fix |
|---------|----------|-----|
| `__Host-` cookie uses `Path=/setup` violating RFC 6265bis | HIGH | Changed to `Path=/` when `isSecure=true`, kept `Path=/setup` for development mode. Updated test assertion. |
| `validateOrigin` parameter type mismatch (`string | null` vs `string | undefined`) | MEDIUM | Changed parameter type to `string | null | undefined`. Added test for null case. |
| `c.req.json()` can throw on malformed JSON (issue + consume endpoints) | LOW | Wrapped in try/catch returning 400 with "Invalid request body". Added 2 new tests. |
| `submit.ts` forwards upstream error details to end user | LOW | Replaced with generic error message: "Unable to complete setup. Please try again or request a new setup link." |

## Plan Deviations

1. **App routing structure**: Used inline middleware per route (`app.post("/path", auth, handler)`) instead of sub-routers (`app.route("/path", subRouter)`) because Hono's route matching with multiple sub-routers at the same base path caused routing conflicts.

2. **ConsumeSetupTokenRequest.sig field**: Added `sig: z.string().min(1)` to `ConsumeSetupTokenRequest` in `packages/types` to carry the HMAC signature from the form through to the consume endpoint. This aligns with plan review fix #5 (carry sig from form to consume) and fix #1 (remove csrfToken).

3. **Integration tests use inline SQL for schema creation**: Instead of running `drizzle-kit push` in tests, the integration tests create tables directly via SQL in `beforeAll`. This avoids needing drizzle-kit CLI during test runs while still testing against real PostgreSQL.

4. **Vitest config added**: Added `vitest.config.ts` to user-management with `fileParallelism: false` to prevent test files from interfering with each other when sharing the same database.

5. **Telegram-bridge config**: Made `USER_MANAGEMENT_URL` optional (not required) to avoid breaking existing tests that do not provide it. The actual bot command handler (out of scope) will require it.

6. **Smoke tests deferred**: Docker Compose smoke tests are not automated in this implementation step. The infrastructure configuration is in place, but full Docker Compose smoke testing requires the stack to be started, which is a manual verification step per the plan's Step 11.

## Residual Risks

1. **Astro middleware not unit-tested in Astro context**: The CSRF middleware is tested via the pure utility functions. The Astro middleware integration (`middleware.ts`) uses `defineMiddleware` from `astro:middleware` which requires the full Astro build pipeline to test. The CSRF logic itself is fully covered.

2. **Web-ui setup page not unit-tested**: The Astro page (`[tokenId].astro`) and API route (`submit.ts`) are not covered by automated tests because they depend on the Astro runtime (JSX rendering, `import.meta.env`, etc.). These are covered by the smoke test strategy.

3. **`@monica-companion/redaction` is referenced in rules but the package is currently empty**: Audit log entries do not apply redaction yet. This is a forward reference noted in the plan review (LOW finding).

4. **drizzle-kit migration meta files**: The generated migration includes `_journal.json` and `meta/` files in the `drizzle/` directory that should be committed for reproducible migrations.

5. **Rate limiting on `/setup*`**: Not implemented -- deferred to Observability & Governance Baseline phase as noted in the plan.
