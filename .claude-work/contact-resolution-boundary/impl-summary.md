# Implementation Summary: Contact Resolution Boundary

## Files Changed
| File | Action | Description |
|------|--------|-------------|
| `packages/types/src/contact-resolution.ts` | modified | Added `MatchReason`, `ContactMatchCandidate`, `ResolutionOutcome`, `ContactResolutionResult`, `ContactResolutionRequest` Zod schemas |
| `packages/types/src/index.ts` | modified | Exported new schemas from barrel |
| `packages/types/src/__tests__/contact-resolution.test.ts` | modified | Added 20 tests for new schemas (MatchReason, ResolutionOutcome, ContactMatchCandidate, ContactResolutionResult, ContactResolutionRequest) |
| `services/ai-router/src/config.ts` | modified | Added `MONICA_INTEGRATION_URL` to config schema and `Config` interface |
| `services/ai-router/src/__tests__/config.test.ts` | modified | Added 2 tests for MONICA_INTEGRATION_URL parsing and required validation |
| `services/ai-router/src/contact-resolution/client.ts` | created | HTTP client to fetch contact summaries from monica-integration with Zod validation and explicit timeout |
| `services/ai-router/src/contact-resolution/__tests__/client.test.ts` | created | 6 tests covering valid response, HTTP errors, invalid body, network failure, empty results, and timeout signal |
| `services/ai-router/src/contact-resolution/matcher.ts` | created | Pure deterministic contact matching algorithm with kinship normalization, scoring tiers, and tiebreaker rules |
| `services/ai-router/src/contact-resolution/__tests__/matcher.test.ts` | created | 22 tests covering all scoring tiers, tiebreakers, edge cases, case insensitivity, compound queries, and boundary conditions |
| `services/ai-router/src/contact-resolution/resolver.ts` | created | Orchestrator composing client + matcher with ambiguity threshold logic |
| `services/ai-router/src/contact-resolution/__tests__/resolver.test.ts` | created | 7 tests for resolved/ambiguous/no_match outcomes, error propagation, and candidate limiting |
| `services/ai-router/src/contact-resolution/routes.ts` | created | POST /internal/resolve-contact Hono route with serviceAuth, Zod validation, and error handling |
| `services/ai-router/src/contact-resolution/__tests__/routes.test.ts` | created | 5 tests for HTTP 200/400/502/401 responses |
| `services/ai-router/src/contact-resolution/index.ts` | created | Barrel export for the contact-resolution module |
| `services/ai-router/src/lib/require-user-id.ts` | created | Helper to extract userId from JWT sub claim (following monica-integration pattern) |
| `services/ai-router/src/__tests__/boundary-enforcement.test.ts` | created | Static analysis test verifying ai-router never imports from monica-api-lib |
| `services/ai-router/src/app.ts` | modified | Wired contact resolution routes under /internal |
| `services/ai-router/vitest.config.ts` | modified | Added aliases for jose, hono subpaths, @opentelemetry/api-logs, and @monica-companion/redaction to fix dependency resolution |
| `docker-compose.yml` | modified | Added MONICA_INTEGRATION_URL env var and depends_on: monica-integration for ai-router |

## Tests Added
| Test File | What It Tests |
|-----------|---------------|
| `packages/types/src/__tests__/contact-resolution.test.ts` | Schema validation for MatchReason, ResolutionOutcome, ContactMatchCandidate, ContactResolutionResult, ContactResolutionRequest (20 new tests) |
| `services/ai-router/src/__tests__/config.test.ts` | MONICA_INTEGRATION_URL config parsing and required validation (2 new tests) |
| `services/ai-router/src/contact-resolution/__tests__/client.test.ts` | HTTP client: valid response parsing, HTTP errors, invalid body, network failure, empty results, timeout signal (6 tests) |
| `services/ai-router/src/contact-resolution/__tests__/matcher.test.ts` | Deterministic matching: exact displayName, first+last, relationship labels, kinship normalization, aliases, prefix match, duplicates, tiebreakers, case insensitivity, compound queries, edge cases (22 tests) |
| `services/ai-router/src/contact-resolution/__tests__/resolver.test.ts` | Resolution outcomes: resolved/ambiguous/no_match, error propagation, candidate limiting (7 tests) |
| `services/ai-router/src/contact-resolution/__tests__/routes.test.ts` | Route handler: 200 valid response, 400 invalid body, 400 empty contactRef, 502 upstream error, 401 missing auth (5 tests) |
| `services/ai-router/src/__tests__/boundary-enforcement.test.ts` | Static analysis: no imports from @monica-companion/monica-api-lib (1 test) |

