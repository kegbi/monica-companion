---
verdict: APPROVED
attempt: 1
biome_pass: true
tests_pass: true
test_summary: "types: 179 passed; user-management: 48 passed, 83 skipped (integration, require PG); web-ui: 26 passed"
critical_count: 0
high_count: 0
medium_count: 2
---

# Code Review: Web-UI Onboarding Form Completion

## Automated Checks
- **Biome**: PASS -- zero errors on all changed files (4 pre-existing errors in unrelated `packages/guardrails` and `.claude/settings.local.json`)
- **Tests**:
  - `packages/types`: 179 passed across 11 files
  - `services/user-management`: 48 passed, 83 skipped (integration tests require PostgreSQL -- same as baseline)
  - `services/web-ui`: 26 passed across 2 files
  - 3 test files in `user-management` report as "failed" because `beforeAll`/`afterAll` hooks cannot connect to PostgreSQL; this is a **pre-existing condition** (verified by testing the baseline commit). All actual test cases are properly skipped.

## Findings

### CRITICAL
(none)

### HIGH
(none)

### MEDIUM

1. [MEDIUM] `services/user-management/src/app.ts:240` -- When falling back to sig-only mode, the validated `basicParsed.data.sig` is not used; instead the code casts raw `body` with `(body as { sig: string }).sig`. The `basicParsed` variable is scoped inside the `if (!hasOnboarding)` block and discarded. While functionally safe (the parse succeeded so `sig` exists), this discards validated data in favor of an unsafe type assertion. -- **Fix:** Hoist `basicParsed` or a `sig` variable outside the block so both branches use Zod-validated data. Example:

   ```typescript
   let sig: string;
   if (hasOnboarding) {
       sig = onboardingParsed.data.sig;
   } else {
       const basicParsed = ConsumeSetupTokenRequest.safeParse(body);
       if (!basicParsed.success) return c.json({ error: "Invalid request body" }, 400);
       sig = basicParsed.data.sig;
   }
   ```

2. [MEDIUM] `services/user-management/src/app.ts:293-298` -- Inside the transaction, `consumeToken` is called with `db` as the first argument and `tx` as the third, but the `db` parameter is only used as a fallback when `tx` is not provided. This works correctly because `tx` is passed, but it is confusing: the function signature suggests `db` will be used, when actually `tx` is used. -- **Fix:** Consider passing `tx` as both arguments to make the intent explicit, or refactor `consumeToken` to accept only a `DbOrTx` parameter. Current code is functionally correct but could mislead future maintainers.

### LOW

1. [LOW] `packages/types/src/setup-token.ts:56` -- The `reminderTime` regex `/^\d{2}:\d{2}$/` allows syntactically invalid times like `99:99` or `25:61`. -- **Fix:** Use a stricter regex like `/^([01]\d|2[0-3]):[0-5]\d$/` to validate actual HH:MM ranges (00:00-23:59).

2. [LOW] `services/web-ui/src/pages/setup/submit.ts:59` -- Returning `parsed.error.issues` to the client exposes Zod validation details. While Zod v4 typically does not include raw input values in issue messages, future schema changes could inadvertently leak sensitive fields. -- **Fix:** Map issues to field-level error messages before returning, or return only field names and generic messages.

3. [LOW] Smoke tests deferred -- The plan called for Docker Compose smoke tests through Caddy. These were deferred due to port 5432 being unavailable on the Windows host. The implementation summary correctly documents this as a residual risk. -- **Fix:** Run smoke tests before marking the roadmap item complete, per project rules.

4. [LOW] `services/web-ui/src/pages/setup/[tokenId].astro:167` -- The client-side script uses `Intl.supportedValuesOf("timeZone")` which is not available in all browsers (unsupported in IE, partial in older Safari). For V1 this is acceptable since the server-side validation is the authoritative check. -- **Fix:** Add a fallback or feature detection for older browsers in a future iteration.

## Plan Compliance

The implementation closely follows the approved plan:

1. **Schema extension** (Step 1): `OnboardingFields` and `ConsumeSetupTokenWithOnboardingRequest` added exactly as specified.
2. **Form fields** (Step 2): All seven fields implemented with correct types, defaults, and help text.
3. **Submit handler** (Step 3): Extracts, validates with Zod, forwards to user-management, redirects correctly.
4. **Success/error pages** (Step 4): Created with allowlist-based reason codes (addressing plan review MEDIUM #3).
5. **User-management endpoint** (Step 5): Transaction wrapping, timezone/URL validation, `createOrUpdateUserFromOnboarding` upsert all implemented.
6. **Tests** (Step 6): Schema tests, repository integration tests, app integration tests, and submit handler tests all present.

**Plan review findings addressed:**
- MEDIUM #1 (connectorRoutingId): Derived from `token.telegramUserId` at line 322.
- MEDIUM #2 (transaction wrapping): `consumeToken` refactored with optional `tx` parameter.
- MEDIUM #3 (error page allowlist): Strict `reasonMessages` map in `error.astro`, never renders raw params.
- MEDIUM #4 (URL validation simplicity): Only HTTPS check + `normalizeMonicaUrl` syntactic normalization. No `ALLOW_PRIVATE_NETWORK_TARGETS` added (intentional, documented).

**Justified deviations:**
- Smoke tests deferred (documented in impl-summary with rationale).
- `ALLOW_PRIVATE_NETWORK_TARGETS` config not added (per plan review finding #4).
- Roadmap updated to mark Telegram /start Command Handler complete (from prior task, included in same commit range).

## Verdict Rationale

APPROVED. All automated checks pass on changed files (Biome: zero errors; tests: all pass or are pre-existing integration skips). No CRITICAL or HIGH findings. The two MEDIUM findings are code quality improvements that do not affect correctness or security -- the type assertion at line 240 is functionally safe (Zod parse succeeded), and the `consumeToken` call pattern at line 293 works correctly because the `tx` parameter takes precedence. Security is properly handled: XSS prevention via allowlist on error page, CSRF token validation via middleware, API key encrypted at rest with AES-256-GCM, HTTPS enforcement on Monica URLs, server-side timezone validation, and service-to-service JWT auth on all internal calls.
