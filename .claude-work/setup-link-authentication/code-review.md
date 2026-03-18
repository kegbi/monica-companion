---
verdict: REJECTED
attempt: 1
biome_pass: true
tests_pass: true
test_summary: "161 passed, 0 failed (auth:55, telegram-bridge:34, user-management:55, web-ui:17)"
critical_count: 0
high_count: 1
medium_count: 1
---

# Code Review: Setup-Link Authentication

## Automated Checks
- **Biome**: PASS -- 106 files checked, 0 errors (1 auto-fix applied on first run, clean on re-check)
- **Tests**: PASS -- 161 tests passed across 4 packages (auth:55, telegram-bridge:34, user-management:55, web-ui:17)
- **TypeScript**: FAIL (web-ui only) -- 1 type error in `services/web-ui/src/middleware.ts:45`

## Findings

### CRITICAL
(none)

### HIGH

1. [HIGH] `services/web-ui/src/lib/csrf.ts:13` -- The `__Host-` cookie prefix requires `Path=/` per RFC 6265bis section 4.1.3, but the implementation sets `Path=/setup`. Browsers conforming to the spec will silently reject setting the `__Host-csrf` cookie in production (HTTPS), causing CSRF protection to fail silently. This means forms would submit without any CSRF check since the cookie would never be set, and `validateCsrfToken` would receive `undefined` for the cookie value and return `false`, resulting in all POST requests being rejected with 403 -- a complete denial of service for the onboarding flow over HTTPS. -- **Fix:** Change `Path=/setup` to `Path=/` on line 13 of `csrf.ts` when using the `__Host-` prefix. Update the corresponding test assertions in `services/web-ui/src/lib/__tests__/csrf.test.ts:45`. Alternatively, avoid the `__Host-` prefix entirely and use a regular `csrf` cookie name with `Secure; SameSite=Strict; Path=/setup`.

### MEDIUM

1. [MEDIUM] `services/web-ui/src/middleware.ts:45` -- TypeScript compile error: `request.headers.get("origin")` returns `string | null`, but `validateOrigin` in `csrf.ts:38` accepts `string | undefined`. Running `tsc --noEmit` fails with TS2345. While this does not cause a runtime bug (null and undefined are both falsy and handled identically by the function), it is a type soundness issue that `astro check` or stricter CI would catch. -- **Fix:** Change the `validateOrigin` parameter type from `string | undefined` to `string | null | undefined` at `services/web-ui/src/lib/csrf.ts:38`. Alternatively, use `origin ?? undefined` at the call site in middleware.ts line 45.

### LOW

1. [LOW] `services/user-management/src/db/schema.ts` -- The plan specified an `hmac_signature TEXT NOT NULL` column in the `setup_tokens` table, but the implementation omits it entirely, recomputing the HMAC from stored fields + secret on each validation. This is actually a better design (avoids storing the signature, reducing exposure in case of DB breach), but it is a plan deviation that should be documented. -- **Fix:** Already documented in the impl-summary under plan deviations. No action needed.

2. [LOW] `services/user-management/src/setup-token/repository.ts:147` -- The `consumeToken` function compares `token.expiresAt <= new Date()` using JavaScript Date comparison. In the database query on line 169, it uses `gt(setupTokens.expiresAt, sql now())`. There is a potential clock skew between the application-level check and the database-level check if the application server and database server clocks differ. In practice, for a single-host Docker Compose deployment this is negligible. -- **Fix:** For consistency, rely solely on the database-level `now()` check by removing the application-level expiry check and letting the atomic UPDATE handle it (the function already falls through to the race_condition case if the DB check disagrees).

3. [LOW] `services/user-management/src/app.ts:40` -- The `c.req.json()` call on line 40 can throw if the request body is not valid JSON, resulting in an unhandled 500 error. Consider wrapping in try/catch and returning a 400 error. The same applies to line 168 in the consume endpoint. -- **Fix:** Wrap `await c.req.json()` in a try/catch block returning `c.json({ error: "Invalid request body" }, 400)` on parse failure.

4. [LOW] `services/web-ui/src/pages/setup/submit.ts:40` -- The error response on line 40 forwards `error.error` from the upstream response, which could potentially leak internal error details to the end user. -- **Fix:** Use a generic error message instead of forwarding the upstream error detail.

5. [LOW] `services/web-ui/src/lib/user-management-client.ts:8-9` -- No timeout on the internal HTTP calls to user-management. Per the reliability rules, service-to-service calls should have timeout handling to prevent cascading failures. -- **Fix:** Consider adding an `AbortSignal.timeout()` to the `client.fetch` calls in the Astro pages, or address this at the `createServiceClient` level in the auth package in a follow-up task.

## Plan Compliance

The implementation follows the approved plan closely with the following deviations:

1. **hmac_signature column omitted** -- The plan included an `hmac_signature` column in the `setup_tokens` table. The implementation recomputes the HMAC from stored fields on each validation instead. This is a valid and arguably more secure design choice. Documented in impl-summary.

2. **App routing pattern** -- Used inline middleware per route instead of sub-routers due to Hono routing conflicts. Acceptable deviation, documented.

3. **Integration tests use inline SQL** -- Instead of drizzle-kit push, tests create schema directly. Pragmatic deviation for test isolation.

4. **ConsumeSetupTokenRequest.sig field** -- Added sig field to carry the HMAC signature through the form submission. Aligns with the plan intent.

5. **Smoke tests deferred** -- Documented as manual verification step.

All deviations are justified and documented.

## Verdict Rationale

**REJECTED** due to one HIGH finding:

The `__Host-` cookie prefix with `Path=/setup` violates RFC 6265bis requirements. In production (HTTPS), browsers will silently reject the CSRF cookie, causing all POST requests to `/setup/*` to be rejected with 403 -- a complete denial of service for the onboarding flow over HTTPS.

The fix is straightforward: change `Path=/setup` to `Path=/` in the `buildCsrfCookieHeader` function and update the corresponding test. Alternatively, avoid the `__Host-` prefix entirely and use a regular `csrf` cookie name with `Secure; SameSite=Strict; Path=/setup`.

After fixing the HIGH finding and the MEDIUM type error, the implementation would be ready for approval. The test coverage is thorough (161 tests covering crypto, repository, HTTP endpoints, CSRF utilities, and config parsing), the security architecture is sound (per-endpoint caller allowlists, HMAC timing-safe comparison, atomic consumption, one-active-per-user enforcement), service boundaries are properly respected (user-management owns tokens, telegram-bridge only issues/cancels, web-ui only validates/consumes), and the code quality is high.
