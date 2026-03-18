# Implementation Plan: Setup-Link Authentication

## Objective

Implement the secure one-time setup token system that allows Telegram users to complete onboarding via the web UI. Setup links must be signed, time-limited (15 minutes), bound to a Telegram user identity and onboarding step, consumed on successful use, and subject to strict one-active-token-per-user enforcement. The onboarding form submission must be protected with CSRF/origin checks and all token lifecycle events must be audit-logged.

This is the fourth item in Phase 1 (Security Baseline & Platform Skeleton) and builds on the completed Inter-Service Security step. It is a prerequisite for any user-facing onboarding flow.

## Scope

### In Scope

- PostgreSQL `setup_tokens` table schema (Drizzle ORM) and `setup_token_audit_log` table.
- Drizzle ORM introduction to the monorepo (first use of database schemas).
- Token generation, HMAC signing, validation, consumption, cancellation, and reissue logic in `user-management`.
- One-active-token-per-user enforcement: issuing a new token invalidates any existing active token for that Telegram user.
- 15-minute TTL enforcement with server-side expiry checks.
- Replay rejection: tokens consumed on success cannot be reused.
- Cancellation flow: explicit cancellation from `telegram-bridge` revokes the active token.
- CSRF/origin protections on the onboarding form submission endpoint in `web-ui`.
- Audit logging for all token lifecycle events (issued, validated, consumed, expired-rejected, replayed-rejected, cancelled, reissue-invalidated).
- Zod schemas for all API contracts (token issue, validate, consume, cancel).
- Service boundary compliance: `telegram-bridge` requests token issuance/cancellation, `web-ui` validates/consumes tokens, `user-management` owns all token state.
- Unit tests (Vitest) and integration tests (real PostgreSQL).
- Docker Compose smoke tests through Caddy reverse proxy.

### Out of Scope

- The actual onboarding form fields (MonicaHQ URL, API key, timezone, etc.) -- that is Phase 2 (Least-Privilege User Management).
- Monica credential encryption at rest.
- User account creation and persistence beyond what the token system needs.
- `telegram-bridge` bot command handling (the `/setup` command implementation).
- Full web-ui onboarding form UI (only the token validation page and CSRF-protected submission endpoint).

## Affected Services & Packages

| Package/Service | Changes |
|-----------------|---------|
| `packages/types` | Add shared Zod schemas for setup token API contracts and onboarding step enum |
| `services/user-management` | Add Drizzle schema, token lifecycle logic, HTTP endpoints for issue/validate/consume/cancel, audit logging, config changes |
| `services/web-ui` | Add Astro API route for token validation on page load, CSRF/origin middleware, form submission endpoint that calls user-management |
| `services/telegram-bridge` | Add service client call to user-management for token issuance and cancellation (stub endpoint, actual bot command is out of scope) |
| `docker-compose.yml` | Add `DATABASE_URL`, `SETUP_TOKEN_SECRET` env vars to `user-management` and `web-ui` |
| `docker/Caddyfile` | No changes needed (already routes `/setup*` to `web-ui`) |
| `.env.example` | Add `SETUP_TOKEN_SECRET` |
| `pnpm-workspace.yaml` | Add `drizzle-orm` and `drizzle-kit` to catalog |

## Architecture Decisions

### Token Design: HMAC-Signed Opaque Token + Database State

Setup tokens use a two-layer design:

1. **Database row** in `setup_tokens` holds all state: token ID, Telegram user ID, onboarding step, status, created/expires/consumed timestamps. This is the source of truth for one-active-per-user, TTL, consumption, and replay rejection.

2. **URL token** is an HMAC-SHA256 signature over `tokenId:telegramUserId:step:expiresAt`, encoded as URL-safe base64. The token does not carry claims like a JWT; it is opaque to the browser. On validation, the server looks up the token ID embedded in the URL, verifies the HMAC, then checks database state.

This approach is simpler than JWTs for setup tokens because:
- The token must be checked against database state anyway (consumed? cancelled? reissued?).
- No need for asymmetric keys or JWT libraries beyond what the auth package already provides.
- The HMAC prevents forgery without requiring database lookup for the initial tamper check.

