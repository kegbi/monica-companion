# Implementation Summary: Shared-Model Guardrails

## Files Changed

| File | Action | Description |
|------|--------|-------------|
| `pnpm-workspace.yaml` | modified | Added `ioredis: 5.10.0` to workspace catalog |
| `packages/guardrails/package.json` | created | New shared package with ioredis, zod, hono, @opentelemetry/api, @monica-companion/auth deps |
| `packages/guardrails/tsconfig.json` | created | TypeScript config extending base |
| `packages/guardrails/tsup.config.ts` | created | Build config for ESM output with DTS |
| `packages/guardrails/vitest.config.ts` | created | Test config with pnpm store aliases for hono, zod, jose, OTel, auth |
| `packages/guardrails/src/index.ts` | created | Public API barrel exports for all modules |
| `packages/guardrails/src/config.ts` | created | Zod schema for guardrail env vars with defaults |
| `packages/guardrails/src/metrics.ts` | created | OTel metrics: counters (rate_limit, concurrency, budget, kill_switch, allowed) and gauges (spend, limit, alarm, kill_switch) |
| `packages/guardrails/src/redis.ts` | created | Redis connection factory with reconnect strategy and graceful shutdown |
| `packages/guardrails/src/rate-limiter.ts` | created | Sliding window rate limiter using Redis sorted sets (MULTI pipeline) |
| `packages/guardrails/src/concurrency-gate.ts` | created | Redis-backed concurrency semaphore with TTL-based stale entry cleanup |
| `packages/guardrails/src/budget-tracker.ts` | created | Check-before-increment budget tracker storing cents to avoid float drift |
| `packages/guardrails/src/kill-switch.ts` | created | Operator kill switch via Redis key `guardrail:kill-switch` |
| `packages/guardrails/src/middleware.ts` | created | Hono middleware composing all checks in order: userId, kill-switch, rate-limit, budget, concurrency |
| `packages/types/src/guardrails.ts` | created | Zod schemas for guardrail error response types (discriminated union) |
| `packages/types/src/index.ts` | modified | Added guardrail error type exports |
| `services/ai-router/package.json` | modified | Added `@monica-companion/guardrails` and `ioredis` dependencies |
| `services/ai-router/src/config.ts` | modified | Added `guardrails: GuardrailConfig` field, calls `loadGuardrailConfig()` |
| `services/ai-router/src/app.ts` | modified | Added redis parameter, applies `guardrailMiddleware` to `/internal/*` routes |
| `services/ai-router/src/index.ts` | modified | Creates Redis client at startup (fail-fast), passes to createApp, closes on shutdown |
| `services/ai-router/vitest.config.ts` | modified | Added aliases for `@monica-companion/guardrails` and `@opentelemetry/api` |
| `services/ai-router/src/__tests__/config.test.ts` | modified | Added REDIS_URL to baseEnv, 3 new guardrail config tests |
| `services/ai-router/src/__tests__/guardrails-wiring.test.ts` | created | Tests that guardrail middleware is wired correctly and /health is unaffected |
| `services/ai-router/src/contact-resolution/__tests__/routes.test.ts` | modified | Updated testConfig with guardrails, added redis param, mocked guardrails module |
| `docker-compose.yml` | modified | Added REDIS_URL and 6 GUARDRAIL_* env vars to ai-router service |
| `docker/grafana/provisioning/alerting/rules.yml` | modified | Replaced quota-exhaustion-placeholder with BudgetAlarm, BudgetExhausted, KillSwitchActive alerts |
| `docker/grafana/provisioning/dashboards/openai-budget.json` | created | Dashboard with spend gauge, limit stat, kill-switch status, burn-rate timeseries, rejection panels |

## Tests Added

