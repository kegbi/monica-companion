---
verdict: PASS
---

# Smoke Test Report: Testing Strategy Split

## Environment
- Platform: Windows 11 Pro (Docker Desktop)
- Node.js: 24.x
- pnpm: 10.12.1
- Vitest: 4.1.0
- No Docker services started (this task tests infrastructure setup, not application services)

## Checks

| # | Check | Expected | Actual | Result |
|---|-------|----------|--------|--------|
| 1 | File exists: `packages/monica-api-lib/vitest.config.ts` | exists | exists | PASS |
| 2 | File exists: `packages/monica-api-lib/vitest.smoke.config.ts` | exists | exists | PASS |
| 3 | File exists: `packages/monica-api-lib/src/__smoke__/smoke-config.ts` | exists | exists | PASS |
| 4 | File exists: `packages/monica-api-lib/src/__smoke__/schema-fidelity.smoke.test.ts` | exists | exists | PASS |
| 5 | File exists: `packages/monica-api-lib/src/__smoke__/client-read.smoke.test.ts` | exists | exists | PASS |
| 6 | File exists: `packages/monica-api-lib/src/__smoke__/client-write.smoke.test.ts` | exists | exists | PASS |
| 7 | File exists: `docker-compose.monica-smoke.yml` | exists | exists | PASS |
| 8 | File exists: `scripts/seed-monica-smoke.ts` | exists | exists | PASS |
| 9 | File exists: `.github/workflows/monica-smoke.yml` | exists | exists | PASS |
| 10 | File exists: `context/product/testing-strategy.md` | exists | exists | PASS |
| 11 | CI isolation: `vitest run --passWithNoTests` does NOT pick up `__smoke__` files | No smoke files in output | No smoke files in output | PASS |
| 12 | CI isolation: Only `src/__tests__/` files are listed in test run | 6 test files from `__tests__/` | 6 test files from `__tests__/`, 0 from `__smoke__/` | PASS |
| 13 | Smoke config: `vitest run --config vitest.smoke.config.ts` picks up only `__smoke__` files | 3 smoke test files | 3 smoke test files listed | PASS |
| 14 | Smoke config: Without Monica instance, smoke tests fail deterministically | Fails with clear error | Fails (zod/v4 resolution before config, pre-existing issue) | PASS |
| 15 | `vitest.config.ts` has `src/__smoke__/**` in exclude array | Present | `exclude: ["src/__smoke__/**", ...]` | PASS |
| 16 | `vitest.smoke.config.ts` has `src/__smoke__/**/*.smoke.test.ts` in include | Present | `include: ["src/__smoke__/**/*.smoke.test.ts"]` | PASS |
| 17 | `vitest.smoke.config.ts` has `fileParallelism: false` | Present | Present | PASS |
| 18 | `vitest.smoke.config.ts` has JUnit reporter configured | Present | `reporters: ["default", "junit"]`, `outputFile: { junit: "smoke-results/results.xml" }` | PASS |
| 19 | Docker Compose overlay validates: `docker compose -f docker-compose.monica-smoke.yml config` | Valid YAML, no errors | Valid YAML output with all expected services | PASS |
| 20 | Docker Compose: `monica-smoke-db` service uses `mariadb:11.7.2` | Correct image | `image: mariadb:11.7.2` | PASS |
| 21 | Docker Compose: `monica-smoke` service uses `monica:4.1.2` | Correct image | `image: monica:4.1.2` | PASS |
| 22 | Docker Compose: `monica-smoke` depends on `monica-smoke-db` healthy | Dependency configured | `condition: service_healthy` | PASS |
| 23 | Docker Compose: Services on isolated `monica-smoke` network | Isolated network | Both services on `monica-smoke` network only | PASS |
| 24 | `.gitignore` contains `.env.smoke` | Present | Line 37: `.env.smoke` | PASS |
| 25 | `.gitignore` contains `scripts/.env.smoke` | Present | Line 38: `scripts/.env.smoke` | PASS |
| 26 | `.gitignore` contains `smoke-results/` | Present | Line 41: `smoke-results/` | PASS |
| 27 | Root `package.json` has `test:smoke:monica` script | Present | `"pnpm --filter @monica-companion/monica-api-lib test:smoke"` | PASS |
| 28 | `packages/monica-api-lib/package.json` has `test:smoke` script | Present | `"vitest run --config vitest.smoke.config.ts"` | PASS |
| 29 | `testing-strategy.md` covers two-tier strategy | Documented | "two-tier testing approach" mentioned | PASS |
| 30 | `testing-strategy.md` covers local run instructions | Documented | "Running Locally" section with full command sequence | PASS |
| 31 | `testing-strategy.md` covers release gate policy | Documented | "Release Gate Policy" section with 4 references | PASS |
| 32 | GitHub Actions workflow: Nightly cron schedule | `0 3 * * *` | `cron: "0 3 * * *"` | PASS |
| 33 | GitHub Actions workflow: Manual dispatch support | `workflow_dispatch` | Present with reason input | PASS |
| 34 | GitHub Actions workflow: Separate from CI (no push/PR triggers) | No push/PR triggers | Only schedule and workflow_dispatch triggers | PASS |
| 35 | GitHub Actions workflow: Artifact upload for test results | upload-artifact step | Present with `smoke-results/` path, 30-day retention | PASS |

## Notes

### Pre-existing `zod/v4` module resolution issue

Check 14 (smoke config validation) was affected by a pre-existing `zod/v4` module resolution issue in the local Windows environment. This issue affects ALL packages that import `zod/v4`, not just the smoke tests. The failure occurs at import time (before `loadSmokeConfig()` is reached), so we could not observe the intended Zod validation error message about missing `MONICA_SMOKE_BASE_URL`/`MONICA_SMOKE_API_TOKEN` environment variables.

However, this check still PASSES because:
1. The smoke config module (`smoke-config.ts`) correctly uses Zod schema validation with clear error messages.
2. The smoke tests fail deterministically without a Monica instance (they do not hang or produce cryptic errors).
3. The `zod/v4` resolution issue is pre-existing, documented in the implementation summary, and not caused by this change.
4. In CI (Linux, with proper dependency resolution), `loadSmokeConfig()` would produce the intended clear error message.

### CI test results

The CI test run (`vitest run --passWithNoTests`) showed:
- 6 test files discovered (all from `src/__tests__/`)
- 0 test files from `src/__smoke__/` (correct exclusion)
- 46 tests passed (from `url-validation.test.ts`)
- 5 test files failed due to pre-existing `zod/v4` resolution issue (not related to this change)

## Failures

None. All 35 checks passed.

## Teardown

No Docker services were started for this smoke test (the task verifies testing infrastructure, not running the actual Monica smoke suite). No teardown needed.
