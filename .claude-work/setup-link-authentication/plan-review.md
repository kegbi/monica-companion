---
verdict: APPROVED
attempt: 1
critical_count: 0
high_count: 0
medium_count: 5
---

# Plan Review: Setup-Link Authentication

## Summary

The plan implements the fourth roadmap item in Phase 1 (Security Baseline & Platform Skeleton): secure one-time setup tokens for onboarding. It introduces Drizzle ORM, PostgreSQL schema for setup tokens and audit logs, HMAC-signed opaque tokens with database state, CSRF protection via Double-Submit Cookie, and four internal HTTP endpoints on `user-management` with per-endpoint caller allowlists. The plan covers all three roadmap sub-items, respects service boundaries, and includes thorough TDD sequences and smoke tests.

The architecture decisions are sound: HMAC-signed tokens with database state are simpler than JWTs for stateful setup links, the partial unique index enforces one-active-per-user at the DB level, and the CSRF strategy avoids server-side sessions. Service boundaries are correctly maintained: `user-management` owns all token state, `telegram-bridge` can only issue/cancel, `web-ui` can only validate/consume.

## Findings

### CRITICAL
(none)

### HIGH
(none)

### MEDIUM

1. **[MEDIUM] `ConsumeSetupTokenRequest` schema in `packages/types` includes `csrfToken` which conflates concerns** (plan line 164). The CSRF check happens in `web-ui` middleware (Step 7, line 281-282) before the web-ui backend calls `user-management`. The CSRF token is a browser-facing concern and should never be part of the service-to-service API contract between `web-ui` and `user-management`. The `user-management` consume endpoint receives a service-auth JWT from `web-ui`, not a CSRF token. -- **Fix:** Remove `csrfToken` from `ConsumeSetupTokenRequest` in `packages/types`. If the consume endpoint needs additional request body fields beyond the tokenId path param, define them separately (e.g., the `sig` for HMAC verification). The CSRF token stays entirely within `web-ui`.

2. **[MEDIUM] CSRF cookie uses `HttpOnly=false` unnecessarily** (plan line 123). The plan says the CSRF token value is embedded in a hidden form field via server-side rendering (SSR). The server reads the cookie from the request `Cookie` header and the form value from the request body. JavaScript never needs to read the cookie. Setting `HttpOnly=false` exposes the CSRF token to XSS attacks for no benefit. -- **Fix:** Set `HttpOnly=true` on the CSRF cookie. The server can still read it from the request header. This provides defense-in-depth against XSS.

3. **[MEDIUM] Duplicate index in audit log schema** (plan lines 101-102). `idx_audit_log_token_id` and `idx_audit_log_telegram_user` both index the `token_id` column on `setup_token_audit_log`. The name of the second index suggests it was intended to index `telegram_user_id`, but that column does not exist on the audit log table. -- **Fix:** Remove the duplicate index.

4. **[MEDIUM] Stored `hmac_signature` column is unused by the verification path** (plan lines 76, 178-179). The `setup_tokens` table stores `hmac_signature TEXT NOT NULL`, but the `verifySetupTokenSignature` function (Step 4) recomputes the HMAC from `{tokenId, telegramUserId, step, expiresAtUnix}` using the current secret and compares it against the URL-provided `sig`. The stored signature is never compared in the described verification flow. -- **Fix:** Remove the `hmac_signature` column from the schema and always recompute the HMAC during verification.

5. **[MEDIUM] Form submission does not describe how `sig` is carried from the page URL to the consume call** (plan lines 242, 306-316). The validate endpoint at page load uses `sig` from the URL query string. The consume endpoint says "Verifies HMAC" before consuming, which requires the HMAC signature. However, the form submission to `/setup/submit` only mentions a hidden field for the CSRF token and token ID. -- **Fix:** Explicitly add `sig` as a hidden form field alongside `tokenId` in the form rendered by `[tokenId].astro`. Document that the submit route reads both `tokenId` and `sig` from the form body and passes the `sig` to the user-management consume endpoint.

### LOW

1. **[LOW] Ambiguous pg driver name.** Clarify: `postgres` from npmjs.com/package/postgres with Drizzle adapter `drizzle-orm/postgres-js`.

2. **[LOW] `@monica-companion/redaction` is referenced but currently empty.** Note as a forward reference.

3. **[LOW] Rate limiting on `/setup*` is deferred.** Track as follow-up in Observability & Governance Baseline phase.

4. **[LOW] `web-ui` config schema omits `SERVICE_NAME`.** Add to config.ts Zod schema.

## Architecture Boundary Compliance

Compliant. `user-management` owns token state. Caller allowlists are per-endpoint. Public ingress through Caddy only for `/setup*`. Internal APIs behind catch-all 404.

## Security Compliance

All setup-link security requirements satisfied: signed tokens, one-time consumption, 15-minute TTL, bound to identity, one-active-per-user, reissue invalidation, replay rejection, CSRF/Origin protection, audit logging.

## Testing Compliance

TDD sequences specified for every step. Integration tests against real PostgreSQL. Smoke tests through Docker Compose + Caddy.

## Verdict Rationale

Zero critical and high findings. Five medium findings are correctness/clarity issues addressable during implementation without architectural changes.
