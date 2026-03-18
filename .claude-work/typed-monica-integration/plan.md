# Implementation Plan: Typed Monica Integration

## Objective

Build the `@monica-companion/monica-api-lib` HTTP client and the `monica-integration` Hono service so that all Monica v4 API communication flows through a single, typed, resilient anti-corruption layer. This task group delivers:

1. A typed HTTP client in `@monica-companion/monica-api-lib` that wraps every V1 Monica endpoint with Zod-validated requests and responses, transport-level timeouts, capped quick retries, safe pagination, and Monica-specific error mapping.
2. The `monica-integration` Hono service with internal HTTP endpoints that other services call (read-only contact-resolution for `ai-router`, write/execution endpoints for `scheduler`), protected by service auth with per-endpoint caller allowlists.
3. The `ContactResolutionSummary` projection builder that transforms raw Monica contacts into the Monica-agnostic shape consumed by `ai-router`.

This unblocks Phase 2 completion (Safe Multi-Instance Support, Least-Privilege User Management, Testing Strategy Split) and Phase 3 (Contact Resolution Boundary, Command Contract).

## Scope

### In Scope

- HTTP client class in `@monica-companion/monica-api-lib` covering all V1 Monica endpoints (contacts, notes, activities, reminders, contact fields, addresses, genders, contact field types, upcoming reminders).
- Transport-level timeout handling (configurable per-request, default 10s).
- Capped quick retries (max 2 retries, only on network errors and 5xx/429, with exponential backoff and jitter, respecting `Retry-After` header for 429).
- Safe pagination helper that iterates through all pages of a list endpoint.
- Monica-specific error mapping to a uniform `MonicaApiError` class with structured error codes.
- `monica-integration` service endpoints:
  - `GET /internal/contacts/resolution-summaries` (caller: `ai-router`) -- returns the full contact resolution projection list.
  - `POST /internal/contacts` (caller: `scheduler`) -- create contact.
  - `POST /internal/contacts/:contactId/notes` (caller: `scheduler`) -- create note.
  - `POST /internal/activities` (caller: `scheduler`) -- create activity.
  - `PUT /internal/contacts/:contactId` (caller: `scheduler`) -- update contact.
  - `POST /internal/contacts/:contactId/contact-fields` (caller: `scheduler`) -- create contact field.
  - `POST /internal/contacts/:contactId/addresses` (caller: `scheduler`) -- create address.
  - `GET /internal/contacts/:contactId` (caller: `ai-router`, `scheduler`) -- get single contact details (Monica-agnostic projection).
  - `GET /internal/contacts/:contactId/notes` (caller: `ai-router`) -- get recent notes for a contact.
  - `GET /internal/reminders/upcoming` (caller: `scheduler`) -- get upcoming reminders for digest.
  - `GET /internal/genders` (caller: `scheduler`) -- get genders (needed for contact creation).
  - `GET /internal/contact-field-types` (caller: `scheduler`) -- get contact field types (needed for phone/email creation).
- Config with Zod validation for the service (port, JWT secrets, user-management URL).
- Service auth middleware using `@monica-companion/auth` with per-endpoint caller allowlists.
- Credential resolution: `monica-integration` calls `user-management` to get decrypted Monica credentials for a given user.
- Redaction of Monica API tokens and URLs from logs.
- Observability: correlation ID propagation, structured logging, OTel instrumentation.

### Out of Scope

- Monica base URL normalization, SSRF protection, and blocked-target rejection (that is the "Safe Multi-Instance Support" roadmap item).
- Encrypted credential storage in `user-management` (that is "Least-Privilege User Management").
- Controlled real-Monica smoke suite (that is "Testing Strategy Split").
- Contact resolution logic, ranking, disambiguation (that is Phase 3 "Contact Resolution Boundary").
- The `user-management` credential endpoint implementation (this plan assumes a stub or mock for that endpoint; the real implementation is in "Least-Privilege User Management").

## Affected Services & Packages

