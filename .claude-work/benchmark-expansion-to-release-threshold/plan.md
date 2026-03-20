# Implementation Plan: Benchmark Expansion to Release Threshold

## Objective

Expand the labeled benchmark set from the current 16 intent cases (8 write, 4 read, 4 clarification) to at least 200 utterances (100 write intents, 60 read/query intents, 40 clarification/disambiguation turns), including at least 50 voice samples and required edge cases. This is a V1 release gate defined in `context/product/acceptance-criteria.md`.

## Current State Analysis

### Existing Case Counts

| Category | Current Count | Target | Gap |
|---|---|---|---|
| Write intents | 8 | 100 | 92 |
| Read intents | 4 | 60 | 56 |
| Clarification turns | 4 | 40 | 36 |
| Contact resolution | 45 (no expansion required) | 45 | 0 |
| **Total intent cases** | **16** | **200** | **184** |
| Voice samples | 0 | 50 | 50 |

### Voice Sample Strategy

The `IntentBenchmarkCase` schema has a `voiceSamplePath: z.string().nullable()` field. Voice samples are **text utterances that simulate voice transcription output** — they represent what a speech-to-text engine would produce. The evaluator runs intent classification on the text, not on audio files. The `voiceSamplePath` field serves as a marker. For the 50 voice samples, utterances will be written in a style that mimics voice transcription: no punctuation, run-on sentences, colloquialisms, filler words, spoken numbers, and natural speech patterns.

### Out-of-Scope and Greeting Handling

**Decision:** Add `out_of_scope` and `greeting` to the `BenchmarkCaseCategory` enum and `IntentBenchmarkCase.category` to properly represent these cases. The evaluator must be updated to handle them. Out-of-scope and greeting cases count toward the 40 clarification/disambiguation target since they are non-mutating, non-query turns.

## Scope

### In Scope

- Expand `write-intents.ts` from 8 to 100 cases covering all 7 V1 write command types
- Expand `read-intents.ts` from 4 to 60 cases covering all 3 V1 read query types
- Expand `clarification-turns.ts` from 4 to ~25 clarification cases
- Add new `out-of-scope-turns.ts` with ~10 out-of-scope cases
- Add new `greeting-turns.ts` with ~5 greeting cases
- Mark at least 50 utterances as voice samples (voice transcription style text with `voiceSamplePath` set)
- Add multi-language utterances (Spanish, French, German, Portuguese, Russian, Japanese, Chinese, Arabic)
- Add ambiguous contact cases with similar names
- Add compound command cases
- Add edge cases: misspellings, abbreviations, mixed languages, overly verbose utterances
- Update `BenchmarkCaseCategory` in `@monica-companion/types` to include `out_of_scope` and `greeting`
- Update `evaluateIntentCase` in `evaluate.ts` to handle new categories
- Update fixture count assertions in tests

### Out of Scope

- Adding actual audio files
- Expanding contact resolution cases beyond the current 45
- Changes to the LLM system prompt or classifier
- Changes to the LangGraph pipeline
- Latency benchmarking (separate roadmap item)

## Affected Services & Packages

| Package/Service | Changes |
|---|---|
| `packages/types/src/benchmark.ts` | Add `out_of_scope` and `greeting` to `BenchmarkCaseCategory` |
| `services/ai-router/src/benchmark/fixtures/write-intents.ts` | Expand from 8 to 100 cases |
| `services/ai-router/src/benchmark/fixtures/read-intents.ts` | Expand from 4 to 60 cases |
| `services/ai-router/src/benchmark/fixtures/clarification-turns.ts` | Expand from 4 to ~25 cases |
| `services/ai-router/src/benchmark/fixtures/out-of-scope-turns.ts` | New file, ~10 cases |
| `services/ai-router/src/benchmark/fixtures/greeting-turns.ts` | New file, ~5 cases |
| `services/ai-router/src/benchmark/fixtures/index.ts` | Import and export new fixture arrays |
| `services/ai-router/src/benchmark/evaluate.ts` | Handle `out_of_scope` and `greeting` categories |
| `services/ai-router/src/benchmark/__tests__/fixtures.test.ts` | Update count assertions |
| `services/ai-router/src/benchmark/__tests__/evaluate.test.ts` | Add tests for new categories |

## Implementation Steps

### Step 1: Add `out_of_scope` and `greeting` to benchmark type schemas

**What:** Update `BenchmarkCaseCategory` in `packages/types/src/benchmark.ts` to add `"out_of_scope"` and `"greeting"` values. Update the `IntentBenchmarkCase` schema's `category` field to accept these new values.