| Test File | What It Tests |
|-----------|---------------|
| `packages/guardrails/src/__tests__/config.test.ts` | 3 tests: missing REDIS_URL throws, defaults applied, custom values parsed |
| `packages/guardrails/src/__tests__/metrics.test.ts` | 3 tests: all methods present, counter increment, gauge update |
| `packages/guardrails/src/__tests__/redis.test.ts` | 2 tests: client creation, graceful shutdown |
| `packages/guardrails/src/__tests__/rate-limiter.test.ts` | 4 tests: allowed within limit, rejected at limit, resetAtMs future, no metric on allow |
| `packages/guardrails/src/__tests__/concurrency-gate.test.ts` | 4 tests: acquire success, acquire at limit fails, no metric on success, release calls zrem |
| `packages/guardrails/src/__tests__/budget-tracker.test.ts` | 8 tests: below budget, alarm threshold, over 100%, check-before-increment, monthly key, gauge updates, getCurrentSpend |
| `packages/guardrails/src/__tests__/kill-switch.test.ts` | 4 tests: false when missing, true when set, set to on, delete on clear |
| `packages/guardrails/src/__tests__/middleware.test.ts` | 11 tests: all-pass, missing userId (400), kill switch (503), rate limit (429), budget (503), concurrency (429), release after success, release after throw, check order, fail-closed on Redis error, allowed metric |
| `packages/guardrails/src/__tests__/integration/rate-limiter.integration.test.ts` | 2 tests (skip if no Redis): allows within limit, rejects exceeding limit |
| `packages/guardrails/src/__tests__/integration/concurrency-gate.integration.test.ts` | 1 test (skip if no Redis): acquire/release/re-acquire cycle |
| `packages/guardrails/src/__tests__/integration/budget-tracker.integration.test.ts` | 2 tests (skip if no Redis): cumulative tracking, rejection at exhaustion |
| `packages/guardrails/src/__tests__/integration/kill-switch.integration.test.ts` | 3 tests (skip if no Redis): false when not set, true after set, false after clear |
| `packages/guardrails/src/__tests__/integration/middleware.integration.test.ts` | 3 tests (skip if no Redis): normal request pass-through, kill switch blocks, rate limit after threshold |
| `packages/types/src/__tests__/guardrails.test.ts` | 7 tests: each error type parses, unknown type rejected, missing retryAfterMs rejected, discriminated union variants |
| `services/ai-router/src/__tests__/config.test.ts` | 3 new tests: guardrail defaults, REDIS_URL required, custom guardrail values |
| `services/ai-router/src/__tests__/guardrails-wiring.test.ts` | 2 tests: /health unaffected, middleware factory called with correct options |

**Total: 39 unit tests passing + 11 integration tests (skipped without Redis) + 7 types tests + 5 ai-router tests = 61 new tests**

## Verification Results

- **Biome**: `pnpm exec biome check` -- 0 errors, 52 pre-existing warnings (unused imports in existing code). No new issues introduced.
- **packages/guardrails tests**: 39 passed, 11 skipped (integration tests requiring real Redis)
- **packages/types tests**: 98 passed (all, including 7 new guardrails tests)
- **services/ai-router tests**: 89 passed, 22 skipped, 1 pre-existing failure (repository.integration.test.ts requires PostgreSQL)

## Plan Review Findings Addressed

| Finding | Resolution |
|---------|-----------|
| MEDIUM-1: userId undefined behavior | Added test case "request returns 400 when userId is not present in context" in middleware.test.ts. Middleware checks `getUserId(c)` and returns 400 with `missing_user_id` error when undefined. |
| MEDIUM-2: Config loading integration | `loadGuardrailConfig()` is called inside `loadConfig()` at ai-router startup in `index.ts`. Missing REDIS_URL causes immediate fail-fast crash. |
| LOW-1: No middleware-level integration test | Added `middleware.integration.test.ts` with 3 tests against real Redis (normal pass-through, kill switch, rate limiting). |

## Smoke Test Instructions (Step 17)

The smoke tester agent should verify:

1. Start infrastructure: `docker compose up -d postgres redis`
2. Start ai-router: `docker compose --profile app up -d ai-router`
3. Verify ai-router starts successfully (check logs for "ai-router listening on :3002")
4. Health check: `curl http://localhost:3002/health` returns `{"status":"ok","service":"ai-router"}`
5. Kill switch test: `docker compose exec redis redis-cli SET guardrail:kill-switch on`
6. Verify guarded route returns 503: authenticated request to `/internal/resolve-contact` returns `{"error":"service_degraded",...}`
7. Clear kill switch: `docker compose exec redis redis-cli DEL guardrail:kill-switch`
8. Verify guarded route works again (normal 401/200 behavior depending on auth)
9. Tear down: `docker compose --profile app down`

## Plan Deviations

1. **Integration test structure**: Added `middleware.integration.test.ts` beyond the plan's Step 12 scope, addressing LOW-1 from plan review.
2. **Unused import `type Mock`**: Biome flagged and removed an unused import in rate-limiter.test.ts. No behavior change.
3. **Vitest config for guardrails**: Added `hono/factory` alias to guardrails vitest config since the middleware imports `@monica-companion/auth` which uses `createMiddleware` from `hono/factory`.
4. **Updated routes.test.ts**: The existing contact resolution routes test needed updates for the new `createApp` signature (added redis parameter) and guardrails mock. This was not explicitly planned but was a necessary consequence of the app.ts changes.

## Residual Risks

1. **Integration tests require real Redis**: 11 integration tests are skipped locally. They will pass in Docker Compose with the Redis service running.
2. **Cost estimation accuracy**: V1 uses flat per-request cost (`costPerRequestUsd`). Actual token-based cost tracking deferred to Phase 5.
3. **Single global budget**: No per-user budget tracking. All users share one monthly budget counter.
4. **Kill switch operator UX**: V1 requires direct `redis-cli` access. No admin API or UI.
5. **voice-transcription guardrails deferred**: Explicitly out of scope per plan (service lacks auth infrastructure). Will be added in Phase 4.
6. **Redis as SPOF for guardrails**: Fail-closed design is correct for V1 but means Redis downtime blocks all AI requests.