**URL format:** `/setup/{tokenId}?sig={hmac_signature}`

The `tokenId` is a UUID v4. The `sig` query parameter is the HMAC-SHA256 of `{tokenId}:{telegramUserId}:{step}:{expiresAtUnix}` using `SETUP_TOKEN_SECRET`.

### Database Schema

```sql
CREATE TABLE setup_tokens (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_user_id TEXT NOT NULL,
  step          TEXT NOT NULL DEFAULT 'onboarding',
  status        TEXT NOT NULL DEFAULT 'active',
  -- status values: 'active', 'consumed', 'cancelled', 'superseded'
  hmac_signature TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at    TIMESTAMPTZ NOT NULL,
  consumed_at   TIMESTAMPTZ,
  invalidated_at TIMESTAMPTZ
);

-- One active token per user enforcement
CREATE UNIQUE INDEX idx_setup_tokens_active_user
  ON setup_tokens (telegram_user_id)
  WHERE status = 'active';

CREATE TABLE setup_token_audit_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_id      UUID NOT NULL REFERENCES setup_tokens(id),
  event         TEXT NOT NULL,
  -- event values: 'issued', 'validated', 'consumed', 'expired_rejected',
  -- 'replay_rejected', 'cancelled', 'superseded_by_reissue',
  -- 'invalid_signature_rejected'
  actor_service TEXT NOT NULL,
  ip_address    TEXT,
  correlation_id TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_log_token_id ON setup_token_audit_log(token_id);
CREATE INDEX idx_audit_log_telegram_user ON setup_token_audit_log(token_id);
```

The partial unique index on `(telegram_user_id) WHERE status = 'active'` enforces at the database level that only one active token exists per Telegram user. Any attempt to insert a second active token for the same user will fail, serving as a safety net for the application-level logic that supersedes the old token first.

### Service Boundary Ownership

- **`user-management`** owns all token state, generation, validation, consumption, cancellation, and audit logging. It exposes four internal endpoints:
  - `POST /internal/setup-tokens` -- issue a new token (caller: `telegram-bridge`)
  - `GET /internal/setup-tokens/:tokenId/validate` -- validate a token without consuming it (caller: `web-ui`)
  - `POST /internal/setup-tokens/:tokenId/consume` -- consume a token on successful onboarding (caller: `web-ui`)
  - `POST /internal/setup-tokens/:tokenId/cancel` -- cancel an active token (caller: `telegram-bridge`)

- **`telegram-bridge`** requests token issuance when the user asks for a setup link (future bot command) and cancellation when the user explicitly cancels.

- **`web-ui`** validates the token when the user opens the setup page and consumes it when the onboarding form is successfully submitted.

### CSRF/Origin Protection Strategy

The web-ui onboarding form uses a **Double-Submit Cookie** pattern:

1. When the setup page loads (after token validation), the server generates a random CSRF token, sets it as an `__Host-csrf` cookie (`HttpOnly=false`, `SameSite=Strict`, `Secure`, `Path=/setup`), and embeds the same value in a hidden form field.
2. On form submission, the server verifies that the cookie value matches the hidden field value.
3. Additionally, the server checks the `Origin` header against the expected origin (the public-facing Caddy hostname) and rejects requests with mismatched or missing origins.

This does not require server-side session storage and works with Astro's SSR model.

## Implementation Steps

### Step 1: Introduce Drizzle ORM to the monorepo

**What:** Add `drizzle-orm` and `postgres` (pg driver) as dependencies to `user-management`. Add `drizzle-kit` as a dev dependency for migrations. Add version pins to `pnpm-workspace.yaml` catalog.

**Files to create/modify:**
- `pnpm-workspace.yaml` -- add `drizzle-orm`, `drizzle-kit`, `postgres` to catalog (verify latest stable versions before pinning)
- `services/user-management/package.json` -- add `drizzle-orm`, `postgres` as dependencies, `drizzle-kit` as devDependency
- `services/user-management/drizzle.config.ts` -- Drizzle Kit configuration pointing to `./src/db/schema.ts` and PostgreSQL connection

