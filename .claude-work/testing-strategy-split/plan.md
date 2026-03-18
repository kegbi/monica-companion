# Implementation Plan: Testing Strategy Split

## Objective

Establish a clean separation between two classes of Monica API tests:

1. **CI contract tests** that use mocked/stubbed Monica payloads aligned with `monica-api-scope.md` -- these run on every push/PR and never contact a real Monica instance.
2. **Controlled real-Monica smoke suite** that runs against an actual Monica instance outside normal CI (nightly or release-candidate), serving as a production release gate.

This task satisfies the three roadmap sub-items under "Testing Strategy Split" and the three acceptance criteria under "Testing & Release Gates" in `acceptance-criteria.md`.

## Scope

### In Scope

- Audit and label all existing Monica-related tests to confirm they are CI-safe (mocked). Document gaps.
- Create a dedicated real-Monica smoke test suite in `packages/monica-api-lib/` that exercises actual API calls against a controlled Monica instance.
- Add a `docker-compose.monica-smoke.yml` overlay to spin up a local Monica instance for the smoke suite.
- Create a GitHub Actions workflow for nightly/release-candidate execution of the real-Monica smoke suite.
- Make the smoke suite a documented release gate (a workflow that must pass before production deploy).
- Add documentation explaining the split, how to run each suite, and how the release gate works.

### Out of Scope

- Changing the existing Zod schemas, fixtures, or `MonicaApiClient` implementation.
- Adding new Monica API endpoints or operations.
- Docker Compose smoke tests for other services (those are covered by their own roadmap items).
- The labeled benchmark set for AI accuracy (that is a Phase 3 task).
- Actual production deployment pipeline (this task documents the gate, not the deploy).

## Affected Services & Packages

| Package/Service | Changes |
|-----------------|---------|
| `packages/monica-api-lib` | New `src/__smoke__/` directory with real-Monica test files; new `vitest.smoke.config.ts`; new `test:smoke` script |
| `services/monica-integration` | No code changes; existing tests confirmed as CI-safe (already mocked) |
| Root | New `docker-compose.monica-smoke.yml` overlay; new `.github/workflows/monica-smoke.yml`; root `package.json` gets `test:smoke:monica` script; documentation updates |
| `.github/workflows/ci.yml` | Minor: add comment clarifying this never contacts real Monica |
| `context/product/` | Update `roadmap.md` to mark sub-items complete after verification |

## Implementation Steps

### Step 1: Audit and label existing tests as CI-safe

**What:** Review every test file in `packages/monica-api-lib/src/__tests__/` and `services/monica-integration/src/__tests__/` to confirm that none of them contact a real Monica instance. Document the audit result.

**Files to review (no changes expected):**
- `packages/monica-api-lib/src/__tests__/schemas.test.ts` -- Uses fixtures, no network calls. CI-safe.
- `packages/monica-api-lib/src/__tests__/transport.test.ts` -- Uses `vi.fn()` mocks. CI-safe.
- `packages/monica-api-lib/src/__tests__/client.test.ts` -- Uses `mockFetchResponse()`. CI-safe.
- `packages/monica-api-lib/src/__tests__/pagination.test.ts` -- Uses `vi.fn()` mocks. CI-safe.
- `packages/monica-api-lib/src/__tests__/errors.test.ts` -- Pure unit tests. CI-safe.
- `packages/monica-api-lib/src/__tests__/url-validation.test.ts` -- Uses `vi.fn()` for DNS. CI-safe.
- `services/monica-integration/src/__tests__/app.test.ts` -- Mocks `createMonicaClient`. CI-safe.
- `services/monica-integration/src/__tests__/contact-projection.test.ts` -- Uses fixtures. CI-safe.
- `services/monica-integration/src/__tests__/credential-client.test.ts` -- Mock service client. CI-safe.
- `services/monica-integration/src/__tests__/observability.test.ts` -- Mocks + redaction. CI-safe.
- `services/monica-integration/src/__tests__/config.test.ts` -- Pure unit test. CI-safe.

**Expected outcome:** All existing tests are confirmed CI-safe. No changes needed to existing test files. Add a brief comment to `.github/workflows/ci.yml` noting that CI uses only mocked Monica payloads.

**File to modify:**
- `.github/workflows/ci.yml` -- Add a comment line: `# All Monica API tests use mocked fixtures. No real Monica instance is contacted.`

### Step 2: Create the real-Monica smoke test infrastructure (Docker Compose)

**What:** Create a Docker Compose overlay file that runs a real Monica v4 instance with a MariaDB database, seeded with test data.

