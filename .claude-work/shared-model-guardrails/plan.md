# Implementation Plan: Shared-Model Guardrails

## Objective

Protect shared OpenAI resources (GPT for intent parsing, Whisper for transcription) from overuse and runaway costs in the V1 multi-user deployment. The system uses a single operator-provided OpenAI API key shared across all users. This task group adds per-user rate limiting, per-user concurrency caps, cumulative budget tracking with alarms, an operator kill switch for degraded mode, and user-facing fallback behavior when AI capacity is unavailable.

## Scope

### In Scope

- A new shared package `@monica-companion/guardrails` containing Redis-backed per-user rate limiting, concurrency gating, budget tracking, and kill-switch logic.
- Integration into `ai-router` for GPT request guardrails.
- Operator-configurable limits via environment variables (no database-driven per-user config in V1).
- Redis-backed state for rate counters, concurrency semaphores, and cumulative cost tracking.
- OTel metrics for budget burn, rate-limit rejections, concurrency rejections, and kill-switch activations.
- Grafana alert rules replacing the existing `quota-exhaustion-placeholder` with real budget alarms.
- A Grafana dashboard panel for OpenAI budget burn rate visibility.
- User-facing degraded-mode error responses when guardrails trigger.
- Operator kill switch via Redis key that immediately blocks new AI requests.
- `ioredis` dependency added to the workspace catalog (required for Redis client operations).
- Hono middleware that composes all checks into a single guard for protected routes.
- **Terminology note:** The roadmap item says "request-size limits." This plan implements that as per-user rate limits (requests per sliding window) combined with per-user concurrency caps and cumulative budget tracking. These mechanisms together bound total request volume, concurrency, and cost -- which is the intent behind "request-size limits" in the product definition context of shared-model protection.

### Out of Scope

- **`voice-transcription` guardrails.** The `voice-transcription` service has no auth infrastructure (no `@monica-companion/auth` dependency, no `serviceAuth` middleware, no JWT handling). The guardrail middleware requires authenticated `userId` from the JWT context to enforce per-user limits. Adding auth to `voice-transcription` is a prerequisite that belongs to Phase 4 (when the service itself is built). Whisper guardrails will be added alongside that work.
- Per-user customizable quotas or BYOK (bring your own OpenAI key) -- deferred per product-definition.md.
- Billing system or metered usage tracking beyond operator-level budget alarms.
- Token-level cost tracking from actual OpenAI response headers (V1 uses estimated cost from request size; actual token counting can be refined later).
- Database-persisted budget ledger (V1 uses Redis with periodic metric export; durable audit comes in Phase 5 operational review).
- Changes to `scheduler`, `delivery`, `telegram-bridge`, or `monica-integration` (guardrails apply at the point of AI model invocation only).

## Affected Services & Packages

| Package/Service | Changes |
|-----------------|---------|
| `packages/guardrails` (NEW) | New shared package: rate limiter, concurrency gate, budget tracker, kill switch, Hono middleware, Zod config schemas, OTel metrics. |
| `packages/types` | New Zod schemas for guardrail error responses (quota exhausted, rate limited, service degraded). |
| `services/ai-router` | Import guardrails middleware, apply to GPT-calling routes, add config env vars, add Redis connection. |
| `docker-compose.yml` | Add `REDIS_URL` and guardrail env vars to `ai-router` container. |
| `docker/grafana/provisioning/alerting/rules.yml` | Replace `quota-exhaustion-placeholder` with real budget alarm rules. |
| `docker/grafana/provisioning/dashboards/` | Add OpenAI budget burn dashboard panel. |
| `pnpm-workspace.yaml` | Add `ioredis` to workspace catalog. |

## Implementation Steps

### Step 1: Add `ioredis` to workspace catalog and guardrails package scaffold

**What:** Create the `packages/guardrails` package directory with `package.json`, `tsconfig.json`, `tsup.config.ts`, `vitest.config.ts`, and an empty `src/index.ts`. Add `ioredis` to the `pnpm-workspace.yaml` catalog with an exact pinned version (verify latest stable on npmjs.com before pinning). The package depends on `ioredis`, `zod`, `hono`, and `@opentelemetry/api`.

