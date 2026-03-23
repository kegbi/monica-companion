# Implementation Summary: Stage 5 -- Testing & Acceptance Parity

## Files Changed

| File | Action | Description |
|------|--------|-------------|
| `services/ai-router/src/agent/__tests__/loop.test.ts` | modified | Added 4 gap-filling tests: query_phone dispatch + validation, query_last_note dispatch + validation |
| `services/ai-router/src/agent/__tests__/history-repository.test.ts` | modified | Added 3 truncation content verification tests + exposed `_mockInsertValues` in mock |
| `services/ai-router/src/agent/__tests__/multi-turn-disambiguation.integration.test.ts` | created | 2 multi-turn integration scenarios: Artillery Park (3 turns) and cancel flow (2 turns) |
| `services/ai-router/promptfoo/provider.ts` | rewritten | Replaced LangChain intent classifier with OpenAI SDK tool-calling provider; supports `conversationHistory` var for context injection |
| `services/ai-router/promptfoo/datasets/write-intents.yaml` | rewritten | 102 cases migrated to tool-call assertions with `expectedTool` metadata and `contactResolution` metric |
| `services/ai-router/promptfoo/datasets/read-intents.yaml` | rewritten | 60 cases migrated to tool-call assertions with `isMutating` + `contactResolution` metrics |
| `services/ai-router/promptfoo/datasets/clarification.yaml` | rewritten | 33 cases: Group A (no-context) uses isMutating guard; Group B migrated `recentTurns` to `conversationHistory`; Group C migrated `activePendingCommand` to tool-call/tool-result history messages |
| `services/ai-router/promptfoo/datasets/guardrails.yaml` | rewritten | 15 original cases migrated to tool-call assertions + 10 new false-positive cases (fp-001 to fp-010) |
| `services/ai-router/promptfoo/datasets/multi-turn.yaml` | created | 5 multi-turn eval cases including Artillery Park regression (mt-001) |
| `services/ai-router/promptfooconfig.yaml` | modified | Updated description; added multi-turn.yaml dataset reference |
| `services/ai-router/promptfoo/check-thresholds.ts` | rewritten | Changed `OPENAI_API_KEY` to `LLM_API_KEY`; added `contactResolution` threshold (0.95); added `multi_turn` category to report; increased timeout to 15 min for 225 cases |
| `services/ai-router/vitest.bench.config.ts` | modified | Removed `@langchain/openai` and `@langchain/core` aliases (no benchmark code imports them) |

## Tests Added

| Test File | What It Tests |
|-----------|---------------|
| `services/ai-router/src/agent/__tests__/loop.test.ts` (+4 tests) | query_phone dispatch to handler, query_last_note dispatch to handler, validation error when query_phone args invalid (contact_id: -1), validation error when query_last_note args missing |
| `services/ai-router/src/agent/__tests__/history-repository.test.ts` (+3 tests) | 50 messages truncated to last 40 with correct content, 40 messages preserved without truncation, single message preserved |
| `services/ai-router/src/agent/__tests__/multi-turn-disambiguation.integration.test.ts` (2 tests) | Scenario 1: Artillery Park 3-turn flow verifying note body preservation across disambiguation turns; Scenario 2: Cancel flow verifying executeMutatingTool never called and pendingToolCall cleared |
| `services/ai-router/promptfoo/datasets/multi-turn.yaml` (5 cases) | mt-001 Artillery Park regression, mt-002 read after search, mt-003 pronoun resolution, mt-004 kinship narrowing, mt-005 context switch |
| `services/ai-router/promptfoo/datasets/guardrails.yaml` (+10 cases) | fp-001 to fp-010: false-positive read queries that must not trigger mutations |

## Verification Results

- **Biome**: `pnpm check:fix` -- 0 errors, 2 files auto-fixed, 201 pre-existing warnings
- **Tests (ai-router main)**: 48 test files passed, 1 failed (pre-existing `repository.integration.test.ts` requires running Postgres), 1 skipped. 601 tests passed, 35 skipped.
- **Tests (ai-router bench)**: 3 test files passed, 18 tests passed
- **Promptfoo datasets**: 225 total cases (102 write + 60 read + 33 clarification + 25 guardrails + 5 multi-turn) -- all YAML files parse correctly

## Plan Deviations

1. **vitest.config.ts `@langchain/core/messages` alias retained**: The plan said "remove if safe". Grep confirmed `classify-intent.ts` and `llm-integration.test.ts` still import `@langchain/core/messages`, so removal would break tests. Deferred to Stage 6 when LangChain code is fully removed.

2. **Clarification Group B/C conversationHistory content**: The plan's migration spec said to use the `summary` field from `recentTurns` as `content`. The generated conversationHistory entries were further improved to use natural user language ("Add a note to mum") instead of meta-summaries ("User asked to add a note to mum") for more realistic eval behavior.

3. **Group C search_contacts query**: The auto-generated pending command search queries were corrected from extracted verbs ("add", "update") to the actual kinship terms ("mum", "dad") that the production system would use.

## Residual Risks

1. **Promptfoo eval not run against real LLM**: The promptfoo provider requires `LLM_API_KEY` to be set. The eval was not executed as part of this implementation (no API key in environment). Threshold checks will be verified when the eval runs against the real model.

2. **LLM non-determinism**: Tool-calling output varies between runs. Assertions use `includes()` and `temperature: 0` for maximum determinism, but some variance (~5%) is expected.

3. **`@langchain/core/messages` alias in vitest.config.ts**: Must remain until Stage 6 removes the old graph code. Not a functional risk but a cleanup item.

4. **Pre-existing integration test failure**: `repository.integration.test.ts` fails when PostgreSQL is not running. This is not related to Stage 5 changes.

5. **Promptfoo timeout**: Increased to 15 minutes for 225 cases. May need further adjustment depending on model response latency via OpenRouter.