**Expected outcome:** `pnpm install` succeeds. Drizzle Kit can be invoked. No runtime behavior changes yet.

### Step 2: Define the setup_tokens and audit_log Drizzle schemas

**What:** Create the Drizzle ORM table definitions for `setup_tokens` and `setup_token_audit_log` in `user-management`. Create a database connection module.

**Files to create:**
- `services/user-management/src/db/schema.ts` -- Drizzle table definitions for `setup_tokens` and `setup_token_audit_log` with the columns, types, indexes, and constraints described in the Architecture Decisions section
- `services/user-management/src/db/connection.ts` -- exports a `getDb()` function that creates a Drizzle instance from `DATABASE_URL` env var, with a lazy singleton pattern
- `services/user-management/src/db/index.ts` -- re-exports schema and connection

**Expected outcome:** `drizzle-kit generate` produces a migration file. Schema types are available for use in service code.

### Step 3: Add shared setup token Zod schemas to packages/types

**What:** Define the shared API contract schemas that `user-management`, `web-ui`, and `telegram-bridge` all reference.

**Files to create/modify:**
- `packages/types/src/setup-token.ts` -- Zod schemas and TypeScript types:
  - `OnboardingStep` enum: `z.enum(["onboarding"])` (extensible later)
  - `SetupTokenStatus` enum: `z.enum(["active", "consumed", "cancelled", "superseded"])`
  - `IssueSetupTokenRequest` schema: `{ telegramUserId: string, step: OnboardingStep }`
  - `IssueSetupTokenResponse` schema: `{ setupUrl: string, tokenId: string, expiresAt: string }`
  - `ValidateSetupTokenResponse` schema: `{ valid: boolean, telegramUserId: string, step: string, expiresAt: string }`
  - `ConsumeSetupTokenRequest` schema: `{ csrfToken: string }` (the form data is out of scope for this task, only the consumption wrapper)
  - `ConsumeSetupTokenResponse` schema: `{ consumed: boolean }`
  - `CancelSetupTokenResponse` schema: `{ cancelled: boolean }`
  - `SetupTokenAuditEvent` enum
- `packages/types/src/index.ts` -- re-export from `setup-token.ts`

**Expected outcome:** Types are importable by all three services. `pnpm build` in `packages/types` succeeds.

### Step 4: Implement token generation and HMAC signing in user-management

**What:** Create the core token lifecycle module with pure functions for generation, signing, and signature verification. This module has no database dependency, making it unit-testable.

**Files to create:**
- `services/user-management/src/setup-token/crypto.ts`:
  - `generateSetupToken(params: { tokenId: string, telegramUserId: string, step: string, expiresAtUnix: number, secret: string }): string` -- returns HMAC-SHA256 as URL-safe base64
  - `verifySetupTokenSignature(params: { tokenId: string, telegramUserId: string, step: string, expiresAtUnix: number, signature: string, secret: string }): boolean` -- timing-safe comparison
  - `buildSetupUrl(params: { baseUrl: string, tokenId: string, signature: string }): string`

**TDD sequence:**
1. Write failing test: `generateSetupToken` returns a non-empty string for valid inputs.
2. Implement minimal code.
3. Write failing test: `verifySetupTokenSignature` returns true for a matching signature.
4. Implement.
5. Write failing test: `verifySetupTokenSignature` returns false for a tampered tokenId.
6. Implement (should already pass with timing-safe compare).
7. Write failing test: `buildSetupUrl` produces the expected URL format.
8. Implement.

**Files to create:**
- `services/user-management/src/setup-token/__tests__/crypto.test.ts`

**Expected outcome:** All crypto unit tests pass. No database needed.

### Step 5: Implement token lifecycle repository (database layer)

**What:** Create a repository module that wraps Drizzle queries for all setup token operations. Each operation includes the appropriate audit log entry in the same transaction.