| Package/Service | Changes |
|-----------------|---------|
| `packages/monica-api-lib` | Add HTTP client class, pagination helper, retry logic, error types, timeout handling. Export from index.ts. |
| `services/monica-integration` | Add config, service auth, internal API routes, credential fetching, projection builder, all dependencies. |
| `packages/types` | (No changes -- `ContactResolutionSummary` already exists.) |
| `docker-compose.yml` | Add `JWT_SECRET`, `JWT_SECRET_PREVIOUS`, `USER_MANAGEMENT_URL` env vars to `monica-integration` service. |
| `.env.example` | Add `MONICA_INTEGRATION_TIMEOUT_MS`, `MONICA_INTEGRATION_RETRY_MAX` (optional documentation). |

## Architecture Decisions

### Monica API Client Design

The client is a plain class `MonicaApiClient` in `@monica-companion/monica-api-lib`. It receives a `baseUrl`, `apiToken`, and optional config (timeout, retry settings). Each method maps 1:1 to a Monica endpoint, validates the request body with the corresponding Zod schema before sending, and validates the response body with the Zod response schema before returning. Validation failures on responses are treated as protocol errors (logged + thrown).

The client does NOT hold any user state or credential resolution logic. It is instantiated per-request by `monica-integration` after resolving the user's credentials from `user-management`.

### Retry Strategy

- Max 2 retries (3 total attempts).
- Retry only on: network/connection errors, HTTP 500, 502, 503, 504, 429.
- Base delay: 500ms, exponential factor 2, jitter up to 200ms.
- On 429: use `Retry-After` header if present, otherwise use the computed backoff.
- Never retry on 4xx (except 429), 401, 403, 404, 422.

### Pagination Strategy

A generic `paginateAll<T>` helper that:
1. Calls the endpoint with `?page=1&limit=100`.
2. Checks `meta.last_page` and iterates through remaining pages.
3. Validates each page response with the provided Zod schema.
4. Concatenates all `data` arrays.
5. Has a safety cap (configurable, default 50 pages = 5000 items) to prevent runaway fetches.

### Credential Resolution

`monica-integration` calls `user-management` via the `@monica-companion/auth` `ServiceClient` to fetch credentials for a given userId. In this task, we implement the client-side call. The `user-management` endpoint for credential resolution does not exist yet (it is part of "Least-Privilege User Management"). For now, the code will call a defined endpoint path (`GET /internal/users/:userId/monica-credentials`), and tests will mock this call. The smoke test will use a temporary stub endpoint on `user-management`.

### Internal API Shape

`monica-integration` endpoints return Monica-agnostic JSON. The response schemas are defined inline in the service using Zod. They never expose raw Monica payloads. For execution endpoints, the service accepts a Monica-agnostic command payload (e.g., `{ contactId, body }` for note creation), resolves it to Monica API calls internally, and returns a simplified result.

## Implementation Steps

### Step 1: Monica API Error Types

**What:** Create `packages/monica-api-lib/src/errors.ts` with a `MonicaApiError` class and error code enum.

**Files to create:**
- `packages/monica-api-lib/src/errors.ts`

**Details:**
- `MonicaApiError extends Error` with properties: `statusCode: number`, `monicaErrorCode: number | undefined`, `monicaMessages: string[]`, `isRetryable: boolean`.
- Factory function `fromResponse(response: Response, body: unknown): MonicaApiError` that parses the body against `ErrorResponse` schema if the status is not 2xx.
- Enum `MonicaErrorCode` for known error codes from the API (31 = not found, 32 = validation, etc.).
- `MonicaNetworkError extends Error` for connection/timeout failures.
- `MonicaPaginationCapError extends Error` for when pagination cap is exceeded.

**Test (TDD):**
- Write test first: `MonicaApiError.fromResponse` correctly parses a 404 error body with string message, a 422 body with array messages, and marks 5xx as retryable but 4xx as non-retryable.

**Expected outcome:** Error types ready for the client.

### Step 2: Retry and Timeout Utilities

