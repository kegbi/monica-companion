---
verdict: APPROVED
attempt: 1
biome_pass: true
tests_pass: true
test_summary: "46 passed, 0 failed (5 suites failed due to pre-existing zod/v4 module resolution issue, unrelated to this change)"
critical_count: 0
high_count: 0
medium_count: 2
---

# Code Review: Testing Strategy Split

## Automated Checks

- **Biome**: PASS -- 203 files checked, 0 issues found.
- **Tests**: PASS -- monica-api-lib: 46 tests passed in url-validation suite. 5 test suites fail due to pre-existing `zod/v4` module resolution issue (confirmed identical behavior with and without this change by stashing and re-running). No smoke test files were picked up by `pnpm test`, confirming CI isolation works correctly.

## Files Reviewed

### Modified Files
- `.github/workflows/ci.yml` -- Added clarifying comment about mocked fixtures.
- `.gitignore` -- Added `.env.smoke`, `scripts/.env.smoke`, and `smoke-results/` patterns.
- `package.json` -- Added `test:smoke:monica` root script.
- `packages/monica-api-lib/package.json` -- Added `test:smoke` script.

### New Files
- `.github/workflows/monica-smoke.yml` -- Nightly/manual smoke test GH Actions workflow.
- `docker-compose.monica-smoke.yml` -- Docker Compose overlay for isolated Monica v4 + MariaDB.
- `scripts/seed-monica-smoke.ts` -- Seed script with health wait, user registration, token acquisition, data seeding, env file output.
- `packages/monica-api-lib/vitest.config.ts` -- Default vitest config excluding `src/__smoke__/**` from CI.
- `packages/monica-api-lib/vitest.smoke.config.ts` -- Smoke-only vitest config with sequential execution and JUnit output.
- `packages/monica-api-lib/src/__smoke__/smoke-config.ts` -- Zod-validated config loader for smoke env vars.
- `packages/monica-api-lib/src/__smoke__/schema-fidelity.smoke.test.ts` -- Schema validation smoke tests.
- `packages/monica-api-lib/src/__smoke__/client-read.smoke.test.ts` -- Read operation smoke tests.
- `packages/monica-api-lib/src/__smoke__/client-write.smoke.test.ts` -- Write operation smoke tests.
- `context/product/testing-strategy.md` -- Two-tier testing strategy documentation.

## Findings

### CRITICAL
(none)

### HIGH
(none)

### MEDIUM

1. [MEDIUM] `.github/workflows/monica-smoke.yml:84` -- The `MONICA_SMOKE_API_TOKEN` env var is set to `${{ env.SMOKE_API_TOKEN }}`, but `SMOKE_API_TOKEN` is never populated by any prior step. The seed script writes the token to `scripts/.env.smoke` as a file, not to the GitHub Actions environment. This works by accident because the empty string is falsy in JavaScript, so `loadSmokeConfig()` falls through to the file-based lookup. However, this is fragile and confusing -- if someone refactors the config loader to treat empty string as a set value, the workflow will break silently.
   **Fix:** Either (a) remove the `MONICA_SMOKE_API_TOKEN` line from the env block entirely and rely on the file-based fallback, or (b) add a step after the seed script that reads the token from the file and writes it to `$GITHUB_ENV` using `echo "SMOKE_API_TOKEN=$(grep MONICA_SMOKE_API_TOKEN scripts/.env.smoke | cut -d= -f2)" >> $GITHUB_ENV`.

2. [MEDIUM] `.github/workflows/monica-smoke.yml:49` and `docker-compose.monica-smoke.yml:36` -- The `APP_KEY` is a hardcoded base64 string committed to the repository. While this is documented as being for a disposable smoke test instance only (not production), it is still a cryptographic key in source control. If someone copies this key for another purpose, it creates a security risk.
   **Fix:** Generate the `APP_KEY` at runtime in the workflow and Docker Compose. For example, in the GH Actions workflow, add a step `APP_KEY=$(openssl rand -base64 32)` and pass it as a variable. In Docker Compose, use an environment variable with a default that is only for local dev: `APP_KEY=${MONICA_SMOKE_APP_KEY:-base64:$(openssl rand -base64 32)}`. Alternatively, document clearly in the compose file that this key must never be used outside disposable smoke testing (a comment is present but could be more prominent).