**Files to create:**
- `packages/guardrails/package.json`
- `packages/guardrails/tsconfig.json`
- `packages/guardrails/tsup.config.ts`
- `packages/guardrails/vitest.config.ts`
- `packages/guardrails/src/index.ts` (empty export)

**Files to modify:**
- `pnpm-workspace.yaml` -- add `ioredis` with exact pinned version

**Dependencies in `packages/guardrails/package.json`:**
- `ioredis: "catalog:"`
- `zod: "catalog:"`
- `hono: "catalog:"`
- `@opentelemetry/api: "catalog:"`
- `@monica-companion/auth: "workspace:*"` (for `getUserId` and `getCorrelationId` context helpers)

**Expected outcome:** `pnpm install` succeeds. The new package is recognized in the workspace. No functionality yet.

### Step 2: Guardrail configuration schema

**What:** Define a Zod schema for all guardrail configuration values, loaded from environment variables.

**Files to create:**
- `packages/guardrails/src/config.ts`
- `packages/guardrails/src/__tests__/config.test.ts`

**Configuration values (all with sensible defaults):**
- `REDIS_URL` -- Redis connection string (required)
- `GUARDRAIL_RATE_LIMIT_PER_USER` -- max requests per user per window (default: 30)
- `GUARDRAIL_RATE_WINDOW_SECONDS` -- sliding window size in seconds (default: 60)
- `GUARDRAIL_CONCURRENCY_PER_USER` -- max concurrent requests per user (default: 3)
- `GUARDRAIL_BUDGET_LIMIT_USD` -- monthly budget ceiling in USD (default: 100)
- `GUARDRAIL_BUDGET_ALARM_THRESHOLD_PCT` -- percentage of budget to trigger alarm (default: 80)
- `GUARDRAIL_COST_PER_REQUEST_USD` -- estimated cost per request (default: 0.01)

**Design note:** Config field names are model-type-agnostic. When voice-transcription adds guardrails in Phase 4, it will use the same schema with its own env values. The `modelType` label is passed at middleware construction time, not at config time.

**TDD sequence:**
1. Write test: `loadGuardrailConfig` throws when `REDIS_URL` is missing.
2. Write test: `loadGuardrailConfig` applies all defaults when only `REDIS_URL` is provided.
3. Write test: `loadGuardrailConfig` correctly parses custom values.
4. Implement `loadGuardrailConfig` to pass all three.

### Step 3: Guardrail error contract types in `@monica-companion/types`

**What:** Add Zod schemas for the guardrail error response envelope so consuming services can validate guardrail responses if needed, and so the error shapes are documented as contracts. These types must exist before the middleware step that returns them.

**Files to create:**
- `packages/types/src/guardrails.ts`
- `packages/types/src/__tests__/guardrails.test.ts`

**Files to modify:**
- `packages/types/src/index.ts` (add exports)

**Schemas:**
- `GuardrailErrorResponse` -- discriminated union of `rate_limited | concurrency_exceeded | budget_exhausted | service_degraded` with corresponding fields:
  - `rate_limited`: `{ error: "rate_limited", message: string, retryAfterMs: number }`
  - `concurrency_exceeded`: `{ error: "concurrency_exceeded", message: string }`
  - `budget_exhausted`: `{ error: "budget_exhausted", message: string }`
  - `service_degraded`: `{ error: "service_degraded", message: string }`

**TDD sequence:**
1. Write test: each error type parses correctly.
2. Write test: unknown error type is rejected.
3. Implement schemas.

### Step 4: OTel metrics interface

**What:** Define and export the OTel metrics used by the guardrails package. This step creates the metrics module early so that Steps 6-9 can emit metrics without referencing a non-existent module.

**Files to create:**
- `packages/guardrails/src/metrics.ts`
- `packages/guardrails/src/__tests__/metrics.test.ts`

**Metrics to emit:**