**What:** Create `packages/monica-api-lib/src/transport.ts` with retry wrapper and timeout-aware fetch.

**Files to create:**
- `packages/monica-api-lib/src/transport.ts`

**Details:**
- `withTimeout(fetch: typeof globalThis.fetch, timeoutMs: number): typeof globalThis.fetch` -- wraps fetch with AbortController timeout. On timeout, throws `MonicaNetworkError` with a descriptive message.
- `withRetry(fn: () => Promise<Response>, options: RetryOptions): Promise<Response>` -- retry wrapper. Options: `maxRetries` (default 2), `baseDelayMs` (default 500), `maxDelayMs` (default 5000). Checks if the error/response is retryable. On 429, reads `Retry-After` header. Adds jitter.
- `RetryOptions` type.
- Pure functions, no side effects except the fetch call. Logging hook via callback.

**Test (TDD):**
- `withTimeout` aborts after configured timeout.
- `withRetry` retries on 500, stops after max retries.
- `withRetry` does not retry on 404.
- `withRetry` respects Retry-After header on 429.
- `withRetry` applies exponential backoff with jitter (verify delay ranges).

**Expected outcome:** Transport resilience utilities fully tested.

### Step 3: Pagination Helper

**What:** Create `packages/monica-api-lib/src/pagination.ts` with generic pagination function.

**Files to create:**
- `packages/monica-api-lib/src/pagination.ts`

**Details:**
- `paginateAll<T>(fetchPage: (page: number) => Promise<PaginatedResponseType<T>>, options?: { maxPages?: number }): Promise<T[]>` -- fetches all pages, concatenates data arrays.
- Default `maxPages` = 50.
- Throws `MonicaPaginationCapError` if `meta.last_page` exceeds `maxPages`.
- Each page callback is responsible for the actual fetch + validation (the client methods will provide this).

**Test (TDD):**
- Single page returns data directly.
- Multi-page fetches all pages in order.
- Throws when page count exceeds cap.
- Handles empty results (total = 0).

**Expected outcome:** Safe pagination ready.

### Step 4: Monica API Client -- Read Operations

**What:** Create `packages/monica-api-lib/src/client.ts` with the `MonicaApiClient` class implementing read-only methods first.

**Files to create:**
- `packages/monica-api-lib/src/client.ts`

**Details:**
- Constructor: `{ baseUrl: string, apiToken: string, fetch?: typeof globalThis.fetch, timeoutMs?: number, retryOptions?: Partial<RetryOptions>, logger?: (msg: string, attrs?: Record<string, unknown>) => void }`.
- The constructor normalizes the base URL (strip trailing slash, ensure `/api` suffix).
- Internal `request(method, path, body?)` method that:
  1. Builds URL.
  2. Sets `Authorization: Bearer <token>` and `Content-Type: application/json`.
  3. Uses `withTimeout` and `withRetry`.
  4. Returns the raw `Response`.
- Read methods (each validates response with Zod, returns typed data):
  - `listContacts(options?: { page?, limit?, sort?, query? }): Promise<PaginatedResponse<FullContact>>` -- `GET /api/contacts`.
  - `getContact(id: number): Promise<FullContact>` -- `GET /api/contacts/:id`.
  - `getAllContacts(): Promise<FullContact[]>` -- uses `paginateAll` with `listContacts`.
  - `listContactNotes(contactId: number, options?: { page?, limit? }): Promise<PaginatedResponse<Note>>` -- `GET /api/contacts/:id/notes`.
  - `getUpcomingReminders(monthOffset: number): Promise<ReminderOutbox[]>` -- `GET /api/reminders/upcoming/:month`.
  - `listGenders(): Promise<Gender[]>` -- `GET /api/genders`, paginated.
  - `listContactFieldTypes(): Promise<ContactFieldType[]>` -- `GET /api/contactfieldtypes`, paginated.
  - `listContactAddresses(contactId: number): Promise<Address[]>` -- `GET /api/contacts/:id/addresses`, paginated.
  - `getContactWithFields(id: number): Promise<FullContact>` -- `GET /api/contacts/:id?with=contactfields`.