## Verification Results
- **Biome**: `pnpm exec biome check --write` completed successfully. 15 files auto-formatted. 20 pre-existing warnings (all in files outside scope of this change).
- **Tests (packages/types)**: 59 passed, 0 failed (2 test files)
- **Tests (services/ai-router)**: 84 passed, 0 failed (8 test files). 1 pre-existing integration test file skipped (requires live PostgreSQL).

## Plan Review Findings Addressed

| Finding | Resolution |
|---------|------------|
| MEDIUM-1: UserId from JWT, not request body | Removed `userId` from `ContactResolutionRequest` schema. Route handler extracts userId from JWT `sub` claim via `requireUserId(c)`. |
| MEDIUM-2: Explicit timeout on HTTP client | Added `AbortSignal.timeout(30_000)` to `fetchContactSummaries()`. Test verifies signal is passed. |
| MEDIUM-3: Redaction in logging | Route handler logs only safe attributes (outcome, candidateCount, correlationId). No PII (contactRef, displayName) is logged. Uses `createLogger` from observability package which has `RedactingLogProcessor` configured. |
| LOW-1: DisplayName matching clarity | Matcher checks both full displayName and parenthetical-stripped version. Tests cover both cases explicitly. |
| LOW-2: depends_on in docker-compose | Added `monica-integration: condition: service_started` to ai-router's depends_on. |
| LOW-3: Single-char prefix test | Added test "single-char query does NOT match as prefix (minimum 2 chars)". |
| LOW-4: correlationId min(1) | Added `.min(1)` constraint to `ContactResolutionRequest.correlationId`. Test verifies empty string is rejected. |

## Plan Deviations

1. **vitest.config.ts aliases extended**: The plan did not mention vitest alias changes, but the existing config was missing aliases for `jose`, `hono/factory`, `hono/http-exception`, `hono`, `@opentelemetry/api-logs`, and `@monica-companion/redaction`. These were required for the test suite to function. The pre-existing config test was already broken before this change (verified by testing against the main branch).

2. **`@monica-companion/redaction` not added as direct dependency**: The plan mentioned using the redaction package, but the implementation avoids logging PII in the first place (only safe fields like `outcome`, `candidateCount`, `correlationId` are logged). The observability pipeline already includes `RedactingLogProcessor` as a safety net. Adding redaction as a dependency would be unnecessary coupling.

3. **`requireUserId` helper created in `lib/`**: Created `services/ai-router/src/lib/require-user-id.ts` following the same pattern from `services/monica-integration/src/lib/require-user-id.ts`. This was not explicitly in the plan but was necessary for the MEDIUM-1 finding.

## Residual Risks

1. **Pre-existing vitest alias fragility**: The ai-router vitest config requires explicit aliases for transitive dependencies of workspace packages. This is fragile and will break when package versions change. A more robust solution (e.g., vitest `server.deps.inline` or building packages before testing) should be considered.

2. **Pre-existing integration test failure**: `services/ai-router/src/pending-command/__tests__/repository.integration.test.ts` fails without a live PostgreSQL instance. This is expected behavior for integration tests but should be excluded from the default `pnpm test` run or gated behind an environment check.

3. **Smoke test not run**: Per the completion rules, the Docker Compose smoke test is required before marking the roadmap item complete. This implementation provides all the code but the smoke test was not executed as part of this task.