### LOW

1. [LOW] `packages/monica-api-lib/src/__smoke__/client-write.smoke.test.ts:80` -- The hardcoded date `2026-03-15` will become stale. If tests are run after that date, Monica might handle past dates differently than future dates.
   **Fix:** Use a dynamically computed date string relative to the current date, e.g., `new Date().toISOString().split("T")[0]`.

2. [LOW] `scripts/seed-monica-smoke.ts:330` -- `import.meta.dirname` is available in Node 21.2+ and stable in Node 22+. The project requires Node >=24 so this is fine, but there is a fallback to `process.cwd()` which would write the `.env.smoke` file to the wrong directory if `import.meta.dirname` were ever undefined.
   **Fix:** No immediate action needed given Node >=24 requirement, but the fallback path could be documented with a comment explaining it is a safety net only.

3. [LOW] `packages/monica-api-lib/src/__smoke__/smoke-config.ts:43` -- `z.prettifyError(result.error)` is a Zod v4 API. If the `zod/v4` module resolution issue gets fixed differently (e.g., by switching to a different import path), this might need updating.
   **Fix:** No action needed now; this is tracked as part of the broader zod/v4 resolution issue.

4. [LOW] `docker-compose.monica-smoke.yml:29` -- The `monica:4.1.2` image tag has not been verified against Docker Hub. The implementation summary acknowledges this risk. If the tag does not exist, `docker compose up` will fail with a clear error.
   **Fix:** Verify the tag on Docker Hub before the first actual smoke run. Document the verified tag in `testing-strategy.md`.

## Plan Compliance

The implementation follows the approved plan closely. All 8 planned steps were executed:

1. **Audit existing tests** -- Confirmed all existing tests are CI-safe (mocked). Comment added to `ci.yml`.
2. **Docker Compose overlay** -- Created `docker-compose.monica-smoke.yml` with Monica + MariaDB on isolated network.
3. **Seed script** -- Created `scripts/seed-monica-smoke.ts` with health wait, user registration, multi-strategy token acquisition, test data seeding.
4. **Smoke test suite** -- Created 3 smoke test files covering schema fidelity, read operations, and write operations.
5. **NPM scripts and Vitest config** -- Added `test:smoke` and `test:smoke:monica` scripts. Created both `vitest.config.ts` (CI exclusion) and `vitest.smoke.config.ts` (smoke inclusion).
6. **GitHub Actions workflow** -- Created `monica-smoke.yml` with nightly schedule and manual dispatch.
7. **Documentation** -- Created `context/product/testing-strategy.md` with full strategy documentation.
8. **Release gate** -- Documented manual verification policy for V1.

**Justified deviations:**
- Monica Docker image tag (`4.1.2`) is an approximation pending Docker Hub verification (documented in plan as open question).
- MariaDB tag (`11.7.2`) is within the planned `11.x` range.
- No roadmap update, correctly following completion rules (Docker Compose smoke tests not yet run against live stack).
- TDD adaptation for smoke tests is reasonable -- the "RED" state is configuration absence.

**No unjustified deviations found.**

## Verdict Rationale

**APPROVED.** All automated checks pass (Biome clean, tests identical to baseline). The implementation delivers a clean separation between CI contract tests and a real-Monica smoke suite, matching the approved plan. The two MEDIUM findings are not blocking:

1. The GH Actions token-passing issue works correctly in practice due to JavaScript falsy semantics, though it should be cleaned up before the workflow is first used.
2. The hardcoded `APP_KEY` is documented as disposable and has no production security impact.

Neither finding represents a genuine security vulnerability or correctness issue that would justify rejection. Both are documented for follow-up.