**Test (TDD):**
- Mock fetch to return fixture data. Verify `listContacts` returns parsed `FullContact[]`.
- Verify `getContact` validates response and returns typed data.
- Verify `getAllContacts` calls multiple pages when `meta.last_page > 1`.
- Verify authorization header is set correctly.
- Verify timeout is applied.
- Verify error responses throw `MonicaApiError`.

**Expected outcome:** All read operations typed and tested.

### Step 5: Monica API Client -- Write Operations

**What:** Add write methods to `MonicaApiClient`.

**Files to modify:**
- `packages/monica-api-lib/src/client.ts`

**Details:**
- `createContact(data: CreateContactRequest): Promise<FullContact>` -- `POST /api/contacts`. Validates request with `CreateContactRequest` schema before sending.
- `updateContact(id: number, data: CreateContactRequest): Promise<FullContact>` -- `PUT /api/contacts/:id`.
- `updateContactCareer(id: number, data: UpdateContactCareerRequest): Promise<FullContact>` -- `PUT /api/contacts/:id/work`.
- `createNote(data: CreateNoteRequest): Promise<Note>` -- `POST /api/notes`.
- `createActivity(data: CreateActivityRequest): Promise<Activity>` -- `POST /api/activities`.
- `createReminder(data: CreateReminderRequest): Promise<Reminder>` -- `POST /api/reminders`.
- `createContactField(data: CreateContactFieldRequest): Promise<ContactField>` -- `POST /api/contactfields`.
- `createAddress(data: CreateAddressRequest): Promise<Address>` -- `POST /api/addresses`.

**Test (TDD):**
- Mock fetch. Verify each write method sends the correct HTTP method, path, and body.
- Verify request body is validated before sending (pass invalid body, expect Zod error thrown locally before fetch).
- Verify response is validated with Zod schema.

**Expected outcome:** Full CRUD client ready.

### Step 6: Export Client from `monica-api-lib`

**What:** Update `packages/monica-api-lib/src/index.ts` to export the client, errors, and transport types. Update `package.json` if needed.

**Files to modify:**
- `packages/monica-api-lib/src/index.ts`

**Details:**
- Export: `MonicaApiClient`, `MonicaApiError`, `MonicaNetworkError`, `MonicaPaginationCapError`, `RetryOptions`, and all existing schema/type/fixture exports.
- Run `pnpm run build` to verify the package compiles with all new exports.

**Expected outcome:** Package is consumable by `monica-integration`.

### Step 7: `monica-integration` Config and Dependencies

**What:** Add config validation and dependencies to the `monica-integration` service.

**Files to create:**
- `services/monica-integration/src/config.ts`

**Files to modify:**
- `services/monica-integration/package.json` -- add dependencies on `@monica-companion/auth`, `@monica-companion/monica-api-lib`, `@monica-companion/types`, `@monica-companion/redaction`, `zod`.
- `docker-compose.yml` -- add env vars `JWT_SECRET`, `JWT_SECRET_PREVIOUS`, `USER_MANAGEMENT_URL` to `monica-integration` service.

**Details for config.ts:**
- Zod schema validating: `PORT`, `SERVICE_NAME`, `JWT_SECRET`, `JWT_SECRET_PREVIOUS` (optional), `USER_MANAGEMENT_URL`, `MONICA_DEFAULT_TIMEOUT_MS` (default 10000), `MONICA_RETRY_MAX` (default 2).
- `loadConfig(env)` function returning typed Config object with `auth: AuthConfig`.

**Test (TDD):**
- Valid env produces correct config.
- Missing required field throws.
- Defaults are applied.

**Expected outcome:** Service config ready.

### Step 8: Credential Resolution Client

**What:** Create a client that `monica-integration` uses to fetch Monica credentials from `user-management`.

**Files to create:**
- `services/monica-integration/src/lib/credential-client.ts`