**Files to create:**
- `services/user-management/src/setup-token/repository.ts`:
  - `issueToken(db, params: { telegramUserId, step, expiresAt, hmacSignature, correlationId, actorService })` -- in a transaction: UPDATE any existing active token for this user to `superseded` status + audit log `superseded_by_reissue`, then INSERT new active token + audit log `issued`. Returns the new token row.
  - `findActiveToken(db, tokenId)` -- SELECT token by ID where status = 'active' and expires_at > now(). Returns token row or null.
  - `consumeToken(db, params: { tokenId, correlationId, actorService, ipAddress })` -- in a transaction: UPDATE token to `consumed` with `consumed_at = now()` WHERE status = 'active' AND expires_at > now(). If no rows updated, return `{ consumed: false, reason }`. Add audit log entry. Returns `{ consumed: true }`.
  - `cancelToken(db, params: { telegramUserId, correlationId, actorService })` -- UPDATE active token for the user to `cancelled`, add audit log. Returns `{ cancelled: boolean }`.
  - `logAuditEvent(db, params: { tokenId, event, actorService, ipAddress, correlationId })` -- INSERT into audit log.

**TDD sequence:**
1. Write failing integration test: `issueToken` inserts a row and returns it.
2. Implement minimal code.
3. Write failing test: `issueToken` for same user supersedes the previous active token.
4. Implement.
5. Write failing test: partial unique index prevents two active tokens for same user (raw INSERT, bypassing repo).
6. Verify index works.
7. Write failing test: `consumeToken` marks token as consumed and returns `{ consumed: true }`.
8. Implement.
9. Write failing test: `consumeToken` on already-consumed token returns `{ consumed: false, reason: "already_consumed" }`.
10. Implement.
11. Write failing test: `consumeToken` on expired token returns `{ consumed: false, reason: "expired" }`.
12. Implement.
13. Write failing test: `cancelToken` sets status to cancelled.
14. Implement.
15. Write failing test: every operation creates an audit log entry.
16. Verify.

**Files to create:**
- `services/user-management/src/setup-token/__tests__/repository.integration.test.ts`

**Expected outcome:** Integration tests pass against real PostgreSQL (Docker Compose test profile). All CRUD operations and audit logging verified.

### Step 6: Implement user-management HTTP endpoints

**What:** Add the four internal setup-token endpoints to `user-management` with service auth, Zod validation, and the full token lifecycle wiring.

**Files to create/modify:**
- `services/user-management/src/config.ts` -- new config module with Zod schema for environment variables: `DATABASE_URL`, `SETUP_TOKEN_SECRET`, `SETUP_BASE_URL`, `PORT`, `SERVICE_NAME`, `JWT_SECRET`, `JWT_SECRET_PREVIOUS`
- `services/user-management/src/app.ts` -- new Hono app factory (following `telegram-bridge` pattern) with:
  - `GET /health` -- public, no auth
  - `POST /internal/setup-tokens` -- serviceAuth, allowedCallers: `["telegram-bridge"]`. Validates `IssueSetupTokenRequest`, generates token + HMAC, calls `issueToken` repository, returns `IssueSetupTokenResponse`.
  - `GET /internal/setup-tokens/:tokenId/validate` -- serviceAuth, allowedCallers: `["web-ui"]`. Looks up token, verifies HMAC against URL `sig` query param, checks status/expiry, logs `validated` or rejection audit event, returns `ValidateSetupTokenResponse`.
  - `POST /internal/setup-tokens/:tokenId/consume` -- serviceAuth, allowedCallers: `["web-ui"]`. Verifies HMAC, calls `consumeToken`, returns `ConsumeSetupTokenResponse`.
  - `POST /internal/setup-tokens/:tokenId/cancel` -- serviceAuth, allowedCallers: `["telegram-bridge"]`. Calls `cancelToken`, returns `CancelSetupTokenResponse`.
- `services/user-management/src/index.ts` -- update to use `createApp(config)` pattern from `app.ts`
- `services/user-management/package.json` -- add `@monica-companion/auth`, `@monica-companion/types`, `zod` as dependencies

