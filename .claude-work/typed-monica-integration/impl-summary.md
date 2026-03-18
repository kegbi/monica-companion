# Implementation Summary: Typed Monica Integration

## Files Changed

| File | Action | Description |
|------|--------|-------------|
| `packages/monica-api-lib/src/errors.ts` | created | MonicaApiError, MonicaNetworkError, MonicaPaginationCapError classes |
| `packages/monica-api-lib/src/transport.ts` | created | withTimeout and withRetry utilities with exponential backoff |
| `packages/monica-api-lib/src/pagination.ts` | created | paginateAll generic helper with safety cap |
| `packages/monica-api-lib/src/client.ts` | created | MonicaApiClient class with all read/write operations |
| `packages/monica-api-lib/src/logger-interface.ts` | created | StructuredLogger interface (compatible with observability package) |
| `packages/monica-api-lib/src/index.ts` | modified | Added exports for client, errors, transport, pagination, logger |
| `packages/monica-api-lib/package.json` | modified | Added __fixtures__ export path for cross-package test fixtures |
| `packages/monica-api-lib/tsconfig.json` | modified | Added DOM lib for URLSearchParams/Response/RequestInit types |
| `services/monica-integration/package.json` | modified | Added dependencies on auth, monica-api-lib, redaction, types, zod |
| `services/monica-integration/src/config.ts` | created | Zod-validated config with port, auth, timeout, retry settings |
| `services/monica-integration/src/app.ts` | modified | Full Hono app with health, internal routes, bodyLimit, error handler |
| `services/monica-integration/src/index.ts` | modified | Updated to load config and pass to createApp |
| `services/monica-integration/src/lib/credential-client.ts` | created | fetchMonicaCredentials with Zod validation and error handling |
| `services/monica-integration/src/lib/contact-projection.ts` | created | buildContactResolutionSummary/Summaries projection builder |
| `services/monica-integration/src/lib/require-user-id.ts` | created | requireUserId guard (MEDIUM finding #1) |
| `services/monica-integration/src/routes/read.ts` | created | Read-only endpoints (resolution-summaries, contact, notes, reminders) |
| `services/monica-integration/src/routes/write.ts` | created | Write endpoints (create/update contact, notes, activities, etc.) |
| `services/monica-integration/src/routes/reference.ts` | created | Reference data endpoints (genders, contact-field-types) |
| `services/monica-integration/src/routes/shared.ts` | created | createMonicaClient factory (credential resolution + client creation) |
| `services/user-management/src/app.ts` | modified | Added stub credential endpoint gated behind NODE_ENV !== production |
| `docker-compose.yml` | modified | Added JWT_SECRET, USER_MANAGEMENT_URL, timeout/retry env vars to monica-integration |
| `.env.example` | modified | Added MONICA_DEFAULT_TIMEOUT_MS and MONICA_RETRY_MAX documentation |

## Tests Added

| Test File | What It Tests |
|-----------|---------------|
| `packages/monica-api-lib/src/__tests__/errors.test.ts` | MonicaApiError parsing (404, 422, 5xx retryable, non-JSON body), MonicaNetworkError, MonicaPaginationCapError |
| `packages/monica-api-lib/src/__tests__/transport.test.ts` | withTimeout abort, withRetry on 500/404/429/network errors, exponential backoff, Retry-After header |
| `packages/monica-api-lib/src/__tests__/pagination.test.ts` | Single/multi-page pagination, cap enforcement, empty results, custom maxPages |
| `packages/monica-api-lib/src/__tests__/client.test.ts` | All client read/write methods: URL construction, auth header, response validation, error handling, base URL normalization |
| `services/monica-integration/src/__tests__/config.test.ts` | Config validation, defaults, missing required fields |
| `services/monica-integration/src/__tests__/credential-client.test.ts` | Credential fetch, error handling, response validation |
| `services/monica-integration/src/__tests__/contact-projection.test.ts` | Projection builder: full contact, minimal contact, partial contact, deduplication, year-unknown dates, schema validation |
| `services/monica-integration/src/__tests__/app.test.ts` | All 11 endpoints: auth enforcement, caller allowlists, requireUserId guard, request validation, response shape |
| `services/monica-integration/src/__tests__/observability.test.ts` | Redaction of Bearer tokens, logger attributes (method/path/status/duration), no response body in logs |

## Verification Results

- **Biome**: `pnpm biome check` -- 0 errors, 0 warnings across 58 files
- **Tests**:
  - `@monica-companion/monica-api-lib`: 5 test files, **95 tests passed**
  - `@monica-companion/monica-integration`: 5 test files, **43 tests passed**
  - `@monica-companion/auth`: 5 test files, 55 tests passed (no regressions)
  - `@monica-companion/types`: 1 test file, 9 tests passed (no regressions)
  - `@monica-companion/redaction`: 1 test file, 40 tests passed (no regressions)
- **Build**: `pnpm --filter @monica-companion/monica-api-lib build` -- ESM + DTS success

## Plan Deviations

1. **Route grouping (LOW finding #3)**: Instead of 8 separate route files, routes are grouped into 3 files by access pattern: `read.ts`, `write.ts`, `reference.ts`, plus a shared `shared.ts` utility for client creation.

2. **Shared module mock approach in app tests**: Instead of mocking `@monica-companion/monica-api-lib` at the vitest module level (which caused issues with partial mocking of MonicaApiError), the app test mocks `routes/shared.ts` which is the single point where MonicaApiClient instances are created. This is a cleaner mock boundary.

3. **tsconfig.json DOM lib**: Added `"lib": ["ES2022", "DOM"]` to `packages/monica-api-lib/tsconfig.json` to support `URLSearchParams`, `Response`, `RequestInit`, `AbortController` types needed by the HTTP client. This is necessary because the base tsconfig only includes `ES2022`.

4. **user-management depends_on condition**: Used `condition: service_started` instead of `condition: service_healthy` for the `user-management` dependency in docker-compose, since `user-management` does not define a healthcheck.

5. **FetchFn type alias**: Used a local `FetchFn` type alias in client.ts instead of `typeof globalThis.fetch` for the instance field type, to avoid TypeScript DTS build issues with `globalThis` type resolution.

## Residual Risks

1. **user-management credential endpoint is a stub**: The stub in `services/user-management/src/app.ts` returns env vars and is gated behind `NODE_ENV !== "production"`. It must be replaced by real encrypted credential resolution in the "Least-Privilege User Management" task.

2. **No SSRF protection on Monica base URLs**: Base URLs from credentials are passed through without validation. The "Safe Multi-Instance Support" task will add URL normalization and blocked-target rejection.

3. **Monica API rate limiting (60 req/min)**: `getAllContacts` for users with many contacts makes multiple paginated requests. Concurrent users could exhaust the rate limit. The retry logic handles 429 with Retry-After, but a caching layer may be needed for production scale.

4. **Docker Compose smoke test not executed**: The plan calls for smoke tests against the live stack. These were not run because they require `docker compose up` with infrastructure services. The smoke test instructions from the plan remain valid for manual execution.