**Details:**
- Uses `@monica-companion/auth` `createServiceClient` to call `user-management`.
- Function `fetchMonicaCredentials(serviceClient: ServiceClient, userId: string, correlationId: string): Promise<{ baseUrl: string, apiToken: string }>`.
- Validates response with a Zod schema: `{ baseUrl: z.string(), apiToken: z.string() }`.
- Has explicit timeout (5s).
- Throws a typed error on failure (credential not found, user-management unreachable).
- The credential response must NEVER be logged. Use redaction.

**Test (TDD):**
- Mock ServiceClient. Verify correct endpoint called with userId.
- Verify timeout is enforced.
- Verify error on non-200 response.
- Verify response validation.

**Expected outcome:** Credential resolution ready.

### Step 9: Contact Projection Builder

**What:** Create the function that transforms `FullContact[]` from Monica into `ContactResolutionSummary[]`.

**Files to create:**
- `services/monica-integration/src/lib/contact-projection.ts`

**Details:**
- `buildContactResolutionSummary(contact: FullContact): ContactResolutionSummary`
  - `contactId` = `contact.id`
  - `displayName` = `contact.complete_name`
  - `aliases` = deduplicated array of `[nickname, first_name, last_name].filter(Boolean)`, excluding values that equal the `complete_name`.
  - `relationshipLabels` = flatmap over `information.relationships.{love,family,friend,work}.contacts[].relationship.name`. Empty array for partial contacts.
  - `importantDates` = if `information.dates.birthdate.date` is non-null, produce `{ label: "birthdate", date: <date portion>, isYearUnknown: birthdate.is_year_unknown ?? false }`. Otherwise empty array.
  - `lastInteractionAt` = `contact.last_activity_together` (nullable pass-through).
- `buildContactResolutionSummaries(contacts: FullContact[]): ContactResolutionSummary[]` -- maps over array.
- Validate output with `ContactResolutionSummary` schema.

**Test (TDD):**
- Full contact fixture maps correctly (use existing `fullContactFixture`).
- Contact with no nickname, no relationships, no birthdate, null last activity produces valid summary with empty arrays and null.
- Partial contact (`is_partial: true`) has empty relationship labels.
- Duplicate aliases are deduplicated.
- Date extraction handles `is_year_unknown: true`.
- Output validates against `ContactResolutionSummary` schema.

**Expected outcome:** Projection builder tested and ready.

### Step 10: `monica-integration` Internal API -- Contact Resolution Endpoint

**What:** Add the read-only contact resolution endpoint to `monica-integration`.

**Files to modify:**
- `services/monica-integration/src/app.ts`

**Details:**
- Create a Hono route group `/internal` with `serviceAuth` middleware.
- `GET /internal/contacts/resolution-summaries` -- allowed callers: `["ai-router"]`.
  - Extracts `userId` from JWT.
  - Fetches Monica credentials via credential client.
  - Creates a `MonicaApiClient` with the credentials.
  - Calls `getAllContacts()`.
  - Builds `ContactResolutionSummary[]` via projection builder.
  - Returns JSON `{ data: ContactResolutionSummary[] }`.
  - On MonicaApiError: returns appropriate HTTP status with Monica-agnostic error message.
- Health endpoint remains unauthenticated at `/health`.

**Test (TDD):**
- Mock credential client and MonicaApiClient. Verify the endpoint returns 200 with valid summaries.
- Verify 401 without auth header.
- Verify 403 when called by disallowed service (e.g., `scheduler` calling a `ai-router`-only endpoint).
- Verify Monica API error maps to appropriate HTTP error response.

**Expected outcome:** `ai-router` can call this endpoint to get the contact list.

### Step 11: `monica-integration` Internal API -- Write/Execution Endpoints

**What:** Add write endpoints that `scheduler` calls to execute confirmed commands.

**Files to modify:**
- `services/monica-integration/src/app.ts`

