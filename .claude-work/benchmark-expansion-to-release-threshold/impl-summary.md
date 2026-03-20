# Implementation Summary: Benchmark Expansion to Release Threshold

## Files Changed
| File | Action | Description |
|------|--------|-------------|
| `packages/types/src/benchmark.ts` | modified | Added `out_of_scope` and `greeting` to `BenchmarkCaseCategory` enum and `IntentBenchmarkCase.category` field |
| `packages/types/src/__tests__/benchmark.test.ts` | modified | Added tests for `out_of_scope` and `greeting` categories in both `BenchmarkCaseCategory` and `IntentBenchmarkCase` schemas |
| `services/ai-router/src/benchmark/evaluate.ts` | modified | Added `out_of_scope` and `greeting` category handling in `evaluateIntentCase` to verify `result.intent` matches expected |
| `services/ai-router/src/benchmark/__tests__/evaluate.test.ts` | modified | Added 4 tests for out_of_scope and greeting intent evaluation (correct classification, misclassification) |
| `services/ai-router/src/benchmark/fixtures/write-intents.ts` | modified | Expanded from 8 to exactly 100 cases covering all 7 V1 write command types |
| `services/ai-router/src/benchmark/fixtures/read-intents.ts` | modified | Expanded from 4 to exactly 60 cases covering all 3 V1 read query types |
| `services/ai-router/src/benchmark/fixtures/clarification-turns.ts` | modified | Expanded from 4 to exactly 25 cases covering 6 subcategories |
| `services/ai-router/src/benchmark/fixtures/out-of-scope-turns.ts` | created | 10 out-of-scope cases (weather, programming, jokes, math, etc.) |
| `services/ai-router/src/benchmark/fixtures/greeting-turns.ts` | created | 5 greeting cases in English, Spanish, French |
| `services/ai-router/src/benchmark/fixtures/index.ts` | modified | Added imports/exports for `outOfScopeCases` and `greetingCases`, included in `allBenchmarkCases` |
| `services/ai-router/src/benchmark/__tests__/fixtures.test.ts` | modified | Updated count assertions and added comprehensive validations |

## Tests Added
| Test File | What It Tests |
|-----------|---------------|
| `packages/types/src/__tests__/benchmark.test.ts` | `out_of_scope` and `greeting` parse correctly in `BenchmarkCaseCategory` and `IntentBenchmarkCase` schemas |
| `services/ai-router/src/benchmark/__tests__/evaluate.test.ts` | Correct and incorrect classification of `out_of_scope` and `greeting` categories by the evaluator |
| `services/ai-router/src/benchmark/__tests__/fixtures.test.ts` | >= 100 write, >= 60 read, >= 25 clarification, >= 10 out-of-scope, >= 5 greeting, >= 50 voice samples, >= 200 total intent cases, unique IDs, schema validation, active status, non-mutating assertions for oos/greeting |

## Fixture Counts
| Category | Count | Voice Samples |
|----------|-------|---------------|
| write_intent | 100 | 29 |
| read_intent | 60 | 18 |
| clarification | 25 | 6 |
| out_of_scope | 10 | 4 |
| greeting | 5 | 2 |
| **Total intent** | **200** | **59** |
| contact_resolution | 45 (unchanged) | N/A |
| **Grand total** | **245** | **59** |

## Coverage Characteristics
- **Voice samples**: 59 utterances with `voiceSamplePath` set (target: 50+)
- **Multi-language**: 18+ utterances in Spanish, French, German, Portuguese, Japanese (romanized), Russian (romanized), Arabic (romanized)
- **Compound commands**: 5 cases (wi-011, wi-034, wi-052, wi-077, wi-090, wi-100)
- **Ambiguous contacts**: 6+ cases using two Sarahs, two Alexes, two Davids
- **Relationship references**: 10+ cases using Mom, brother, husband, spouse, sister
- **Edge cases**: misspellings, abbreviations, spoken numbers, verbose utterances
- **Multi-language voice samples**: 8+ voice-style utterances overlap with non-English languages

## Verification Results
- **Biome**: `pnpm biome check` -- 14 files checked, no issues
- **Types tests**: 10 files, 164 tests passed
- **Benchmark tests**: 3 files, 60 tests passed (fixtures, evaluate, benchmark quality gates)
- **AI-router unit tests**: 22 files passed, 244 tests passed (8 integration test files skipped due to no local PostgreSQL)

## Plan Deviations
- Compound commands total is 6 (slightly above the 5 target); wi-100 was a natural fit for address + note compound.
- The plan mentioned 8-10 multi-language voice-style utterances per the plan review MEDIUM-2 finding. Achieved approximately 8 voice-style utterances that are also non-English, meeting the advisory target.

## Residual Risks
- LLM accuracy on the expanded 200-case set is unknown until `pnpm bench:ai` runs with a real OpenAI API key. Prompt tuning may be needed (separate task).
- Compound command classification relies on primary/first-mentioned command convention. Some utterances may be ambiguous to the LLM.
- Multi-language accuracy depends on the model's multilingual capabilities -- romanized non-Latin scripts may have lower accuracy.
- Voice-style utterances without punctuation may trigger unexpected command types in edge cases.