| Metric name | Type | Labels | Description |
|-------------|------|--------|-------------|
| `guardrail.rate_limit.rejected_total` | Counter | `model_type`, `service` | Total rate-limit rejections |
| `guardrail.concurrency.rejected_total` | Counter | `model_type`, `service` | Total concurrency-gate rejections |
| `guardrail.budget.current_spend_usd` | Gauge | (none) | Current month cumulative spend in USD |
| `guardrail.budget.limit_usd` | Gauge | (none) | Configured budget limit |
| `guardrail.budget.alarm_active` | Gauge | (none) | 1 when spend exceeds alarm threshold, 0 otherwise |
| `guardrail.budget.exhausted_total` | Counter | (none) | Total budget-exhaustion rejections |
| `guardrail.kill_switch.active` | Gauge | (none) | 1 when kill switch is on |
| `guardrail.kill_switch.rejected_total` | Counter | `service` | Total kill-switch rejections |
| `guardrail.request.allowed_total` | Counter | `model_type`, `service` | Total requests that passed all guardrails |

**Implementation:** Create a `GuardrailMetrics` class that initializes OTel meters and exposes methods like `recordRateLimitRejection(modelType, service)`, `updateBudgetSpend(usd)`, `recordBudgetAlarm(active)`, etc. Provide a `createGuardrailMetrics()` factory using `metrics.getMeter("guardrails")`.

**TDD sequence:**
1. Write test: `createGuardrailMetrics` returns an object with all expected methods.
2. Write test: `recordRateLimitRejection` increments the counter (spy on OTel counter `.add()`).
3. Write test: `updateBudgetAlarm` sets the gauge value.
4. Implement.

### Step 5: Redis connection factory

**What:** A thin wrapper that creates and exports an ioredis client from a connection URL, with reconnect strategy and connection error logging. Includes a graceful shutdown helper.

**Files to create:**
- `packages/guardrails/src/redis.ts`
- `packages/guardrails/src/__tests__/redis.test.ts`

**TDD sequence:**
1. Write test: `createRedisClient` returns an ioredis instance configured with the given URL.
2. Write test: `closeRedisClient` calls `quit()` on the client.
3. Implement both functions.

### Step 6: Per-user rate limiter (sliding window counter)

**What:** Implement a Redis-backed sliding window rate limiter. Uses a sorted set per user/model-type key with timestamps as scores.

**Files to create:**
- `packages/guardrails/src/rate-limiter.ts`
- `packages/guardrails/src/__tests__/rate-limiter.test.ts`

**Interface:**
```typescript
interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAtMs: number;
}

async function checkRateLimit(
  redis: Redis,
  userId: string,
  modelType: string,
  limit: number,
  windowSeconds: number,
  metrics: GuardrailMetrics,
  service: string,
): Promise<RateLimitResult>;
```

**TDD sequence:**
1. Write test: first request within limit returns `{ allowed: true, remaining: limit-1 }`.
2. Write test: request exceeding limit returns `{ allowed: false, remaining: 0 }`.
3. Write test: requests after window expires are allowed again (use fake time).
4. Write test: OTel counter is incremented on rejection (spy on metrics).
5. Implement using Redis MULTI pipeline (ZREMRANGEBYSCORE, ZCARD, ZADD, EXPIRE).

### Step 7: Per-user concurrency gate (Redis semaphore)

**What:** Implement a Redis-backed concurrency semaphore.

**Files to create:**
- `packages/guardrails/src/concurrency-gate.ts`
- `packages/guardrails/src/__tests__/concurrency-gate.test.ts`

**Interface:**
```typescript
interface ConcurrencyGateResult {
  acquired: boolean;
  currentConcurrency: number;
}

async function acquireConcurrency(
  redis: Redis,
  userId: string,
  modelType: string,
  requestId: string,
  maxConcurrency: number,
  metrics: GuardrailMetrics,
  service: string,
  ttlSeconds?: number, // default 120
): Promise<ConcurrencyGateResult>;

async function releaseConcurrency(
  redis: Redis,
  userId: string,
  modelType: string,
  requestId: string,
): Promise<void>;
```

**`requestId` source:** The middleware (Step 10) obtains the `requestId` by calling `getCorrelationId(c)` from `@monica-companion/auth`. If the correlation ID is not set (defensive), it falls back to `crypto.randomUUID()`.