**Files to create:**
- `services/monica-integration/src/routes/contacts.ts`
- `services/monica-integration/src/routes/notes.ts`
- `services/monica-integration/src/routes/activities.ts`
- `services/monica-integration/src/routes/contact-fields.ts`
- `services/monica-integration/src/routes/addresses.ts`
- `services/monica-integration/src/routes/reminders.ts`
- `services/monica-integration/src/routes/genders.ts`
- `services/monica-integration/src/routes/contact-field-types.ts`

**Details:**

Internal request/response schemas (Zod, defined in each route file):

- `POST /internal/contacts` -- Body: `{ firstName, lastName?, nickname?, genderId, birthdate?: { day, month, year?, isAgeBase?, age? } }`. Returns `{ contactId, displayName }`.
- `POST /internal/contacts/:contactId/notes` -- Body: `{ body: string }`. Returns `{ noteId }`.
- `POST /internal/activities` -- Body: `{ summary, description?, happenedAt, contactIds, activityTypeId? }`. Returns `{ activityId }`.
- `PUT /internal/contacts/:contactId` -- Body: same as create. Returns `{ contactId, displayName }`.
- `POST /internal/contacts/:contactId/contact-fields` -- Body: `{ value, type: "email" | "phone", contactFieldTypeId }`. Returns `{ contactFieldId }`.
- `POST /internal/contacts/:contactId/addresses` -- Body: `{ name?, street?, city?, province?, postalCode?, country }`. Returns `{ addressId }`.
- `GET /internal/contacts/:contactId` -- Returns Monica-agnostic contact detail projection.
- `GET /internal/contacts/:contactId/notes` -- Returns simplified recent notes.
- `GET /internal/reminders/upcoming` -- Query: `monthOffset`. Returns simplified upcoming reminders.
- `GET /internal/genders` -- Returns `{ data: [{ id, name, type }] }`.
- `GET /internal/contact-field-types` -- Returns `{ data: [{ id, name, type }] }`.

All write endpoints: allowed callers `["scheduler"]`.
All read endpoints on individual contacts: allowed callers `["ai-router", "scheduler"]`.
Gender and contact-field-type reference data: allowed callers `["scheduler"]`.

Each route handler:
1. Validates request body with Zod schema.
2. Extracts userId from JWT context.
3. Fetches Monica credentials.
4. Creates MonicaApiClient.
5. Calls the appropriate client method.
6. Returns a Monica-agnostic response.

**Test (TDD):**
- For each endpoint: mock credential client + MonicaApiClient, verify correct client method called, verify response shape.
- Verify Zod validation rejects invalid request bodies with 400.
- Verify caller allowlists are enforced.

**Expected outcome:** All V1 execution endpoints ready.

### Step 12: Observability and Redaction Integration

**What:** Ensure all logging uses `@monica-companion/observability`, all sensitive data is redacted, and correlation IDs propagate.

**Files to modify:**
- All files in `services/monica-integration/src/`
- `packages/monica-api-lib/src/client.ts` (logger callback)

**Details:**
- Monica API tokens must never appear in logs. The client's logger callback must use `@monica-companion/redaction` `redactString` on any logged URL or header.
- Log Monica API calls with: method, path (no query params containing tokens), status code, duration, retry count. Never log response bodies.
- Correlation IDs from the incoming service auth JWT propagate to log attributes.
- Error responses to callers must not include Monica API error details that could leak instance configuration. Use generic error messages like "Monica API error: contact not found" without including the raw Monica base URL.

**Test (TDD):**
- Verify that a logged Monica API URL with a token is redacted.
- Verify correlation ID appears in log attributes.

**Expected outcome:** Observability-safe logging throughout.

### Step 13: Docker Compose Environment Update

**What:** Update `docker-compose.yml` to wire the `monica-integration` service correctly.

**Files to modify:**
- `docker-compose.yml`
- `.env.example`

**Details:**
- Add to `monica-integration` environment section:
  ```yaml
  JWT_SECRET: ${JWT_SECRET}
  JWT_SECRET_PREVIOUS: ${JWT_SECRET_PREVIOUS:-}
  USER_MANAGEMENT_URL: http://user-management:3007
  MONICA_DEFAULT_TIMEOUT_MS: ${MONICA_DEFAULT_TIMEOUT_MS:-10000}
  MONICA_RETRY_MAX: ${MONICA_RETRY_MAX:-2}
  ```