**TDD sequence:**
1. Write failing test: `POST /internal/setup-tokens` without auth returns 401.
2. Implement auth middleware.
3. Write failing test: `POST /internal/setup-tokens` with valid auth + body returns 201 with `setupUrl` and `tokenId`.
4. Implement endpoint.
5. Write failing test: `POST /internal/setup-tokens` for same user invalidates previous token.
6. Verify (should pass from repo logic).
7. Write failing test: `GET /internal/setup-tokens/:tokenId/validate` with valid token returns `{ valid: true }`.
8. Implement.
9. Write failing test: validate with expired token returns `{ valid: false }`.
10. Implement.
11. Write failing test: validate with wrong signature returns 403.
12. Implement.
13. Write failing test: `POST /internal/setup-tokens/:tokenId/consume` consumes valid token.
14. Implement.
15. Write failing test: consume same token again returns `{ consumed: false }`.
16. Verify.
17. Write failing test: `POST /internal/setup-tokens/:tokenId/cancel` cancels active token.
18. Implement.
19. Write failing test: cancel for user with no active token returns `{ cancelled: false }`.
20. Verify.

**Files to create:**
- `services/user-management/src/__tests__/app.test.ts`

**Expected outcome:** All endpoint unit tests pass (mocked DB for unit, real DB for integration).

### Step 7: Add CSRF/origin middleware to web-ui

**What:** Implement the Double-Submit Cookie CSRF pattern and Origin header checking as Astro middleware.

**Files to create:**
- `services/web-ui/src/middleware.ts` -- Astro middleware that:
  - For GET requests to `/setup/*`: generates a CSRF token (random 32 bytes, hex-encoded), sets `__Host-csrf` cookie with `SameSite=Strict; Secure; Path=/setup`, and stores the value in `Astro.locals.csrfToken` for injection into the page.
  - For POST requests to `/setup/*`: reads the `__Host-csrf` cookie and the `csrf_token` form field (or JSON body field), performs timing-safe comparison, and also checks the `Origin` header against `EXPECTED_ORIGIN` env var. Returns 403 on mismatch.
  - In development mode (non-HTTPS), use `csrf` cookie name without `__Host-` prefix and skip `Secure` flag.

**TDD sequence:**
1. Write failing test: GET to `/setup/test` sets the `__Host-csrf` (or `csrf` in dev) cookie.
2. Implement middleware.
3. Write failing test: POST to `/setup/test` without CSRF token returns 403.
4. Implement validation.
5. Write failing test: POST with matching cookie + body CSRF token passes.
6. Implement.
7. Write failing test: POST with mismatched Origin header returns 403.
8. Implement.

**Files to create:**
- `services/web-ui/src/__tests__/middleware.test.ts`

**Note:** Astro middleware testing requires a test helper that simulates the Astro middleware context. Use a thin adapter or test the underlying utility functions directly.

**Expected outcome:** CSRF middleware passes all unit tests.

### Step 8: Implement web-ui setup page with token validation

**What:** Replace the placeholder `index.astro` setup page with a page that validates the setup token on load and renders the onboarding form (or an error state).

**Files to create/modify:**
- `services/web-ui/src/pages/setup/[tokenId].astro` -- Astro page that:
  - On load, reads `tokenId` from params and `sig` from query string.
  - Calls `user-management` `GET /internal/setup-tokens/:tokenId/validate?sig=...` via service client.
  - If valid: renders the onboarding form with the CSRF token in a hidden field and the token ID.
  - If invalid: renders an error message ("This link has expired or already been used. Please return to Telegram to request a new setup link.").
- `services/web-ui/src/pages/setup/submit.ts` -- Astro API route (POST) that:
  - CSRF/origin checks are handled by middleware.
  - Reads form data.
  - Calls `user-management` `POST /internal/setup-tokens/:tokenId/consume` via service client.
  - If consumed: returns success redirect/message.
  - If not consumed: returns appropriate error.