**TDD sequence:**
1. Write test: first acquire within limit returns `{ acquired: true }`.
2. Write test: acquire at limit returns `{ acquired: false }`.
3. Write test: release then acquire succeeds.
4. Write test: stale entries (past TTL) are cleaned before checking cardinality.
5. Write test: OTel counter incremented on rejection.
6. Implement using Redis MULTI pipeline.

### Step 8: Budget tracker (cumulative counter with alarm threshold)

**What:** Implement Redis-based cumulative budget tracking with check-before-increment logic.

**Files to create:**
- `packages/guardrails/src/budget-tracker.ts`
- `packages/guardrails/src/__tests__/budget-tracker.test.ts`

**Interface:**
```typescript
interface BudgetCheckResult {
  allowed: boolean;
  currentSpendUsd: number;
  budgetLimitUsd: number;
  alarmTriggered: boolean;
}

async function recordAndCheckBudget(
  redis: Redis,
  costUsd: number,
  budgetLimitUsd: number,
  alarmThresholdPct: number,
  metrics: GuardrailMetrics,
): Promise<BudgetCheckResult>;

async function getCurrentSpend(redis: Redis): Promise<number>;
```

**Design decisions:**
- Monthly key auto-expires after 35 days (self-cleaning).
- Cost is stored as integer cents to avoid floating-point drift (INCRBY with cents).
- **Check-before-increment:** `recordAndCheckBudget` first issues a `GET` on the monthly budget key. If the current spend already equals or exceeds the budget limit, it returns `{ allowed: false }` immediately without incrementing. Only if the pre-check passes does it issue `INCRBY` with the cost amount and re-check the post-increment value.

**TDD sequence:**
1. Write test: first request with cost below budget returns `{ allowed: true, alarmTriggered: false }`.
2. Write test: request pushing spend past alarm threshold returns `{ alarmTriggered: true, allowed: true }`.
3. Write test: request pushing spend past 100% returns `{ allowed: false }`.
4. Write test: when budget is already exhausted, GET-only path returns `{ allowed: false }` without INCRBY.
5. Write test: monthly key rollover (different month key).
6. Write test: OTel gauge updates on alarm state change.
7. Implement.

### Step 9: Kill switch (Redis flag)

**What:** Implement an operator kill switch as a simple Redis key (`guardrail:kill-switch`).

**Files to create:**
- `packages/guardrails/src/kill-switch.ts`
- `packages/guardrails/src/__tests__/kill-switch.test.ts`

**Interface:**
```typescript
async function isKillSwitchActive(redis: Redis): Promise<boolean>;
async function setKillSwitch(redis: Redis, active: boolean): Promise<void>;
```

**TDD sequence:**
1. Write test: returns `false` when key does not exist.
2. Write test: returns `true` when key is set to `"on"`.
3. Write test: `setKillSwitch(redis, false)` deletes the key.
4. Write test: OTel gauge reflects kill-switch state.
5. Implement.

### Step 10: Guardrail middleware (Hono middleware composing all checks)

**What:** Create a Hono middleware factory that composes kill switch, rate limit, concurrency, and budget checks into a single guard. The middleware extracts `userId` from the Hono context (set by `serviceAuth`), runs the checks in order (cheapest first: kill switch, then rate limit, then budget, then concurrency acquire), and either continues to the handler or returns an appropriate error response. On handler completion (success or failure), it releases the concurrency semaphore.

**Files to create:**
- `packages/guardrails/src/middleware.ts`
- `packages/guardrails/src/__tests__/middleware.test.ts`

**Interface:**
```typescript
interface GuardrailMiddlewareOptions {
  redis: Redis;
  modelType: string;
  rateLimit: number;
  rateWindowSeconds: number;
  maxConcurrency: number;
  budgetLimitUsd: number;
  budgetAlarmThresholdPct: number;
  costEstimator: (c: Context) => number;
  metrics: GuardrailMetrics;
  service: string;
}

function guardrailMiddleware(options: GuardrailMiddlewareOptions): MiddlewareHandler;
```

