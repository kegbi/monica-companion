# Implementation Summary: LLM Smoke Tests & Benchmark Activation

## Files Changed
| File | Action | Description |
|------|--------|-------------|
| `services/ai-router/src/__smoke__/smoke-config.ts` | created | Zod-validated LLM smoke test config (OPENAI_API_KEY, AI_ROUTER_URL, JWT_SECRET, POSTGRES_URL) |
| `services/ai-router/src/__smoke__/helpers.ts` | created | Shared helpers: JWT signing, sendMessage to /internal/process, DB query for pending_commands verification |
| `services/ai-router/src/__smoke__/config.smoke.test.ts` | created | Trivial smoke test validating config loading |
| `services/ai-router/src/__smoke__/command-parsing.smoke.test.ts` | created | 10 test cases covering all V1 command types (7 mutating + 3 read queries) |
| `services/ai-router/src/__smoke__/out-of-scope.smoke.test.ts` | created | 4 test cases verifying out-of-scope rejection with DB assertion (no pending commands) |
| `services/ai-router/src/__smoke__/dialog-clarification.smoke.test.ts` | created | 2 multi-turn dialog test cases (ambiguous contact, missing fields) |
| `services/ai-router/src/__smoke__/context-preservation.smoke.test.ts` | created | 2 test cases for pronoun/implicit reference resolution across turns |
| `services/ai-router/vitest.smoke.config.ts` | created | Vitest config for smoke tests: 60s timeout, 120s hooks, retry:1, JUnit output, sequential execution |
| `services/ai-router/src/benchmark/fixtures/read-intents.ts` | modified | Fixed command types to V1 (query_birthday, query_last_note, query_phone), removed non-V1 cases (ri-003 through ri-006), added new ri-003/ri-004, set all to active |
| `services/ai-router/src/benchmark/fixtures/write-intents.ts` | modified | Fixed command types (update_contact_birthday, update_contact_phone), removed non-V1 cases (wi-005, wi-009), set all to active |
| `services/ai-router/src/benchmark/fixtures/clarification-turns.ts` | modified | Set all 4 cases to status: "active" |
| `services/ai-router/src/benchmark/evaluate.ts` | modified | Added Classifier interface, evaluateIntentCase(), async evaluateBenchmark() with optional classifier, false-positive mutation rate tracking |
| `services/ai-router/src/benchmark/index.ts` | modified | Added exports for Classifier type and evaluateIntentCase |
| `services/ai-router/src/benchmark/__tests__/evaluate.test.ts` | modified | Added 10 tests: evaluateIntentCase (6 cases), false-positive mutation rate (2 cases), evaluateBenchmark with/without classifier (2 cases); updated existing tests for async |
| `services/ai-router/src/benchmark/__tests__/benchmark.test.ts` | modified | Made evaluation async with beforeAll, conditional classifier injection based on OPENAI_API_KEY, skip intent thresholds when no real key |
| `services/ai-router/src/benchmark/__tests__/fixtures.test.ts` | modified | Lowered thresholds to >= 8 write / >= 4 read, added all-active assertions |
| `services/ai-router/vitest.bench.config.ts` | modified | Added @langchain/openai and @langchain/core aliases for intent evaluation |
| `services/ai-router/vitest.config.ts` | modified | Added `**/__smoke__/**` to exclude list |
| `services/ai-router/package.json` | modified | Added test:smoke script |
| `package.json` | modified | Added test:smoke:llm root script |
| `.github/workflows/llm-smoke.yml` | created | GitHub Actions workflow for LLM smoke tests (manual dispatch, includes monica-integration service) |
| `context/product/testing-strategy.md` | modified | Fixed MEDIUM-1: updated LLM smoke suite description to say "ai-router /internal/process endpoint" instead of "telegram-bridge -> ai-router" |