- Ensure `depends_on` includes `user-management: condition: service_healthy` (already depends on postgres and redis, also need user-management for credential resolution).

**Expected outcome:** Service runs in Docker Compose with correct environment.

### Step 14: Stub Credential Endpoint for Smoke Testing

**What:** Add a temporary stub endpoint on `user-management` that returns hardcoded test credentials, solely for smoke testing. This will be replaced by the real credential endpoint in "Least-Privilege User Management".

**Files to modify:**
- `services/user-management/src/app.ts`

**Details:**
- `GET /internal/users/:userId/monica-credentials` -- allowed caller: `["monica-integration"]`.
- Returns `{ baseUrl: process.env.MONICA_BASE_URL, apiToken: process.env.MONICA_API_TOKEN }` (from env vars, for smoke testing only).
- Add a `TODO: Replace with real encrypted credential resolution (Least-Privilege User Management)` comment.
- If `MONICA_BASE_URL` or `MONICA_API_TOKEN` are not set, return 404.

**Test:** No unit test needed for a temporary stub.

**Expected outcome:** Smoke test can exercise the full chain.

## Test Strategy

### Unit Tests (Vitest) -- What to test, what to mock

| Test File | Tests | Mocks |
|-----------|-------|-------|
| `packages/monica-api-lib/src/__tests__/errors.test.ts` | Error parsing, retryable classification | None |
| `packages/monica-api-lib/src/__tests__/transport.test.ts` | Timeout, retry logic, backoff, jitter, Retry-After | `fetch` (mock) |
| `packages/monica-api-lib/src/__tests__/pagination.test.ts` | Multi-page iteration, cap enforcement, empty results | Page fetcher (mock) |
| `packages/monica-api-lib/src/__tests__/client.test.ts` | All client methods: correct URL, headers, request validation, response parsing, error handling | `fetch` (mock returning fixtures) |
| `services/monica-integration/src/__tests__/config.test.ts` | Config validation, defaults, missing fields | None |
| `services/monica-integration/src/__tests__/credential-client.test.ts` | Credential fetch, timeout, error handling | `ServiceClient` (mock) |
| `services/monica-integration/src/__tests__/contact-projection.test.ts` | Projection builder with various contact shapes | None (pure function) |
| `services/monica-integration/src/__tests__/app.test.ts` | All endpoints: auth enforcement, caller allowlists, request validation, response shape, error mapping | Credential client, MonicaApiClient (mock) |

### Integration Tests -- What needs real Postgres/Redis

None required for this task. The `monica-integration` service has no direct database dependency (credentials come from `user-management`). All external dependencies are mocked in unit tests.

### TDD Sequence

For each step above, the failing test is written first:

1. **Errors**: test `MonicaApiError.fromResponse` with fixture payloads before implementing the class.
2. **Transport**: test `withTimeout` throws after deadline before implementing. Test `withRetry` retries on 500 before implementing.
3. **Pagination**: test multi-page fetch returns concatenated results before implementing.
4. **Client reads**: test `listContacts` returns parsed fixture before implementing.
5. **Client writes**: test `createNote` sends correct body before implementing.
6. **Config**: test missing JWT_SECRET throws before implementing.
7. **Credential client**: test correct endpoint called before implementing.
8. **Contact projection**: test mapping from `fullContactFixture` before implementing.
9. **App endpoints**: test `GET /internal/contacts/resolution-summaries` returns 200 before implementing.

## Smoke Test Strategy

### Docker Compose services to start

```bash
docker compose up -d postgres redis
docker compose --profile app up -d user-management monica-integration
```

### HTTP checks to run

1. **Health check:**
   ```bash
   docker compose exec monica-integration sh -c "curl -s http://localhost:3004/health"
   # Expected: {"status":"ok","service":"monica-integration"}
   ```

