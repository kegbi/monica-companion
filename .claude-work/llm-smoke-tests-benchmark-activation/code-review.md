---
verdict: APPROVED
attempt: 1
biome_pass: true
tests_pass: true
test_summary: "285 passed, 61 skipped (unit); 44 passed (benchmark); 1 pre-existing integration failure (needs PostgreSQL)"
critical_count: 0
high_count: 0
medium_count: 1
---

# Code Review: LLM Smoke Tests & Benchmark Activation

## Automated Checks
- **Biome**: PASS -- "Checked 18 files in 18ms. No fixes applied."
- **Unit tests (ai-router)**: 285 passed, 61 skipped. 1 test file failed (`repository.integration.test.ts`) due to missing local PostgreSQL -- this is a pre-existing integration test from commit `5eea1c5`, not introduced or modified by this implementation.
- **Benchmark tests (bench:ai)**: 3 test files, 44 tests passed, 0 failed.
- **Smoke tests**: Not executed (require live Docker stack with real OpenAI key -- correctly documented as residual risk).

## Findings

### CRITICAL
(none)

### HIGH
(none)

### MEDIUM
1. [MEDIUM] `services/ai-router/src/__smoke__/helpers.ts:101` -- DB connection leak on repeated calls. Each call to `getPendingCommandsForUser()` creates a new `postgres()` connection, calls `sql.end()` in the finally block, but if multiple concurrent calls occur (unlikely given sequential test execution, but possible with retry), multiple connections will be opened. Since `fileParallelism: false` and tests are sequential, this is low risk but the pattern of creating and destroying a connection per query is wasteful. -- **Fix:** Consider creating a single shared connection in a `beforeAll`/`afterAll` lifecycle hook and passing it to the helper, rather than creating/destroying connections per call. This is acceptable for now given sequential execution and the `max: 1` guard.

### LOW
1. [LOW] `services/ai-router/src/__smoke__/helpers.ts:82` -- The response body is cast as `GraphResponse` without Zod validation. For smoke tests this is acceptable since we control both ends, but it deviates from the project rule that "Strict payload validation (Zod schemas) is enforced on all new inbound/outbound contracts." -- **Fix:** Add a `GraphResponseSchema` Zod parse for the response body. Since this is test-only code and not a service contract, this is LOW severity.

2. [LOW] `services/ai-router/src/benchmark/evaluate.ts:279` -- The `cases.find()` lookup inside the `nonMutatingResults` filter is O(n*m) where n = caseResults and m = cases. With 61 cases this is negligible, but a Map-based lookup would be cleaner. -- **Fix:** Build a `Map<string, BenchmarkCase>` before the loop for O(1) lookups.

3. [LOW] `.github/workflows/llm-smoke.yml:72-76` -- Services are started via `npx tsx` directly in the workflow step without capturing their PIDs or providing cleanup logic. If any service fails to start, the health check loop will catch it after 60s, but zombie processes may linger. -- **Fix:** Store PIDs and add a cleanup step or use a process manager. Acceptable for now since the workflow runs in an ephemeral container.

4. [LOW] `services/ai-router/src/__smoke__/out-of-scope.smoke.test.ts:29` -- The assertion `expect(body.type).not.toBe("confirmation_prompt")` is redundant immediately after `expect(body.type).toBe("text")` since if type is "text" it is already not "confirmation_prompt". -- **Fix:** Remove the redundant assertion on lines 29, 43, and 56.

## Plan Compliance

The implementation closely follows the approved plan. All 11 steps are addressed:

1. **Smoke test infrastructure** (Step 1): Created as specified -- `smoke-config.ts` with Zod validation, `helpers.ts` with JWT signing and HTTP client, `vitest.smoke.config.ts` with correct timeouts and sequential execution.

2. **Command parsing smoke tests** (Step 2): All 10 V1 command types covered (7 mutating + 3 read queries) as specified.

3. **Out-of-scope rejection** (Step 3): 4 test cases with DB assertions as specified.

4. **Multi-stage dialog** (Step 4): 2 test cases created. The plan suggested DB assertions between dialog turns; the implementation omits them. This deviation is documented and justified in the impl-summary: "the DB state depends on complex internal graph transitions that vary by LLM output."

5. **Context preservation** (Step 5): 2 test cases as specified with pronoun/implicit reference checks.

6. **Fixture activation** (Step 6): All fixture command types corrected to V1 values, non-V1 cases removed (wi-005, wi-009, ri-003 through ri-006), all remaining cases set to "active". Final counts match: 4 read, 8 write, 4 clarification.

7. **Intent evaluation** (Step 7): `evaluateIntentCase()` implemented with classifier injection, proper error handling, and contactRef case-insensitive matching.

8. **False-positive mutation rate** (Step 8): Implemented with actual counting logic replacing the hardcoded `0`.

9. **Benchmark test updates** (Step 9): `evaluateBenchmark()` made async, conditional classifier injection based on real/fake OpenAI key.

10. **Scripts and CI** (Step 10): Root `test:smoke:llm` script added, `test:smoke` script added to ai-router, `llm-smoke.yml` workflow created with all required services including `monica-integration` (per plan review MEDIUM-2).

11. **Documentation** (Step 11): `testing-strategy.md` updated to reflect the correct endpoint path (per plan review MEDIUM-1).

**Justified deviations:**
- DB assertions omitted from dialog/context-preservation smoke tests (documented).
- Dynamic import for `@langchain/core/messages` instead of top-level import (documented, avoids alias requirement in all vitest configs).

No unjustified deviations found.

## Unintended Removals Check

- **`.env.example`**: No changes.
- **`docker-compose.yml`**: No changes.
- **`pnpm-workspace.yaml`**: No changes.
- **Root `package.json`**: Additive only (one new script).
- **`services/ai-router/package.json`**: Additive only (one new script).
- **`services/ai-router/src/benchmark/index.ts`**: Additive only (two new exports).
- **Fixture removals** (read-intents.ts, write-intents.ts): The removed cases (ri-003 through ri-006, wi-005, wi-009) were non-V1 command types explicitly called out in the plan's "Critical Pre-Implementation Finding" table. These removals are authorized.

## Security Review

- OpenAI API key: No hardcoded values. `OPENAI_API_KEY` comes from environment with Zod `.min(1)` validation, no defaults.
- JWT signing: Uses `@monica-companion/auth` `signServiceToken` -- correct service-to-service auth pattern.
- Test user IDs: Random UUIDs, no real PII.
- DB access: Read-only `SELECT` queries for verification, clearly marked as test-only code.
- CI secrets: GitHub Actions secrets syntax (`${{ secrets.OPENAI_API_KEY }}`) used correctly.
- No sensitive data in logs: Benchmark summary formatter excludes PII-bearing fields.

## Service Boundary Review

- Smoke tests are contained within `ai-router` and only call `ai-router`'s `/internal/process` endpoint.
- No Telegram types or Monica API types leak into test code.
- DB queries in helpers.ts directly access `pending_commands` table -- this is documented as test-only and does not represent a production service boundary violation.

## Verdict Rationale

All automated checks pass (Biome clean, 285 unit tests + 44 benchmark tests pass). The single test failure is a pre-existing integration test requiring PostgreSQL, not introduced by this change. There are zero CRITICAL or HIGH findings. The one MEDIUM finding (DB connection pattern in helpers.ts) is mitigated by sequential test execution and the `max: 1` guard. The implementation closely follows the approved plan with well-documented and justified deviations. All plan review findings (MEDIUM-1, MEDIUM-2, MEDIUM-3, LOW-1 through LOW-5) were addressed. Security, service boundary, and code style rules are satisfied.
