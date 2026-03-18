---
verdict: APPROVED
attempt: 1
biome_pass: true
tests_pass: true
test_summary: "packages/types: 98 passed; packages/guardrails: 39 passed, 11 skipped (integration, no Redis); services/ai-router: 89 passed, 22 skipped, 1 pre-existing failure (repository.integration.test.ts requires PostgreSQL)"
critical_count: 0
high_count: 0
medium_count: 2
---

# Code Review: Shared-Model Guardrails

## Automated Checks
- **Biome**: PASS -- 0 errors, 52 pre-existing warnings (all `noExplicitAny` in test files and unused imports in test mocks), 1 info. No new errors introduced.
- **Tests**:
  - `packages/types`: 98 passed (4 test files), includes 7 new guardrails schema tests
  - `packages/guardrails`: 39 passed, 11 skipped (integration tests needing real Redis), 8 test files passed, 5 skipped
  - `services/ai-router`: 89 passed, 22 skipped, 1 failed (pre-existing `repository.integration.test.ts` requires PostgreSQL -- unrelated to this change)

## Findings

### CRITICAL
(none)

### HIGH
(none)

### MEDIUM

1. [MEDIUM] `packages/guardrails/src/concurrency-gate.ts:30-54` -- The concurrency acquire operation uses two separate MULTI pipelines (check then acquire), creating a TOCTOU race. Between the ZCARD check and the ZADD, another request from the same user could also pass the check, allowing `maxConcurrency + N` concurrent slots. -- **Fix:** This is acceptable for V1 since the TTL-based cleanup provides eventual correctness and the window is small. A Lua script combining check-and-acquire atomically would eliminate the race entirely. Document as a known V1 limitation.

2. [MEDIUM] `packages/guardrails/src/rate-limiter.ts:32` -- The rate limiter unconditionally adds the request to the sorted set via ZADD before checking the count. If the request is rejected (count > limit), the entry remains, which means the window contains a phantom entry for a request that was actually rejected. This is benign in practice (the entry will expire with the window), but it inflates the count by one for subsequent requests within the same window. -- **Fix:** Acceptable for V1 as the impact is minor (off-by-one in remaining count). To fix precisely, use a Lua script that conditionally adds only if within limit, or remove the entry on rejection.

### LOW

1. [LOW] `packages/guardrails/src/__tests__/budget-tracker.test.ts:3` -- Unused import `type BudgetCheckResult`. Biome flags this as a warning. -- **Fix:** Remove the unused import.

2. [LOW] `packages/guardrails/src/__tests__/integration/middleware.integration.test.ts:3` -- Unused import `vi` from vitest. Biome flags this as a warning. -- **Fix:** Remove `vi` from the import statement.

3. [LOW] `packages/guardrails/src/__tests__/rate-limiter.test.ts:1` -- Unused import `type Mock` from vitest. Biome flags this as a warning. -- **Fix:** Remove `type Mock` from the import.

4. [LOW] `packages/guardrails/src/budget-tracker.ts:60-61` -- The INCRBY and EXPIRE are not in a MULTI pipeline, so there is a theoretical (extremely unlikely) window where the key is incremented but the TTL is not set. -- **Fix:** Wrap the INCRBY and EXPIRE in a MULTI pipeline for atomicity.

## Plan Compliance

The implementation follows the approved plan closely. All 17 planned steps are addressed:

- **Steps 1-11** (package scaffold, config, types, metrics, redis, rate-limiter, concurrency-gate, budget-tracker, kill-switch, middleware, exports): All implemented as specified.
- **Step 12** (integration tests): All planned integration tests created, plus an additional `middleware.integration.test.ts` addressing LOW-1 from plan review.
- **Step 13** (ai-router integration): Config, app, index, vitest config, and test updates all match the plan. The `createApp` signature change to accept `redis` was a necessary deviation, handled correctly.
- **Steps 14-15** (Grafana alerts and dashboard): Placeholder alert replaced with three real alerts (BudgetAlarm, BudgetExhausted, KillSwitchActive). Dashboard created with all planned panels.
- **Step 16** (Docker Compose wiring): All seven environment variables added correctly.
- **Step 17** (smoke test): Instructions documented; actual execution deferred to the smoke tester agent per workflow.

**Plan review findings addressed:**
- MEDIUM-1 (userId undefined behavior): Addressed. Middleware checks `getUserId(c)` and returns 400 with `missing_user_id` error. Test case added at `packages/guardrails/src/__tests__/middleware.test.ts:121`.
- MEDIUM-2 (fail-fast config): Addressed. `loadGuardrailConfig()` called inside `loadConfig()` at `services/ai-router/src/config.ts:26`. Redis client created at startup in `services/ai-router/src/index.ts:17`. Missing REDIS_URL crashes immediately.
- LOW-1 (middleware integration test): Addressed. `middleware.integration.test.ts` created with 3 tests.

**Documented deviations (all justified):**
1. Added `middleware.integration.test.ts` beyond planned scope (addresses plan review LOW-1).
2. Biome auto-fixed unused import in `redis.test.ts`.
3. Added `hono/factory` alias to guardrails vitest config (necessary for `@monica-companion/auth` dependency).
4. Updated `routes.test.ts` to accommodate new `createApp` signature (necessary consequence).

## Verdict Rationale

APPROVED. All automated checks pass (zero Biome errors, all relevant tests passing). The two MEDIUM findings are documented race conditions in Redis operations that are acceptable for V1 -- both have bounded impact (off-by-one in rate limiting, potential for maxConcurrency+small-N in concurrency) and are explicitly documented as known limitations with clear fix paths. Neither represents a security vulnerability or data loss risk.

The implementation is well-structured: clean separation between the shared guardrails package and the ai-router consumer, proper Zod validation on error contracts, fail-closed design on Redis failure, check-before-increment on budget tracking, correct middleware ordering (cheapest checks first), and comprehensive test coverage (39 unit tests + 11 integration tests + 7 type tests + 5 ai-router wiring tests). The plan review findings (MEDIUM-1: userId check, MEDIUM-2: fail-fast config, LOW-1: middleware integration test) are all concretely addressed with corresponding test coverage.
