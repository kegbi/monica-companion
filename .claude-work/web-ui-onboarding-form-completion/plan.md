# Implementation Plan: Web-UI Onboarding Form Completion

## Objective

Complete the web-based onboarding form so that a new user who clicks a setup link from Telegram can enter their Monica credentials and preferences, have those stored securely in user-management, and receive a success page directing them back to Telegram.

## Scope

### In Scope

- Add all onboarding form fields to `[tokenId].astro` (Monica base URL, Monica API key, preferred language, confirmation mode, IANA timezone selector, reminder cadence, reminder time).
- Extend `ConsumeSetupTokenRequest` Zod schema in `@monica-companion/types` to carry all onboarding fields alongside `sig`.
- Update `web-ui` form submission handler (`submit.ts`) to extract, validate, and forward all fields to `user-management`.
- Update the `user-management` consume endpoint to create/update the `users` row with encrypted Monica credentials and populate the `user_preferences` row.
- Add client-side validation (HTTPS URL, valid IANA timezone, non-empty API key).
- Add success page (`/setup/success.astro`) and error page (`/setup/error.astro`).
- Unit tests for schema validation, repository logic, and submit handler.
- Integration tests for the user-management consume endpoint with onboarding data.
- Smoke tests through Caddy.

### Out of Scope

