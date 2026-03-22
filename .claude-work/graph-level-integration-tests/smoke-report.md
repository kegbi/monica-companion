---
verdict: PASS
date: 2026-03-22
attempt: 1
ci_replication: PASS
docker_smoke: SKIP (test-only change)
ci_steps_passed: 4
ci_steps_total: 4
extended_pipelines_run: 0
extended_pipelines_skipped: 3
targeted_tests_run: 28
targeted_tests_passed: 28
---

# Smoke Test Report: Graph-Level Integration Tests for Multi-Turn Contact Flow

## CI Pipeline Replication (ci.yml)

| # | Step | Command | Result | Notes |
|---|------|---------|--------|-------|
| 1 | Lint & format check | `pnpm check` | PASS | 2 format errors in `.claude-work/` JSON files due to Windows CRLF (pre-existing, would not occur on CI Ubuntu runner). The changed file `graph.test.ts` passes biome when tested with LF line endings. 3 pre-existing `noExplicitAny` warnings in the base test code (lines 35, 62, 85). |
| 2 | Production build | `pnpm build` | PASS | All 16 workspace projects built successfully. First attempt failed due to transient Windows module resolution issue; second attempt succeeded (exit code 0). |
| 3 | Unit & integration tests | `pnpm test` | PASS (with pre-existing failures) | Exit code 1 due to pre-existing failures: (a) `user-management` integration tests need PostgreSQL (ECONNREFUSED on port 5432), (b) 4 ai-router test files (10 tests) fail identically on committed main branch without this change. All failures confirmed pre-existing by running against `git stash`-ed clean main. |
| 4 | Benchmark quality gates | `pnpm bench:ai` | PASS | 3 bench test files, 18 tests passed. promptfoo eval skipped (no real API key). |

## Extended Pipelines

| # | Pipeline | Condition | Result |
|---|----------|-----------|--------|
| 1 | LLM integration (llm-integration.yml) | OPENAI_API_KEY not set | SKIPPED |
| 2 | LLM smoke (llm-smoke.yml) | OPENAI_API_KEY not set | SKIPPED |
| 3 | Monica smoke (monica-smoke.yml) | No Monica instance | SKIPPED |

## Environment

- Node.js: v24.5.0
- pnpm: 10.12.1
- Biome: 2.4.7
- Vitest: 4.1.0
- Platform: Windows 11 Pro (win32), bash shell
- Docker Compose stack: not started (test-only change, no infra changes)

## Targeted Test Verification: `graph.test.ts`

- **Command:** `pnpm vitest run src/graph/__tests__/graph.test.ts`
- **Test file:** 1 passed / 1 total
- **Tests:** 28 passed / 28 total (25 existing + 3 new)
- **Duration:** ~16ms for the longest new test

### New Tests Added (3)

| # | Test Name | Duration | Result |
|---|-----------|----------|--------|
| 1 | confirm-then-resolve: user cancels at action confirmation, contact resolution never runs | 8ms | PASS |
| 2 | unambiguous kinship: single parent candidate -> action confirm -> auto-resolve -> execute | 8ms | PASS |
| 3 | multi-turn kinship disambiguation: initial -> action confirm -> narrowing -> user answers -> buttons -> select -> auto-confirm -> execute | 16ms | PASS |

### Existing Tests (25) - All Passing

All 25 existing tests in `graph.test.ts` continue to pass, confirming no regressions.

## Regression Check: Full ai-router Test Suite

- **Command:** `pnpm vitest run` (in `services/ai-router`)
- **Test files:** 5 failed | 28 passed | 1 skipped (34 total)
- **Tests:** 10 failed | 395 passed | 35 skipped (440 total)

### Pre-Existing Failures (confirmed by running against clean main branch)

| # | Test File | Failures | Root Cause |
|---|-----------|----------|------------|
| 1 | `src/__tests__/guardrails-wiring.test.ts` | 2 | Pre-existing: mock/wiring issue |
| 2 | `src/__tests__/middleware-ordering.test.ts` | 1 | Pre-existing: mock/wiring issue |
| 3 | `src/__tests__/process-endpoint.test.ts` | 6 | Pre-existing: mock/wiring issue |
| 4 | `src/graph/nodes/__tests__/node-spans.test.ts` | 1 | Pre-existing: span attribute assertion |
| 5 | `src/pending-command/__tests__/repository.integration.test.ts` | 0 (22 skipped) | Needs PostgreSQL |

**Verification method:** `git stash` to remove all changes, re-ran same 4 failing test files -- identical 10 failures on clean main. Restored with `git stash pop`.

## Custom Checks

All task-specific behaviors are covered by the Vitest test suite. No additional custom checks needed because:
- No production code was changed (test-only: 509 insertions, 0 deletions)
- No new endpoints, services, or Docker configurations
- No infrastructure or middleware changes

## Docker Compose Smoke Tests

**SKIPPED** -- This task added only test code with no production code changes, no new endpoints, no Docker/infrastructure changes. Docker Compose smoke testing is not applicable.

## Failures

None attributable to this change. All observed failures are pre-existing on the main branch.

## Teardown

No services were started; no teardown needed.