- `services/web-ui/src/lib/user-management-client.ts` -- service client using `@monica-companion/auth`'s `createServiceClient` with issuer `web-ui`, audience `user-management`.
- `services/web-ui/src/config.ts` -- Zod-validated env config: `USER_MANAGEMENT_URL`, `JWT_SECRET`, `EXPECTED_ORIGIN`
- `services/web-ui/package.json` -- add `@monica-companion/auth`, `@monica-companion/types`, `zod` as dependencies
- `services/web-ui/astro.config.ts` -- no changes needed (already SSR with Node adapter)

**TDD sequence:**
1. Write failing test: GET `/setup/{validTokenId}?sig=...` calls user-management validate endpoint and renders form.
2. Implement page.
3. Write failing test: GET with invalid token renders error message.
4. Implement.
5. Write failing test: POST `/setup/submit` with valid CSRF + valid token calls consume and returns success.
6. Implement.
7. Write failing test: POST `/setup/submit` with already-consumed token returns error.
8. Implement.

**Files to create:**
- `services/web-ui/src/__tests__/setup-page.test.ts`

**Expected outcome:** Web-ui serves the setup page, validates tokens, and handles form submission with CSRF protection.

### Step 9: Add token issuance and cancellation stubs to telegram-bridge

**What:** Add a service client from `telegram-bridge` to `user-management` for issuing and cancelling setup tokens. The actual bot command handler is out of scope; this step adds only the client and an internal endpoint that future bot command logic will call.

**Files to create/modify:**
- `services/telegram-bridge/src/lib/user-management-client.ts` -- service client using `createServiceClient` with issuer `telegram-bridge`, audience `user-management`.
- `services/telegram-bridge/src/config.ts` -- add `USER_MANAGEMENT_URL` env var.

**Expected outcome:** `telegram-bridge` can make authenticated calls to `user-management` setup token endpoints. No bot command wiring yet.

### Step 10: Update Docker Compose configuration

**What:** Add the required environment variables to `docker-compose.yml` for `user-management` and `web-ui`.

**Files to modify:**
- `docker-compose.yml`:
  - `user-management` service: add `DATABASE_URL`, `SERVICE_NAME`, `JWT_SECRET`, `JWT_SECRET_PREVIOUS`, `SETUP_TOKEN_SECRET`, `SETUP_BASE_URL` env vars.
  - `web-ui` service: add `USER_MANAGEMENT_URL`, `SERVICE_NAME`, `JWT_SECRET`, `JWT_SECRET_PREVIOUS`, `EXPECTED_ORIGIN` env vars. `web-ui` needs to talk to `user-management` over the internal network.
  - `telegram-bridge` service: add `USER_MANAGEMENT_URL` env var.
- `.env.example`: add `SETUP_TOKEN_SECRET`, `SETUP_BASE_URL`.

**Expected outcome:** All services start with correct environment variables.

### Step 11: Run database migrations and smoke test

**What:** Apply the Drizzle migration to PostgreSQL and run the full smoke test through Docker Compose.

**Steps:**
1. Start infrastructure: `docker compose up -d postgres redis caddy`
2. Run migration: `docker compose run --rm user-management sh -c "./node_modules/.bin/drizzle-kit push"`
3. Start app services: `docker compose --profile app up -d user-management web-ui telegram-bridge`
4. Run smoke tests (see Smoke Test Strategy below).
5. Tear down: `docker compose --profile app down`

**Expected outcome:** Smoke tests pass, proving the full network path works through Caddy.

## Test Strategy

### Unit Tests (Vitest)

| Module | What to test | What to mock |
|--------|-------------|--------------|
| `setup-token/crypto.ts` | HMAC generation, verification, timing-safe comparison, URL building | Nothing (pure functions) |
| `setup-token/repository.ts` | All CRUD operations, audit logging, one-active-per-user, superseding, replay rejection | Nothing (integration test against real PostgreSQL) |
| `user-management/app.ts` | All 4 endpoints: auth enforcement, Zod validation, success/error paths, caller allowlists | Database (use in-memory mock or test database) |
| `web-ui/middleware.ts` | CSRF cookie setting, CSRF validation, Origin checking, timing-safe comparison | Nothing (pure middleware logic) |
| `web-ui/setup page` | Token validation flow, error rendering, form submission | `user-management` HTTP calls (mock fetch) |