**Files to modify:**
- `packages/types/src/benchmark.ts`
- `packages/types/src/__tests__/benchmark.test.ts`

**TDD:** Write test for new category values first, then add them.

### Step 2: Update the evaluator to handle out-of-scope and greeting cases

**What:** Extend `evaluateIntentCase` in `evaluate.ts` to properly evaluate `out_of_scope` and `greeting` category cases. Both must verify `isMutating === false`.

**Files to modify:**
- `services/ai-router/src/benchmark/evaluate.ts`
- `services/ai-router/src/benchmark/__tests__/evaluate.test.ts`

### Step 3: Expand write intent fixtures to 100 cases

**What:** Add 92 new write intent cases covering all 7 V1 write command types:
- `create_note`: 25 total
- `create_contact`: 15 total
- `create_activity`: 20 total
- `update_contact_birthday`: 10 total
- `update_contact_phone`: 10 total
- `update_contact_email`: 10 total (new)
- `update_contact_address`: 10 total (new)

Include at least 20 voice-style utterances, 10 multi-language, 5 compound commands, 5 ambiguous contacts, 5 relationship references, 3 edge cases.

**Files to modify:**
- `services/ai-router/src/benchmark/fixtures/write-intents.ts`

### Step 4: Expand read intent fixtures to 60 cases

**What:** Add 56 new read intent cases across all 3 V1 read query types:
- `query_birthday`: 25 total
- `query_phone`: 20 total
- `query_last_note`: 15 total

Include at least 15 voice-style utterances, 8 multi-language, 5 relationship references, 3 ambiguous contacts.

**Files to modify:**
- `services/ai-router/src/benchmark/fixtures/read-intents.ts`

### Step 5: Expand clarification turns and add out-of-scope and greeting fixtures

**What:** Expand clarification turns from 4 to ~25. Create `out-of-scope-turns.ts` (~10 cases) and `greeting-turns.ts` (~5 cases).

**Clarification subcategories:** disambiguation questions, disambiguation answers, confirmations, negations, edits, provide-missing-info.

**Files to create:**
- `services/ai-router/src/benchmark/fixtures/out-of-scope-turns.ts`
- `services/ai-router/src/benchmark/fixtures/greeting-turns.ts`

**Files to modify:**
- `services/ai-router/src/benchmark/fixtures/clarification-turns.ts`
- `services/ai-router/src/benchmark/fixtures/index.ts`

### Step 6: Update fixture and benchmark test assertions

**What:** Update count assertions to reflect expanded set.

**Files to modify:**
- `services/ai-router/src/benchmark/__tests__/fixtures.test.ts` — >= 100 write, >= 60 read, >= 25 clarification, >= 10 out-of-scope, >= 5 greeting, >= 50 voice samples, >= 200 total
- `services/ai-router/src/benchmark/__tests__/benchmark.test.ts` — add total case count and voice sample assertions

## Utterance Design Guide

### Voice Transcription Style
- No terminal punctuation
- Filler words: "um", "uh", "like", "you know"
- Spoken numbers: "five five five zero one nine nine"
- Run-on sentences
- Natural speech patterns

### Multi-Language (romanized where appropriate)
Spanish, French, German, Portuguese, Russian, Chinese, Japanese, Arabic — all use the detected language with English command types in expected values.

### Ambiguous Contacts
- Two "Sarah"s: Sarah Miller (friend) and Sarah Chen (colleague)
- Two "Alex"s: Alex Torres and Alex Kim
- Two "David"s: David Park (spouse) and David Chen (colleague)

### Compound Commands
Expected `commandType` is the primary/first-mentioned command.

### Out-of-Scope Patterns
Weather, programming help, jokes, math, translations, general knowledge — must NOT trigger mutations.

## Smoke Test Strategy

Run `pnpm bench` in ai-router container. Verify:
- Total cases >= 245 (200 intent + 45 contact resolution)
- All fixture validation tests pass
- Contact resolution precision >= 95%

## Security Considerations

- All benchmark data is synthetic — no real PII
- Contact names, dates, phone numbers are fabricated
- Multi-language utterances use common given names
- Voice sample paths are placeholder markers, not real audio

## Risks

1. LLM accuracy may drop with diverse expanded set — signals prompt tuning needed (separate task)
2. Compound command classification is ambiguous — use primary command convention
3. Multi-language accuracy depends on model capabilities
4. "50 voice samples" interpreted as voice-transcription-style text, not actual audio files