**File to create:** `docker-compose.monica-smoke.yml`

The overlay will contain:
- `monica-smoke-db`: MariaDB container (Monica v4 requires MySQL/MariaDB).
- `monica-smoke`: Monica v4 application container, depending on `monica-smoke-db`.

**Key decisions:**
- Use official `monica` Docker image. Verify latest stable tag before implementation.
- Use MariaDB `11.x` (Monica's documented requirement).
- Network: internal, isolated from the main app stack.
- Seed script outputs the API token and base URL to a `.env.smoke` file that the smoke tests will read.

### Step 3: Create the seed script

**What:** Write a TypeScript script that seeds a controlled Monica instance with known test data.

**File to create:** `scripts/seed-monica-smoke.ts`

The script will:
1. Wait for Monica to respond on its health endpoint (retry with backoff, timeout after 120s).
2. Register a user via Monica's registration API.
3. Create a Personal Access Token.
4. Create test contacts: At minimum 3 contacts -- one with full data (matching `fullContactFixture` shape), one minimal, one partial.
5. Create test notes, activities, and reminders attached to those contacts.
6. Write the confirmed API token and base URL to `scripts/.env.smoke`.

### Step 4: Create the real-Monica smoke test suite

**What:** Write Vitest tests that exercise the `MonicaApiClient` against a real Monica instance. These tests are in a separate directory and use a separate Vitest config to ensure they are never run in CI.

**Files to create:**
- `packages/monica-api-lib/vitest.smoke.config.ts` -- Vitest config that includes only `src/__smoke__/**/*.test.ts` files.
- `packages/monica-api-lib/src/__smoke__/smoke-config.ts` -- Loads `MONICA_SMOKE_BASE_URL` and `MONICA_SMOKE_API_TOKEN` from env or `.env.smoke`.
- `packages/monica-api-lib/src/__smoke__/client-read.smoke.test.ts` -- Tests read operations against the real instance.
- `packages/monica-api-lib/src/__smoke__/client-write.smoke.test.ts` -- Tests write operations against the real instance.
- `packages/monica-api-lib/src/__smoke__/schema-fidelity.smoke.test.ts` -- Validates that real API responses parse through Zod schemas without errors.

**Test coverage in the smoke suite:**

`client-read.smoke.test.ts`:
- `listContacts` returns a parseable paginated response.
- `getContact` returns a parseable `FullContact`.
- `getAllContacts` paginates correctly.
- `listContactNotes` returns parseable notes.
- `getUpcomingReminders` returns parseable reminder outbox entries.
- `listGenders` returns parseable genders.
- `listContactFieldTypes` returns parseable contact field types.
- `listContactAddresses` returns parseable addresses.
- `getContactWithFields` returns contact with embedded fields.

`client-write.smoke.test.ts`:
- `createContact` creates a contact and returns a parseable `FullContact`.
- `createNote` creates a note and returns a parseable `Note`.
- `createActivity` creates an activity and returns a parseable `Activity`.
- `createContactField` creates a contact field and returns a parseable `ContactField`.
- `createAddress` creates an address and returns a parseable `Address`.
- `createReminder` creates a reminder and returns a parseable `Reminder`.
- `updateContact` updates a contact and returns the updated `FullContact`.
- `updateContactCareer` updates career info.
- Cleanup: entire instance is torn down after each run (disposable approach).

`schema-fidelity.smoke.test.ts`:
- Fetch real contacts and validate every field matches the Zod schema.
- Verify that the `data/content` asymmetry for contact fields holds in real responses.
- Verify that `initial_date` (not `next_expected_date`) is used in real reminder responses.
- Verify the doc-vs-actual discrepancies documented in `monica-api-scope.md`.

### Step 5: Add npm scripts and Vitest configuration

**What:** Wire up the smoke test scripts.

**Files to modify:**
- `packages/monica-api-lib/package.json` -- Add `"test:smoke": "vitest run --config vitest.smoke.config.ts"` script.
- Root `package.json` -- Add `"test:smoke:monica": "pnpm --filter @monica-companion/monica-api-lib test:smoke"` script.

**File to create:**
- `packages/monica-api-lib/vitest.smoke.config.ts`

**Ensure exclusion from CI:** Verify that `src/__smoke__/` files are NOT picked up by the default Vitest config. If needed, add explicit excludes.

### Step 6: Create the GitHub Actions workflow for the smoke suite

**What:** Create a GitHub Actions workflow that runs the real-Monica smoke suite on a schedule (nightly) and on manual dispatch (for release candidates).

**File to create:** `.github/workflows/monica-smoke.yml`

Key aspects:
- Runs nightly at 3am UTC + manual dispatch for release candidates
- Uses MariaDB as a GH Actions service
- Starts Monica Docker container
- Runs seed script then smoke tests
- Uploads test results as artifacts
- Clearly separate from `ci.yml`

### Step 7: Document the release gate policy

**What:** Create documentation explaining the testing strategy split and the release gate.

**File to create:** `context/product/testing-strategy.md`

Contents:
- Explanation of the two-tier testing approach
- How CI contract tests work (mocked fixtures, `pnpm test`)
- How the real-Monica smoke suite works (`pnpm test:smoke:monica`, Docker Compose setup)
- How to run the smoke suite locally for development
- Release gate policy: production release requires the latest smoke workflow run to have passed
- Link to the acceptance criteria and the relevant `testing.md` rules

### Step 8: Add release-gate enforcement

**Preferred for V1:** Document in `context/product/testing-strategy.md` that production deploys require manual verification of the latest nightly smoke run. Add a GitHub Actions badge for the smoke workflow. The formal automated gate can be added when a deployment pipeline exists.

## Test Strategy

### TDD sequence for the smoke tests

1. **RED:** Write `schema-fidelity.smoke.test.ts` that calls the real API. Without a running Monica instance, fails with configuration error.
2. **GREEN:** Start Monica Docker stack, seed data, re-run. Passes because Zod schemas match real API responses.
3. Continue for read and write tests.

### Smoke test approach for this task itself

1. Start Monica smoke stack: `docker compose -f docker-compose.monica-smoke.yml up -d`
2. Wait for Monica health
3. Run seed script: `pnpm tsx scripts/seed-monica-smoke.ts`
4. Run smoke tests: `pnpm test:smoke:monica`
5. Verify all tests pass
6. Verify `pnpm test` does NOT run smoke tests
7. Tear down: `docker compose -f docker-compose.monica-smoke.yml down -v`

## Security Considerations

- **API tokens in smoke tests:** Generated at runtime, written to `.env.smoke` that is gitignored. Never committed.
- **Sensitive data redaction:** `StructuredLogger` already redacts Bearer tokens. Smoke test assertions avoid logging raw responses.
- **Network isolation:** Monica smoke stack on separate Docker network, not connected to main app.
- **No production credentials:** Only locally generated credentials for disposable Monica instance.
- **Gitignore:** Add `scripts/.env.smoke` to `.gitignore`.

## Risks & Open Questions

1. **Monica Docker image setup complexity:** Monica v4 requires initial user registration and Personal Access Token creation. The exact mechanism for automated setup in Docker needs investigation.
2. **Monica v4 Docker image versioning:** Exact latest stable tag needs verification at implementation time.
3. **MariaDB version compatibility:** Monica v4 requires MySQL 8.0+ or MariaDB 10.6+. Exact tag needs verification.
4. **Rate limiting:** Real Monica instance enforces 60 req/min. Tests must run sequentially with possible delays.
5. **Smoke test data cleanup:** Disposable approach preferred -- tear down entire instance after each run.
6. **GitHub Actions Docker-in-Docker:** Running Monica container inside GH Actions may need `--network host` or services block.
7. **Monica v4 API authentication:** Uses Laravel Passport for OAuth2. Personal Access Tokens via artisan commands or registration API.

## Files That Will Be Created

| File | Purpose |
|---|---|
| `docker-compose.monica-smoke.yml` | Docker Compose overlay for real Monica instance |
| `scripts/seed-monica-smoke.ts` | Seed script for smoke test data |
| `packages/monica-api-lib/vitest.smoke.config.ts` | Vitest config for smoke tests only |
| `packages/monica-api-lib/src/__smoke__/smoke-config.ts` | Smoke test environment config loader |
| `packages/monica-api-lib/src/__smoke__/client-read.smoke.test.ts` | Read operation smoke tests |
| `packages/monica-api-lib/src/__smoke__/client-write.smoke.test.ts` | Write operation smoke tests |
| `packages/monica-api-lib/src/__smoke__/schema-fidelity.smoke.test.ts` | Schema validation smoke tests |
| `.github/workflows/monica-smoke.yml` | Nightly/RC smoke test workflow |
| `context/product/testing-strategy.md` | Testing strategy documentation |

## Files That Will Be Modified

| File | Changes |
|---|---|
| `.github/workflows/ci.yml` | Add comment about mocked tests |
| `packages/monica-api-lib/package.json` | Add `test:smoke` script |
| Root `package.json` | Add `test:smoke:monica` script |
| `.gitignore` | Add `scripts/.env.smoke` |
