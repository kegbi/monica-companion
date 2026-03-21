# Implementation Summary: Web-UI Onboarding Form Completion

## Files Changed
| File | Action | Description |
|------|--------|-------------|
| `packages/types/src/setup-token.ts` | modified | Added `OnboardingFields` Zod schema and `ConsumeSetupTokenWithOnboardingRequest` merged schema |
| `packages/types/src/index.ts` | modified | Added exports for `OnboardingFields` and `ConsumeSetupTokenWithOnboardingRequest` |
| `packages/types/src/__tests__/setup-token.test.ts` | created | Schema validation tests for new types |
| `services/user-management/package.json` | modified | Added `@monica-companion/monica-api-lib` dependency |
| `services/user-management/src/user/repository.ts` | modified | Added `DbOrTx` type, `OnboardingUserParams` interface, and `createOrUpdateUserFromOnboarding` function with upsert logic |
| `services/user-management/src/setup-token/repository.ts` | modified | Refactored `consumeToken` to accept optional `tx` parameter; `ConsumeResult` now includes `telegramUserId`; extracted `consumeTokenInner` for transaction composition |
| `services/user-management/src/app.ts` | modified | Updated consume endpoint to parse `ConsumeSetupTokenWithOnboardingRequest`, validate timezone and HTTPS URL, wrap token consumption + user creation in transaction, maintain backward compat for sig-only |
| `services/user-management/src/__tests__/app.test.ts` | modified | Added 5 new tests for consume-with-onboarding (creates user, invalid timezone, http URL, re-setup upsert, backward compat) |
| `services/user-management/src/user/__tests__/repository.integration.test.ts` | modified | Added 3 new tests for `createOrUpdateUserFromOnboarding` (new user, upsert, custom connector type) |
| `services/web-ui/src/pages/setup/submit.ts` | modified | Complete rewrite to extract all onboarding fields, validate with Zod schema, forward to user-management, redirect to success/error pages |
| `services/web-ui/src/pages/setup/__tests__/submit.test.ts` | created | 8 tests for submit handler (missing fields, validation, forwarding, redirects, defaults, error handling) |
| `services/web-ui/src/pages/setup/[tokenId].astro` | modified | Full onboarding form with Monica URL, API key, language, confirmation mode, timezone selector (auto-detected), reminder cadence, reminder time; client-side HTTPS validation |
| `services/web-ui/src/pages/setup/success.astro` | created | Success page directing user back to Telegram |
| `services/web-ui/src/pages/setup/error.astro` | created | Error page with allowlist-based reason code mapping (never renders raw query params) |

## Tests Added
| Test File | What It Tests |
|-----------|---------------|
| `packages/types/src/__tests__/setup-token.test.ts` | OnboardingFields schema validation (valid payload, defaults, missing/invalid fields); ConsumeSetupTokenWithOnboardingRequest (merged schema, backward compat) |
| `services/user-management/src/user/__tests__/repository.integration.test.ts` | createOrUpdateUserFromOnboarding: new user creation with encrypted credentials and preferences, upsert on re-setup, custom connector type |
| `services/user-management/src/__tests__/app.test.ts` | Consume-with-onboarding endpoint: creates user with onboarding data, rejects invalid timezone, rejects http:// URL, handles re-setup upsert, backward compat with sig-only |
| `services/web-ui/src/pages/setup/__tests__/submit.test.ts` | Submit handler: missing fields 400, missing URL 400, empty API key 400, forwards onboarding fields, redirects to success, redirects to error on failure, network error handling, default values |

## Verification Results
- **Biome**: `pnpm biome check` - 0 errors, all files clean
- **Tests**:
  - `packages/types`: 11 files, 179 tests passed
  - `services/user-management`: 8 files, 131 tests passed
  - `services/web-ui`: 2 files, 26 tests passed

## Plan Review Findings Addressed
1. **MEDIUM - connectorRoutingId**: Derived from consumed token's `telegramUserId`. `connectorType` hardcoded to `"telegram"`.
2. **MEDIUM - Transaction wrapping**: `consumeToken` refactored to accept optional `tx` parameter. Inner logic extracted to `consumeTokenInner`. Existing callers unaffected (backward compatible).
3. **MEDIUM - Error page allowlist**: Error page uses a strict `reasonMessages` allowlist map. Unknown reason codes fall through to a generic message. Raw `reason` param is never rendered.
4. **MEDIUM - URL validation simplicity**: Only syntactic normalization + HTTPS protocol check at onboarding. No `ALLOW_PRIVATE_NETWORK_TARGETS` config added to user-management. Full SSRF/DNS validation remains in `monica-integration`.
5. **LOW - normalizeMonicaUrl appends /api**: Form placeholder shows `https://app.monicahq.com` (base URL without /api). Field help text says "without /api".
6. **LOW - Smoke test**: Not added in this implementation round (requires Docker Compose stack; port 5432 was blocked on this Windows environment).

## Plan Deviations
- **Smoke tests deferred**: Port 5432 was blocked by Windows/Hyper-V on this machine, preventing Docker Compose stack startup. Integration tests against a standalone PostgreSQL container on port 15432 were used instead. Smoke tests should be added when the full stack is available.
- **`ALLOW_PRIVATE_NETWORK_TARGETS` not added**: Per plan review finding #4, this was intentionally omitted. Only HTTPS check + `normalizeMonicaUrl()` syntactic normalization is done at onboarding time.

## Residual Risks
1. **Smoke tests**: Docker Compose smoke tests through Caddy have not been run due to port 5432 being unavailable. Should be verified before marking the roadmap item complete.
2. **Types package rebuild**: The `@monica-companion/types` package must be rebuilt (`pnpm build`) before downstream services can use the new exports at runtime. Tests use direct source imports via vitest, but production Docker builds depend on the compiled `dist/`.
3. **Timezone list in Docker**: The `Intl.supportedValuesOf('timeZone')` validation depends on full ICU data being available in the Node.js Docker image. This should be verified in smoke tests.
4. **"UTC" not in Intl.supportedValuesOf**: "UTC" is not recognized as a valid IANA timezone by `Intl.supportedValuesOf('timeZone')`. Users must select a geographic timezone like "Etc/UTC" or "Europe/London". This is consistent with IANA timezone standards.