**Error responses (JSON):**
- Kill switch active: `503 { error: "service_degraded", message: "AI features are temporarily disabled. Please try again later." }`
- Rate limited: `429 { error: "rate_limited", message: "You've sent too many requests. Please wait a moment and try again.", retryAfterMs: <number> }`
- Budget exhausted: `503 { error: "budget_exhausted", message: "AI features are temporarily unavailable. The operator has been notified." }`
- Concurrency exceeded: `429 { error: "concurrency_exceeded", message: "Your previous request is still being processed. Please wait for it to complete." }`

**TDD sequence:**
1. Write test: request passes when all checks allow.
2. Write test: request blocked when kill switch is active (503).
3. Write test: request blocked when rate limit exceeded (429).
4. Write test: request blocked when budget exhausted (503).
5. Write test: request blocked when concurrency exceeded (429).
6. Write test: concurrency is released after successful handler execution.
7. Write test: concurrency is released even when handler throws.
8. Write test: checks run in correct order (kill switch first).
9. Write test: request returns 503 with `service_degraded` when Redis is unreachable (fail-closed).
10. Implement.

### Step 11: Export guardrails package public API

**What:** Wire up `packages/guardrails/src/index.ts` to export all public interfaces.

**Files to modify:**
- `packages/guardrails/src/index.ts`

### Step 12: Integration tests for guardrails against real Redis

**What:** Write integration tests that run against the real Redis container from Docker Compose.

**Files to create:**
- `packages/guardrails/src/__tests__/integration/rate-limiter.integration.test.ts`
- `packages/guardrails/src/__tests__/integration/concurrency-gate.integration.test.ts`
- `packages/guardrails/src/__tests__/integration/budget-tracker.integration.test.ts`
- `packages/guardrails/src/__tests__/integration/kill-switch.integration.test.ts`

### Step 13: Integrate guardrails into `ai-router`

**What:** Add the guardrails middleware to `ai-router`. Apply to routes that invoke GPT (after `serviceAuth`, before the route handler). Add `REDIS_URL` and guardrail config env vars.

**Files to modify:**
- `services/ai-router/package.json` -- add `@monica-companion/guardrails` dependency
- `services/ai-router/src/config.ts` -- add guardrail env vars to config schema
- `services/ai-router/src/__tests__/config.test.ts` -- update tests
- `services/ai-router/src/app.ts` -- apply `guardrailMiddleware` to GPT-calling routes
- `services/ai-router/src/index.ts` -- create/close Redis client in lifecycle
- `services/ai-router/vitest.config.ts` -- add alias for `@monica-companion/guardrails` and `ioredis`
- `docker-compose.yml` -- add `REDIS_URL` and guardrail env vars to `ai-router` service

**TDD sequence:**
1. Write test: config loads with guardrail fields and defaults.
2. Write test: config throws when `REDIS_URL` is missing.
3. Write test: guardrail middleware is applied before GPT route handler (after auth).
4. Write test: `/health` endpoint is not affected by guardrails.
5. Implement changes.

### Step 14: Replace Grafana alert placeholder with real budget alarms

**What:** Replace the `quota-exhaustion-placeholder` alert rule with real alerts.

**Files to modify:**
- `docker/grafana/provisioning/alerting/rules.yml`

**New alert rules:**
1. `BudgetAlarm` (severity: warning) -- fires when `guardrail_budget_alarm_active == 1` for more than 1 minute.
2. `BudgetExhausted` (severity: critical) -- fires when `guardrail_budget_current_spend_usd >= guardrail_budget_limit_usd` for more than 1 minute.
3. `KillSwitchActive` (severity: info) -- fires when `guardrail_kill_switch_active == 1` for more than 1 minute.

### Step 15: Grafana dashboard panel for budget burn

**What:** Add a new `openai-budget.json` dashboard.

**Files to create or modify:**
- `docker/grafana/provisioning/dashboards/openai-budget.json` (NEW)

### Step 16: Docker Compose environment variable wiring

**What:** Add all guardrail environment variables to the `ai-router` service in `docker-compose.yml`.

**Files to modify:**
- `docker-compose.yml`