## Tests Added
| Test File | What It Tests |
|-----------|---------------|
| `services/ai-router/src/__smoke__/config.smoke.test.ts` | Smoke config loading from env vars |
| `services/ai-router/src/__smoke__/command-parsing.smoke.test.ts` | All 10 V1 command types produce valid responses |
| `services/ai-router/src/__smoke__/out-of-scope.smoke.test.ts` | 4 out-of-scope queries produce text response + no pending commands in DB |
| `services/ai-router/src/__smoke__/dialog-clarification.smoke.test.ts` | 2 multi-turn clarification flows |
| `services/ai-router/src/__smoke__/context-preservation.smoke.test.ts` | 2 pronoun/implicit reference resolution scenarios |
| `services/ai-router/src/benchmark/__tests__/evaluate.test.ts` (new tests) | evaluateIntentCase for write/read/clarification categories, contactRef matching, classifier errors, false-positive mutation rate |
| `services/ai-router/src/benchmark/__tests__/fixtures.test.ts` (new tests) | All intent cases are active, lowered count thresholds |

## Verification Results
- **Biome**: `pnpm exec biome check` passes on all new/modified files with 0 errors and 0 warnings
- **Benchmark tests**: `pnpm bench:ai` - 3 test files, 44 tests passed (0 failed)
- **Unit tests**: `pnpm --filter @monica-companion/ai-router test` - 285 passed, 61 skipped, 1 pre-existing integration test fails (needs running PostgreSQL)
- **All other packages**: No regressions

## Plan Review Findings Addressed

### MEDIUM
1. **MEDIUM-1**: Updated `testing-strategy.md` line 87 to say "ai-router /internal/process endpoint (bypassing telegram-bridge)" instead of "telegram-bridge -> ai-router path"
2. **MEDIUM-2**: Added `monica-integration` to the service list in `llm-smoke.yml` GitHub Actions workflow
3. **MEDIUM-3**: Documented in evaluate.ts that evaluateIntentCase covers intent classification and command-type accuracy only; skip resolvedContactId assertions

### LOW
1. **LOW-1**: Explicitly lowered fixture count thresholds in fixtures.test.ts from >= 10/6 to >= 8/4 with explanatory comment
2. **LOW-2**: Added prominent comment in helpers.ts DB query functions noting test-only verification code
3. **LOW-4**: Added `retry: 1` to vitest.smoke.config.ts
4. **LOW-5**: Exported Classifier interface from evaluate.ts matching the shape from classify-intent.ts

## Plan Deviations

1. **Smoke tests do not query DB state between dialog turns**: The plan suggested checking pending_commands table between messages in Steps 4-5. The implementation omits DB assertions in dialog-clarification and context-preservation tests because the LLM's response structure (type, text) is sufficient to validate the flow, and the DB state depends on complex internal graph transitions that vary by LLM output. The out-of-scope tests retain DB assertions as the definitive "no mutation" proof.

2. **evaluateIntentCase uses dynamic import for @langchain/core/messages**: Instead of a top-level import (which would require the alias in all vitest configs), the function uses `await import()` so the benchmark can load in configs that don't resolve @langchain/core at the module level.

## Residual Risks

1. **Smoke tests are untested against live stack**: The smoke test files are written but have not been executed against a running Docker stack with a real OpenAI key. They will be validated during the smoke testing phase.

2. **LLM non-determinism**: Smoke test assertions are structural (response type, non-empty text) rather than exact-match. Some test flakiness is expected with LLM outputs; the `retry: 1` config mitigates this.

3. **Fixture count below Phase 7 target**: After cleanup, there are 16 active intent cases (4 read + 8 write + 4 clarification) plus 45 contact-resolution cases = 61 total. Phase 7 target is 200. Expansion is explicitly deferred.

4. **False-positive mutation rate has no real-key validation yet**: The rate tracking implementation is unit-tested with mock classifiers. It will only produce meaningful metrics when `pnpm bench:ai` runs with a real OPENAI_API_KEY via the `llm-smoke.yml` workflow.