### Integration Tests (Real PostgreSQL + Redis)

| Test suite | What needs real infra |
|------------|----------------------|
| `repository.integration.test.ts` | PostgreSQL: verifies schema, partial unique index, transactional superseding, audit log writes |
| `app.integration.test.ts` | PostgreSQL + the full Hono app: end-to-end endpoint tests with real database |

**Test database setup:** Use a Docker Compose test profile or `testcontainers` to spin up a PostgreSQL container. Each test suite creates a fresh schema (or uses transactions that roll back).

### TDD Sequence Summary

For each step, the pattern is:
1. Write the failing test that exercises the next behavior slice.
2. Run `pnpm test` in the relevant package to confirm it fails with the expected assertion error (not a syntax or import error).
3. Write the minimal implementation to make it pass.
4. Refactor if needed.
5. Commit the passing test + implementation together.

## Smoke Test Strategy

### Docker Compose Services to Start

```bash
docker compose up -d postgres redis caddy
docker compose --profile app up -d user-management web-ui telegram-bridge
```

Wait for health checks:
```bash
# Verify services are healthy (internal network only, via docker exec)
docker exec $(docker compose ps -q user-management) curl -sf http://localhost:3007/health
docker exec $(docker compose ps -q web-ui) curl -sf http://localhost:4321
```

### HTTP Checks to Run

**Check 1: Setup page is publicly accessible through Caddy**
```bash
# Should get a response from web-ui (even if it's an error page without a valid token)
curl -sf -o /dev/null -w "%{http_code}" http://localhost/setup/00000000-0000-0000-0000-000000000000
# Expected: 200 (error page rendered) or appropriate status
```

**Check 2: Internal APIs are NOT publicly accessible through Caddy**
```bash
curl -sf -o /dev/null -w "%{http_code}" http://localhost/internal/setup-tokens 2>/dev/null
# Expected: 404 (Caddy's catch-all)
```

**Check 3: Token issuance via internal network**
```bash
# Issue a token from telegram-bridge to user-management (simulate via docker exec)
docker exec $(docker compose ps -q telegram-bridge) \
  node -e "
    const { createServiceClient } = require('@monica-companion/auth');
    const client = createServiceClient({
      issuer: 'telegram-bridge',
      audience: 'user-management',
      secret: process.env.JWT_SECRET,
      baseUrl: 'http://user-management:3007'
    });
    client.fetch('/internal/setup-tokens', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ telegramUserId: 'test-123', step: 'onboarding' })
    }).then(r => r.json()).then(console.log);
  "
# Expected: { setupUrl: "http://...", tokenId: "...", expiresAt: "..." }
```

**Check 4: Token validation through Caddy (public path)**
```bash
# Using the setupUrl from Check 3, access it through Caddy
curl -sf -o /dev/null -w "%{http_code}" "http://localhost/setup/{tokenId}?sig={signature}"
# Expected: 200 (form page rendered)
```

**Check 5: CSRF protection on form submission**
```bash
# POST without CSRF token should be rejected
curl -sf -X POST -o /dev/null -w "%{http_code}" http://localhost/setup/submit
# Expected: 403
```

**Check 6: Reissue invalidates previous token**
```bash
# Issue token A, then issue token B for same user
# Verify token A is no longer valid (returns error page when accessed)
```

### What the Smoke Test Proves

- Caddy correctly routes `/setup/*` to `web-ui` (public ingress).
- Internal APIs at `/internal/*` are NOT accessible through Caddy (ingress hardening).
- `web-ui` can call `user-management` over the internal Docker network with service auth.
- `telegram-bridge` can call `user-management` for token issuance over the internal network.
- Token lifecycle works end-to-end: issue, validate, consume.
- CSRF protection rejects unprotected form submissions.
- Reissue properly invalidates previous tokens.

### Teardown

```bash
docker compose --profile app down
docker compose down
```

## Security Considerations

1. **HMAC secret management** (ref: `security.md` JWT signing keys and encryption master keys): `SETUP_TOKEN_SECRET` must be at least 32 bytes, cryptographically random, and distinct from `JWT_SECRET`. Add it to the secret rotation schedule.