- Full SSRF/DNS validation of Monica URLs at onboarding time (that is `monica-integration`'s responsibility).
- Re-setup / settings update flow (future work).
- Styling or CSS framework decisions (minimal functional HTML is sufficient for V1).
- Monica API key verification against the Monica instance.

## Affected Services & Packages

| Package/Service | Changes |
|-----------------|---------|
| `packages/types` | Extend `ConsumeSetupTokenRequest` schema with onboarding fields; add `OnboardingFields` schema |
| `services/web-ui` | Full form in `[tokenId].astro`; update `submit.ts`; add `success.astro` and `error.astro` |
| `services/user-management` | Update consume endpoint; add `createOrUpdateUserFromOnboarding` repository function; add `@monica-companion/monica-api-lib` dependency |
| `packages/monica-api-lib` | No changes (already exports `normalizeMonicaUrl`) |
| `tests/smoke` | Add onboarding form smoke test |

## Implementation Steps

### Step 1: Extend `ConsumeSetupTokenRequest` Zod schema in `@monica-companion/types`

**Files:** `packages/types/src/setup-token.ts`, `packages/types/src/index.ts`

Define `OnboardingFields` Zod schema:
- `monicaBaseUrl` — `z.string().url()`
- `monicaApiKey` — `z.string().min(1)`
- `language` — `z.string().min(2).max(10).default("en")`
- `confirmationMode` — `z.enum(["explicit", "auto"]).default("explicit")`
- `timezone` — `z.string().min(1)`
- `reminderCadence` — `z.enum(["daily", "weekly", "none"]).default("daily")`
- `reminderTime` — `z.string().regex(/^\d{2}:\d{2}$/)` default `"08:00"`

Create `ConsumeSetupTokenWithOnboardingRequest` = `ConsumeSetupTokenRequest.merge(OnboardingFields)`. Keep original schema unchanged.

### Step 2: Add form fields to `[tokenId].astro`

**File:** `services/web-ui/src/pages/setup/[tokenId].astro`

Replace placeholder with actual form fields:
1. Monica Base URL (`type="url"`, required, placeholder `https://app.monicahq.com`)
2. Monica API Key (`type="password"`, required)
3. Preferred Language (`<select>`, default `en`)
4. Confirmation Mode (`<select>`: explicit/auto, default explicit)
5. IANA Timezone (`<select>`, pre-selected via `Intl.DateTimeFormat().resolvedOptions().timeZone`)
6. Reminder Cadence (`<select>`: daily/weekly/none, default daily)
7. Reminder Time (`type="time"`, default `08:00`)

Add inline `<script>` for timezone auto-detection and client-side validation.

### Step 3: Update `submit.ts` to extract and forward all onboarding fields

**File:** `services/web-ui/src/pages/setup/submit.ts`

1. Import `ConsumeSetupTokenWithOnboardingRequest`.
2. Extract all fields from form data.
3. Validate with `.safeParse()`. On failure, return 400.
4. Forward to `user-management` `POST /internal/setup-tokens/${tokenId}/consume`.
5. On success, redirect to `/setup/success` (HTTP 303).
6. On failure, redirect to `/setup/error?reason=...`.

### Step 4: Add success and error pages

**Files:** `services/web-ui/src/pages/setup/success.astro`, `services/web-ui/src/pages/setup/error.astro`

**success.astro:** "Setup Complete — Return to Telegram and send a message to start."
**error.astro:** Dynamic message based on `reason` query param (expired, already_consumed, validation_failed, generic).

### Step 5: Update `user-management` consume endpoint

**Files:**
- `services/user-management/src/app.ts`
- `services/user-management/src/user/repository.ts`
- `services/user-management/src/config.ts`
- `services/user-management/package.json`

**5a.** Add `@monica-companion/monica-api-lib` dependency.

**5b.** Update consume endpoint:
- Parse with `ConsumeSetupTokenWithOnboardingRequest`.
- After token consumption, call `createOrUpdateUserFromOnboarding`.
- Validate timezone server-side via `Intl.supportedValuesOf('timeZone')`.
- Validate Monica URL via `normalizeMonicaUrl()`, require HTTPS unless `ALLOW_PRIVATE_NETWORK_TARGETS`.
- Wrap token consumption + user creation in a single transaction.

**5c.** Add `createOrUpdateUserFromOnboarding` repository function:
- Upsert `users` row (conflict on `telegram_user_id`).
- Upsert `user_preferences` row (conflict on `user_id`).
- Encrypt API key via `encryptCredential()`.

**5d.** Add `ALLOW_PRIVATE_NETWORK_TARGETS` config.

### Step 6: Write tests (TDD)

**6a. Schema tests** (`packages/types/src/__tests__/setup-token.test.ts`):
- Accepts valid full payload, rejects missing/invalid fields, applies defaults.

**6b. Repository integration tests** (extend `services/user-management/src/user/__tests__/repository.integration.test.ts`):
- Creates user with encrypted credentials, creates preferences, upsert behavior.

**6c. App integration tests** (extend `services/user-management/src/__tests__/app.test.ts`):
- Consume with onboarding data, invalid URL/timezone/key returns 400, re-setup upsert.

**6d. Submit handler tests** (`services/web-ui/src/pages/setup/__tests__/submit.test.ts`):
- Missing fields, invalid URL, forwarding, redirect behavior.

### TDD Sequence

1. Schema tests (6a) → implement schema (Step 1)
2. Repository tests (6b) → implement repository (Step 5c)
3. App tests (6c) → implement endpoint (Step 5b)
4. Submit handler tests (6d) → implement handler (Step 3)
5. Implement form UI (Step 2) and pages (Step 4) — tested via smoke tests

## Smoke Test Strategy

### Services to start
```bash
docker compose --profile app up -d caddy web-ui user-management postgres
```

### HTTP checks
1. **Form loads:** GET `/setup/{tokenId}?sig={sig}` through Caddy → 200, HTML contains all field names.
2. **Form submission creates user:** POST `/setup/submit` through Caddy → 303 redirect to `/setup/success`.
3. **Success page:** GET `/setup/success` → 200, contains "Return to Telegram".
4. **Error page:** GET `/setup/error?reason=expired` → 200, contains "expired".
5. **Invalid submission rejected:** POST with `http://` Monica URL → error redirect.

## Security Considerations

1. **API key handling:** Transmitted over HTTPS, encrypted with AES-256-GCM before storage, shown as password field.
2. **CSRF protection:** Existing middleware validates CSRF tokens on POST. No changes needed.
3. **Origin validation:** Existing middleware. No changes needed.
4. **Monica URL validation:** Syntactic HTTPS validation + normalization. Full SSRF is `monica-integration`'s concern.
5. **Timezone validation:** Server-side `Intl.supportedValuesOf('timeZone')` rejects arbitrary strings.
6. **No sensitive data in URLs/logs:** API key in POST body only.
7. **Transaction atomicity:** Token consumption + user creation in single transaction.
8. **Service-to-service auth:** Existing `webUiAuth` middleware. No changes needed.

## Risks

1. **Timezone list completeness:** Docker node:slim should include full ICU data. Verify in smoke test.
2. **Re-setup flow:** Upsert handles `disconnectUser` revoked rows. Needs careful testing.
3. **Transaction scope:** `consumeToken` needs transaction parameter refactoring.
4. **Backward compatibility:** Separate `ConsumeSetupTokenWithOnboardingRequest` schema avoids breaking existing tests.
5. **`normalizeMonicaUrl` dependency:** Pure validation utility, no HTTP calls — acceptable cross-boundary dependency.