**Variables to add to `ai-router`:**
```yaml
REDIS_URL: redis://redis:6379
GUARDRAIL_RATE_LIMIT_PER_USER: ${GUARDRAIL_RATE_LIMIT_PER_USER:-30}
GUARDRAIL_RATE_WINDOW_SECONDS: ${GUARDRAIL_RATE_WINDOW_SECONDS:-60}
GUARDRAIL_CONCURRENCY_PER_USER: ${GUARDRAIL_CONCURRENCY_PER_USER:-3}
GUARDRAIL_BUDGET_LIMIT_USD: ${GUARDRAIL_BUDGET_LIMIT_USD:-100}
GUARDRAIL_BUDGET_ALARM_THRESHOLD_PCT: ${GUARDRAIL_BUDGET_ALARM_THRESHOLD_PCT:-80}
GUARDRAIL_COST_PER_REQUEST_USD: ${GUARDRAIL_COST_PER_REQUEST_USD:-0.01}
```

### Step 17: Smoke test

**What:** Run Docker Compose with the app profile, verify:
1. `ai-router` starts successfully with Redis connected.
2. `/health` endpoint responds 200.
3. Kill switch via `redis-cli SET guardrail:kill-switch on` causes 503 on guarded routes.
4. Clearing kill switch restores normal operation.

## Test Strategy

### Unit tests (Vitest)

**`packages/guardrails` unit tests:**
- Config: pure Zod parsing, no mocks.
- Metrics: spy on `@opentelemetry/api` counter/gauge creation.
- Rate limiter: mock ioredis `multi()` chain.
- Concurrency gate: mock ioredis.
- Budget tracker: mock ioredis GET and INCRBY. Verify check-before-increment.
- Kill switch: mock ioredis GET/SET/DEL.
- Middleware: mock all sub-modules. Verify composition order, error responses, concurrency release, fail-closed on Redis error.
- Redis factory: mock ioredis constructor.

**`services/ai-router` unit tests:**
- Config: verify guardrail fields parse correctly.
- App: verify guardrail middleware applied after serviceAuth.

### Integration tests

- `packages/guardrails` integration tests (Step 12) need real Redis on `localhost:6379`.

## Smoke Test Strategy

### Services to start

```bash
docker compose up -d postgres redis
docker compose --profile app up -d ai-router
```

### What the smoke test proves

- Redis connectivity works in the Docker network.
- Guardrail middleware is wired into the real service startup path.
- Kill switch immediately affects request handling without redeployment.
- Health endpoints are unaffected by guardrails.

## Security Considerations

- **No new public endpoints.** All guardrail logic is internal middleware.
- **Kill switch operates via Redis.** Only accessible on Docker internal network.
- **Fail-closed design.** Redis failure returns 503, not pass-through.
- **Auth prerequisite.** Guardrail middleware runs after `serviceAuth`.
- **No PII in metrics.** Metrics labeled by `model_type` and `service`, not `userId`.
- **No secrets in error responses.** Only `retryAfterMs` is dynamic.

## Review Findings Addressed

| Finding | Severity | Resolution |
|---------|----------|------------|
| HIGH-1: voice-transcription lacks auth | HIGH | Removed from scope. Deferred to Phase 4. |
| MEDIUM-1: Budget inflation on rejected requests | MEDIUM | Check-before-increment in Step 8. |
| MEDIUM-2: OTel metrics ordering | MEDIUM | Metrics module moved to Step 4. |
| MEDIUM-3: Missing Redis failure test | MEDIUM | Added Step 10 test case 9. |
| LOW-1: Missing hono dependency | LOW | Added to Step 1. |
| LOW-2: requestId source unspecified | LOW | Documented in Steps 7 and 10. |
| LOW-3: Error types step ordering | LOW | Moved to Step 3. |
| LOW-4: Terminology mismatch | LOW | Noted in Scope section. |

## Risks & Open Questions

1. **Cost estimation accuracy.** V1 uses flat per-request cost estimates. Refinement deferred to Phase 5.
2. **Redis as SPOF for guardrails.** Fail-closed is correct for V1.
3. **Kill switch operator UX.** V1 uses direct `redis-cli`. Future admin API out of scope.
4. **ioredis version.** Must verify latest stable before pinning.
5. **Monthly budget key rollover.** Resets on 1st of month UTC.
6. **No per-user budget.** Single global budget. Per-user deferred.
7. **voice-transcription guardrails deferred.** No unguarded production traffic since the service has no endpoints yet.
