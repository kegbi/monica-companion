# Testing Strategy

This document describes the testing approach for Monica API interactions, LLM smoke tests, and the release gate policy.

---

## Overview

Monica Companion uses a strict separation between two classes of Monica API tests:

1. **CI contract tests** -- mocked fixtures that run on every push and PR, validating schema correctness and client logic without any network calls.
2. **Controlled real-Monica smoke suite** -- tests against an actual Monica v4 instance, running nightly or on manual trigger for release-candidate validation.

This separation ensures CI remains fast and deterministic while still catching real API drift before production releases.

---

## CI Contract Tests (Mocked)

**Location:** `packages/monica-api-lib/src/__tests__/` and `services/monica-integration/src/__tests__/`

**How they work:**
- All tests use `vi.fn()` mocks, `mockFetchResponse()` helpers, or pure fixture data.
- No test contacts a real Monica instance.
- Fixtures are aligned with the contracts documented in `context/product/monica-api-scope.md`.
- Zod schemas validate that fixture shapes match the expected API contracts.

**Running:**
```bash
pnpm test                # Runs all CI tests across all packages
pnpm --filter @monica-companion/monica-api-lib test  # Just monica-api-lib
```

**CI integration:** The `ci.yml` GitHub Actions workflow runs these on every push to `main` and every PR.

---

## Real-Monica Smoke Suite

**Location:** `packages/monica-api-lib/src/__smoke__/`

**What it tests:**
- `schema-fidelity.smoke.test.ts` -- Validates that real API responses parse through our Zod schemas without errors. Catches schema drift between our models and the actual API.
- `client-read.smoke.test.ts` -- Exercises all read operations (`listContacts`, `getContact`, `getAllContacts`, `listContactNotes`, `getUpcomingReminders`, `listGenders`, `listContactFieldTypes`, `listContactAddresses`, `getContactWithFields`) against a real instance.
- `client-write.smoke.test.ts` -- Exercises all write operations (`createContact`, `createNote`, `createActivity`, `createContactField`, `createAddress`, `createReminder`, `updateContact`, `updateContactCareer`) against a real instance.

**Key design decisions:**
- Tests run sequentially (`fileParallelism: false`) to respect Monica's 60 req/min rate limit.
- The entire Monica instance is disposable -- torn down after each run.
- JUnit XML results are generated for CI artifact upload.
- Smoke tests are excluded from `pnpm test` via the `vitest.config.ts` exclude pattern.

### Running Locally

**Prerequisites:** Docker and Docker Compose.

```bash
# 1. Start the Monica smoke stack
docker compose -f docker-compose.monica-smoke.yml up -d

# 2. Wait for Monica and seed test data
pnpm tsx scripts/seed-monica-smoke.ts

# 3. Run the smoke tests
pnpm test:smoke:monica

# 4. Tear down
docker compose -f docker-compose.monica-smoke.yml down -v
```

### Running in CI

The `monica-smoke.yml` GitHub Actions workflow:
- Runs nightly at 3am UTC via cron schedule.
- Can be triggered manually for release-candidate validation via `workflow_dispatch`.
- Uses a MariaDB service container and starts a Monica Docker container.
- Seeds test data and runs all smoke tests.
- Uploads JUnit XML results as workflow artifacts.

---

## LLM Smoke Suite

**Location:** `services/ai-router/src/__smoke__/`

**What it tests:**
- `command-parsing.smoke.test.ts` — Send representative text messages covering all V1 command types (contact create, note create, activity log, field updates, read queries) through the live `telegram-bridge → ai-router` path and verify correct command payloads are produced.
- `dialog-clarification.smoke.test.ts` — Simulate multi-turn dialogs: ambiguous input → clarification prompt → user response → correct command. Verify pending command stays in `draft` through clarification and transitions to `pending_confirmation` only when resolved.
- `context-preservation.smoke.test.ts` — Send consecutive messages with implicit references ("add note to John" → "also update his birthday") and verify pronoun/reference resolution using `conversation_turns` context.
- `out-of-scope.smoke.test.ts` — Send out-of-domain queries and verify polite decline without pending command creation or mutation triggers.

**Key design decisions:**
- Tests run via Docker Compose against the live `ai-router` service (connected to real PostgreSQL, Redis, and mocked Monica).
- Benchmark evaluation compares LangGraph output intent/command payloads against labeled ground-truth using the metrics defined in `acceptance-criteria.md`.
- Tests verify that command parsing confidence scores are appropriate for the auto-confirmation feature.

### Running Locally

**Prerequisites:** Docker, Docker Compose, and the benchmark fixture files.

```bash
# 1. Start the app stack (including ai-router, postgres, redis)
docker compose --profile app up -d

# 2. Run LLM smoke tests
pnpm test:smoke:llm

# 3. Tear down
docker compose --profile app down -v
```

### Running in CI

A `llm-smoke.yml` GitHub Actions workflow:
- Runs on demand or post-merge to main.
- Spins up the full app stack with real PostgreSQL and Redis.
- Runs all smoke tests and generates benchmark evaluation metrics.
- Uploads JUnit XML and benchmark metrics as workflow artifacts.
- Blocks release if any acceptance-criteria thresholds are not met.

---

## Release Gate Policy

**Production release requires both:**
1. The latest controlled real-Monica smoke suite to have passed.
2. The latest LLM smoke suite to have passed with all acceptance-criteria thresholds met (read accuracy ≥ 92%, write accuracy ≥ 90%, contact-resolution precision ≥ 95%, false-positive mutation rate < 1%).

For V1, this is enforced via manual verification:
1. Before a production release, check that the most recent `Monica Smoke Tests` and `LLM Smoke Tests` workflow runs passed.
2. The workflow badges in the repository provide at-a-glance status.
3. If the latest run failed, investigate and resolve before releasing.

A formal automated release gate (e.g., required status check on a release branch) can be added when a deployment pipeline is established.

---

## References

- Testing rules: `.claude/rules/testing.md`
- Monica API scope: `context/product/monica-api-scope.md`
- Acceptance criteria (Testing & Release Gates): `context/product/acceptance-criteria.md`
