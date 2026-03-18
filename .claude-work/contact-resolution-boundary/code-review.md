---
verdict: APPROVED
attempt: 1
biome_pass: true
tests_pass: true
test_summary: "types: 59 passed, 0 failed; ai-router: 84 passed, 0 failed, 22 skipped (pre-existing integration)"
critical_count: 0
high_count: 0
medium_count: 2
---

# Code Review: Contact Resolution Boundary

## Automated Checks
- **Biome**: pass -- 0 errors, 20 warnings (19 pre-existing in `commands.test.ts` and `repository.integration.test.ts`; 1 new minor warning in `routes.test.ts:6` for unused mock parameter `c`)
- **Tests (packages/types)**: 59 passed, 0 failed (2 test files)
- **Tests (services/ai-router)**: 84 passed, 0 failed, 22 skipped (8 test files pass; 1 pre-existing integration test file skipped due to no PostgreSQL)

## Findings

### CRITICAL
(none)

### HIGH
(none)

### MEDIUM

1. [MEDIUM] `services/ai-router/src/contact-resolution/routes.ts:42-48` -- **New `createServiceClient` instantiated on every request.** While the `ServiceClient` object is lightweight (just wraps fetch with JWT signing), creating it per-request means a new JWT is signed for every inbound call. This is functionally correct but wasteful. If contact resolution is called frequently, this adds latency from repeated JWT signing operations. -- **Fix:** Consider extracting the `serviceClient` creation to the route factory level (once when `contactResolutionRoutes(config)` is called), or cache with a short TTL. Not blocking for V1 since the overhead is small, but worth noting for optimization.

2. [MEDIUM] `services/ai-router/src/contact-resolution/routes.ts:27,42` -- **`correlationId` from request body is validated but silently ignored in favor of JWT context value.** The `ContactResolutionRequest` schema requires a `correlationId` field, Zod validates it, but the route handler uses `getCorrelationId(c)` from the JWT/middleware context instead. This creates a confusing contract where callers must provide a `correlationId` in the body but that value is not used. -- **Fix:** Either remove `correlationId` from `ContactResolutionRequest` schema (since it comes from JWT context), or validate that `parsed.data.correlationId === correlationId` and reject mismatches with 400. This aligns with the principle of least surprise for API callers.

### LOW

1. [LOW] `services/ai-router/src/contact-resolution/__tests__/routes.test.ts:6` -- Unused parameter `c` in mock `otelMiddleware` triggers Biome warning. -- **Fix:** Rename to `_c` per Biome's suggestion.

2. [LOW] `services/ai-router/vitest.config.ts:5` -- Hardcoded `hono@4.12.8` version in pnpm store path is fragile and will break on version bumps. -- **Fix:** This is a pre-existing pattern (zod, drizzle-orm, postgres are also hardcoded). Document this as tech debt or explore `server.deps.inline` in vitest config. Already noted in impl-summary residual risks.

3. [LOW] `services/ai-router/src/contact-resolution/matcher.ts:97-108` -- The first+last name alias check uses `queryParts[0]` and `queryParts[queryParts.length - 1]`, which means for a 3-word query like "John Michael Doe", it checks aliases for "john" and "doe" but ignores "michael". This is fine for V1 but may produce false positives for names that share first/last components. -- **Fix:** Acceptable for V1. Consider stricter matching if benchmark results reveal issues.

4. [LOW] `services/ai-router/src/contact-resolution/client.ts:3` -- Import from `zod/v4` is correct for this project's Zod 4 setup, but the `z.infer` usage on line 32 could be simplified to just using the `ContactResolutionSummary` type directly since it's already exported as a type from the types package. -- **Fix:** Replace `z.infer<typeof ContactResolutionSummary>[]` with `ContactResolutionSummary[]` using the type import from `@monica-companion/types`.

## Plan Compliance

The implementation follows the approved plan across all 8 steps:

1. **Step 1 (schemas)**: All Zod schemas (`MatchReason`, `ContactMatchCandidate`, `ResolutionOutcome`, `ContactResolutionResult`, `ContactResolutionRequest`) added to `packages/types` with 20 new tests. `userId` correctly removed from `ContactResolutionRequest` per MEDIUM-1 finding. `correlationId` has `.min(1)` per LOW-4 finding.

2. **Step 2 (config)**: `MONICA_INTEGRATION_URL` added to config schema and interface with 2 tests.

3. **Step 3 (client)**: HTTP client using `ServiceClient` with Zod validation and `AbortSignal.timeout(30_000)` per MEDIUM-2 finding. 6 tests covering success, HTTP errors, invalid body, network failure, empty results, and timeout signal.

4. **Step 4 (matcher)**: Pure deterministic matching with kinship normalization, scoring tiers, and tiebreaker rules. 22 tests covering all plan-specified scenarios including the single-char prefix test (LOW-3).

5. **Step 5 (resolver)**: Orchestrator composing client + matcher with named threshold constants. 7 tests.

6. **Step 6 (boundary enforcement)**: Static analysis test scanning all non-test `.ts` files for forbidden imports.

7. **Step 7 (routes)**: `POST /internal/resolve-contact` with `serviceAuth`, Zod validation, `requireUserId` from JWT. 5 tests for 200/400/502/401.

8. **Step 8 (Docker Compose)**: `MONICA_INTEGRATION_URL` env var and `depends_on: monica-integration` added.

**Justified deviations:**
- `vitest.config.ts` alias extensions (required for test resolution)
- `requireUserId` helper created in `lib/` (follows monica-integration pattern)
- `@monica-companion/redaction` not added as direct dependency (PII is simply not logged)

All three are reasonable and documented in the implementation summary.

**Plan review findings addressed:**
- MEDIUM-1 (userId from JWT): Addressed -- removed from schema, extracted via `requireUserId(c)`
- MEDIUM-2 (explicit timeout): Addressed -- `AbortSignal.timeout(30_000)`
- MEDIUM-3 (redaction in logging): Addressed -- only safe attributes logged (outcome, candidateCount, correlationId)
- LOW-1 through LOW-4: All addressed as documented

## Verdict Rationale

**APPROVED.** All automated checks pass (zero Biome errors, all tests green). The implementation faithfully follows the approved plan across all 8 steps and addresses all plan review findings. Architecture boundaries are properly enforced with a static analysis test. Security is sound: service-to-service JWT auth on the endpoint, userId from JWT subject, no PII in logs, Zod validation on all inbound payloads, no Monica credentials visible to ai-router. The two MEDIUM findings are advisory improvements (per-request client creation and unused body correlationId) that do not represent correctness, security, or reliability issues -- they are optimization and API clarity suggestions appropriate for future refinement.