2. **Timing-safe comparison** (ref: `security.md` setup links are authentication artifacts): All signature verifications use `crypto.timingSafeEqual` to prevent timing side-channel attacks. The existing `webhook-secret.ts` pattern in `telegram-bridge` demonstrates the approach.

3. **One-time consumption** (ref: `security.md` setup links consumed on success, rejected if replayed): The `consumeToken` repository method uses a conditional UPDATE (`WHERE status = 'active' AND expires_at > now()`) that atomically transitions the token. If two concurrent requests race, only one will succeed; the other gets `{ consumed: false }`.

4. **One-active-per-user** (ref: `security.md` limited to one active token per Telegram user): Enforced at two levels: application logic (supersede before insert) and database partial unique index (safety net).

5. **TTL enforcement** (ref: `security.md` valid for 15 minutes): `expires_at` is set to `now() + 15 minutes` at issuance. All validation and consumption checks include `expires_at > now()` in the SQL WHERE clause. The server clock is the authority, not the token.

6. **CSRF protection** (ref: `security.md` CSRF/origin protections): Double-Submit Cookie with `SameSite=Strict` and `Origin` header verification. The `__Host-` cookie prefix (in production) prevents subdomain attacks.

7. **Audit logging** (ref: `security.md` audit logging for token lifecycle): Every token lifecycle event is recorded with actor service, IP address, and correlation ID. Audit logs use `@monica-companion/redaction` to ensure no sensitive data leaks.

8. **No sensitive data in URLs** (ref: `security.md` keep secrets out of logs, responses, error messages): The URL contains only the token ID and HMAC signature. Neither reveals the Telegram user ID or any credentials. The HMAC signature alone is useless without the server-side secret.

9. **Service boundary enforcement** (ref: `service-boundaries.md`, `security.md`): Each endpoint has an explicit `allowedCallers` list. `telegram-bridge` can only issue/cancel. `web-ui` can only validate/consume. No other services can access setup token endpoints.

10. **Request validation** (ref: `definition-of-done.md` strict payload validation): All request bodies are validated with Zod schemas before processing. Invalid payloads return 400 with a generic error message (no schema details leaked).

## Risks & Open Questions

1. **Drizzle ORM introduction:** This is the first use of Drizzle in the project. The migration workflow (`drizzle-kit push` vs `drizzle-kit generate + migrate`) needs a team decision. The plan uses `drizzle-kit push` for development simplicity but `generate + migrate` should be adopted before production.

2. **Astro middleware testing:** Astro does not have a built-in test harness for middleware. The CSRF middleware tests may need to either test the underlying utility functions directly or use a lightweight request simulation. This may require extracting the CSRF logic into a testable pure function.

3. **SETUP_BASE_URL configuration:** The URL returned to the user (via Telegram) must use the public-facing hostname, not the internal Docker network hostname. `SETUP_BASE_URL` must be set to the Caddy-fronted URL (e.g., `https://companion.example.com` or `http://localhost` for development).

4. **Database migration strategy:** The plan assumes `drizzle-kit push` for initial development. A migration-file-based approach (`drizzle-kit generate`) should be adopted before the next phase to ensure reproducible schema changes.

5. **Cookie behavior in development:** The `__Host-` cookie prefix requires HTTPS. In local development over HTTP (through Caddy on port 80), the CSRF middleware must fall back to a regular `csrf` cookie name. This environment-specific behavior must be tested.

6. **Astro dependency on `@monica-companion/auth`:** Astro uses Vite internally. Importing the `@monica-companion/auth` package (which depends on `jose` and `hono`) in Astro server-side code should work since the adapter is Node.js, but it needs verification that the ESM imports resolve correctly in Astro's SSR build pipeline.

7. **Rate limiting on setup page:** The Caddyfile does not currently have rate limiting on `/setup*`. Consider adding `rate_limit` directive to prevent token-guessing brute force. The UUID + HMAC combination makes brute force impractical, but rate limiting adds defense in depth. This can be deferred to the observability baseline phase.