2. **Auth enforcement -- missing token:**
   ```bash
   docker compose exec monica-integration sh -c "curl -s -o /dev/null -w '%{http_code}' http://localhost:3004/internal/contacts/resolution-summaries"
   # Expected: 401
   ```

3. **Auth enforcement -- wrong caller:**
   Generate a JWT with issuer=`scheduler` and audience=`monica-integration`, then call the ai-router-only endpoint:
   ```bash
   # (Script to generate JWT and curl)
   # Expected: 403
   ```

4. **End-to-end with stub credentials** (requires `MONICA_BASE_URL` and `MONICA_API_TOKEN` in env -- only run if a test Monica instance is available):
   Generate a JWT with issuer=`ai-router`, audience=`monica-integration`, subject=`test-user-id`:
   ```bash
   # curl with generated JWT to resolution-summaries endpoint
   # Expected: 200 with data array (may be empty if test instance has no contacts)
   ```

### What the smoke test proves

- `monica-integration` boots, binds to its port, and responds on the internal Docker network.
- Health endpoint is accessible without auth.
- Service auth middleware rejects unauthenticated and unauthorized requests.
- With valid auth and stub credentials, the service can call the Monica API client and return results (or graceful errors if no Monica instance is configured).

## Security Considerations

- **Credential isolation (security.md):** Monica API tokens are fetched from `user-management` per-request and never cached in memory beyond the request lifetime. They are never logged, stored in queue payloads, or included in error responses.
- **Per-endpoint caller allowlists (security.md):** Read-only contact resolution endpoints allow only `ai-router`. Write/execution endpoints allow only `scheduler`. Reference data endpoints allow only `scheduler`. This is stricter than a service-wide allowlist.
- **Redaction (security.md):** The `@monica-companion/redaction` package's patterns already cover `api[_-]?key`, `token`, `authorization`, and Bearer token values. Monica base URLs are not inherently sensitive but should not leak in error responses. Monica API tokens pass through `Authorization` headers which are pattern-matched.
- **No public exposure (security.md):** `monica-integration` has no Caddy route. It is only accessible on the internal Docker network. `/health` is not publicly routed.
- **Service auth (security.md):** All internal endpoints use signed JWTs from `@monica-companion/auth` with the existing `serviceAuth` middleware.

## Risks & Open Questions

1. **`user-management` credential endpoint does not exist yet.** Mitigated by the stub in Step 14 and mock in unit tests. Real implementation comes in "Least-Privilege User Management". The stub must be clearly marked as temporary.

2. **Monica API rate limit (60 req/min) constrains full contact list fetching.** For a user with 1000 contacts, `getAllContacts` makes 10 requests. If multiple users trigger concurrent refreshes, rate limiting may cause 429s. The retry logic handles 429 with Retry-After, but sustained contention needs a future caching layer. Not in scope for this task.

3. **No SSRF protection on Monica base URLs yet.** The "Safe Multi-Instance Support" task handles URL normalization and blocked-target rejection. This task passes through the base URL as-is from credentials. The risk is mitigated by the fact that credentials come from `user-management` (which will enforce URL validation in a later task).

4. **Client instantiation per-request has overhead.** The `MonicaApiClient` is lightweight (no connection pool), so per-request instantiation is acceptable. A future optimization could cache clients by userId with TTL, but this is not needed for V1.

5. **Zod v4 import path.** The existing code uses `import { z } from "zod/v4"` which is the correct import for Zod v4. Maintain this consistently.

6. **Response schema validation strictness.** The existing schemas use default Zod behavior (strip unknown keys). This is correct for responses -- Monica may add fields in future versions and we should not break on them. Request schemas use `.strict()` to prevent sending unknown fields. This convention is already established and should be maintained.

7. **`getUpcomingReminders` returns `ReminderOutbox[]`, not `Reminder[]`.** The schema is already defined. The endpoint `/api/reminders/upcoming/{month}` returns a paginated response of `ReminderOutbox` objects. The client must handle this correctly.
