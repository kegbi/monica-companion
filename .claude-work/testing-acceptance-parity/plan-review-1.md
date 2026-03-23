---
verdict: REJECTED
attempt: 1
findings_critical: 0
findings_high: 2
findings_medium: 3
findings_low: 2
---

# Plan Review: Stage 5 — Testing & Acceptance Parity

## Findings

### CRITICAL
(none)

### HIGH

1. [HIGH] Clarification dataset context-injection mechanism is unspecified

   The plan's Step 5 introduces a new provider that calls `buildAgentSystemPrompt()` (which takes zero parameters) and mentions supporting a `conversationHistory` var for multi-turn context injection. However, the existing clarification dataset (`clarification.yaml`) uses `recentTurns` and `activePendingCommand` vars in 14 places across cases cl-006, cl-022, cl-023, and cl-026 through cl-033. The old provider injected these into `buildSystemPrompt({ recentTurns, activePendingCommand })`, which embedded context directly in the system prompt text.

   The new `buildAgentSystemPrompt()` accepts no parameters. The plan does not specify:
   - How `recentTurns` vars will be translated into OpenAI chat-completion message arrays (user/assistant pairs) for the new provider.
   - How `activePendingCommand` vars will be represented in the tool-calling context (the agent loop stores a `pendingToolCall` in the conversation history row, not a system prompt field).
   - Whether the existing clarification var names (`recentTurns`, `activePendingCommand`) will be preserved, migrated, or replaced with the new `conversationHistory` var.
   - The precise message format the new provider will use for context injection.

   Without this design, 14 clarification cases -- including the Artillery Park regression cases cl-026 to cl-030 and pending-command draft cases cl-031 to cl-033 -- will either silently ignore their context or fail at runtime.

   **Fix:** In Step 5, specify the exact context-injection mechanism: (a) the new provider accepts a `conversationHistory` var containing a JSON array of OpenAI-format messages (`{role, content}[]`), injected between the system message and the user utterance in the `messages` array; (b) Step 8 must explicitly migrate each existing `recentTurns`/`activePendingCommand` var into the new `conversationHistory` format, providing a concrete example of the transformed structure. For `activePendingCommand`, define whether this maps to a prior assistant message containing a tool call plus a tool result, or to a text description appended to context.

2. [HIGH] Promptfoo assertion quality regression -- loss of per-case command-type and contact-reference validation

   The existing benchmark validates both the specific `commandType` (e.g., `create_note`, `create_activity`, `query_birthday`) and the extracted `contactRef` (e.g., `contactRef.toLowerCase().includes('mom')`). There are 102 `commandType` assertions in write-intents, 60 in read-intents, and 179 total `contactRef` assertions across three datasets. The plan's sample assertions in Steps 6 and 7 replace these with broad tool-name presence checks:

   ```yaml
   names.includes('create_note') || names.includes('search_contacts')
   ```

   Problems with this approach:

   - **All `contactRef` validation is dropped** (179 assertions). There is no replacement check that the LLM correctly identified the contact reference in its tool call arguments.
   - **Per-case `commandType` precision is lost.** The Step 6 sample only checks for `create_note` or `search_contacts`. It does not cover `create_activity` (20 cases), `create_contact` (15 cases), `update_contact_birthday` (10 cases), `update_contact_phone` (10 cases), `update_contact_email` (10 cases), or `update_contact_address` (10 cases). If applied literally, 75 of 100 write-intent cases would use incorrect assertions.
   - **In single-turn evaluation**, the LLM lacks a `contactId` and will almost always call `search_contacts` as its first (and only) tool call, regardless of the intended mutation. This means the assertion `names.includes('search_contacts')` passes for nearly every write-intent case, providing zero discriminatory value for command-type accuracy.

   The acceptance criteria require "Write intent and action-proposal accuracy at least 90%." If assertions cannot distinguish between a `create_note` intent and a `create_activity` intent, the write-accuracy metric is meaningless.

   **Fix:** (a) For write-intent cases, replace `contactRef` checks with assertions verifying that `search_contacts` was called with arguments containing the expected contact reference: `JSON.parse(calls.find(c => c.function.name === 'search_contacts')?.function?.arguments || '{}').query?.toLowerCase().includes('mom')`. (b) For read-intent cases, assert the specific read tool name (`query_birthday`, `query_phone`, `query_last_note`) appears somewhere in the tool calls, plus verify the contact reference in `search_contacts` arguments. (c) Acknowledge explicitly in the plan that per-case `commandType` precision (e.g., distinguishing `create_note` from `create_activity`) cannot be fully validated in single-turn tool-calling format, and state which testing layer covers this gap (the Vitest integration tests in Steps 2-4 and the multi-turn promptfoo cases in Step 10 cover dispatch accuracy). (d) Update the Step 6 assertion sample to be generic enough for all 7 mutating tool types, or provide separate samples per tool type.

### MEDIUM

1. [MEDIUM] Clarification case count is incorrect -- Step 8 says "Update all 25 assertions" but `clarification.yaml` contains 33 cases (cl-001 through cl-033). The file was expanded in prior phases with kinship narrowing regression cases (cl-026 to cl-033). If the implementer follows the plan's count literally, 8 cases will be missed during assertion migration.

   **Fix:** Update Step 8 to say "Update all 33 assertions" and reference the case range cl-001 to cl-033 explicitly. Also update the file summary table (bottom of plan) from "Update 25 assertions" to "Update 33 assertions."

2. [MEDIUM] Contact-resolution precision metric has no concrete measurement specification. The plan's Step 11 says "Add contact-resolution precision threshold" and Step 14 lists ">= 95%," but the plan does not specify: (a) which dataset cases contribute to this metric, (b) what assertion pattern yields a named score for contact-resolution in the new tool-call format, or (c) how `check-thresholds.ts` aggregates and reports this metric. The old format had a `contactRef` field that could be compared. The new format would need to inspect `search_contacts` call arguments.

   **Fix:** Add a subsection to Step 11 specifying: introduce a `contactResolution` named score on assertions that check the quality of `search_contacts` argument matching against expected contact references. Define which dataset category contributes (write-intents + read-intents cases requiring contact lookup). Add the threshold comparison (`>= 0.95`) to the `allPass` check in `check-thresholds.ts`.

3. [MEDIUM] TDD claim for Steps 2-3 is misleading. The plan says "Write failing tests first, then verify they pass against existing implementation." Since the tests are being written against already-passing implementation code (the agent loop already dispatches `query_phone` and `query_last_note`; the history repository already truncates), no genuine RED phase will be observed -- the tests will pass immediately upon first run. This conflicts with `.claude/rules/testing.md`: "write a failing test first, implement minimal code to pass."

   **Fix:** Acknowledge in the Test Strategy section that Steps 2-3 are gap-filling coverage additions for existing behavior, not strict TDD. To satisfy the "failing test observed first" requirement, write tests with deliberately incorrect expected values (e.g., wrong handler name, wrong truncation count) on the first run to confirm the test catches failures, then correct the expectations. Reserve the TDD label for Step 4, where the multi-turn mock choreography may genuinely fail before the scripted responses are tuned correctly.

### LOW

1. [LOW] Env var name inconsistency between promptfoo scripts. The plan's Step 5 correctly uses `LLM_API_KEY`, `LLM_BASE_URL`, and `LLM_MODEL_ID` for the new provider (matching `ai-router/src/config.ts`). However, `check-thresholds.ts` (line 74) still reads `OPENAI_API_KEY` for its skip-guard. Step 11 describes updates to `check-thresholds.ts` but does not explicitly mention updating the env var reference.

   **Fix:** Add to Step 11: "Update the API key skip-guard in `check-thresholds.ts` to read `LLM_API_KEY` instead of `OPENAI_API_KEY`, matching the provider's env var configuration."

2. [LOW] Risk 5 ("OpenRouter vs OpenAI tool-calling behavior may differ between models") is listed without mitigation. The config defaults to OpenRouter with model `qwen/qwen3-235b-a22b`, not OpenAI's native API. Tool-calling format differences and argument serialization behavior can vary between providers and models.

   **Fix:** Add a concrete mitigation to the Risks section: the provider should set `temperature: 0` to maximize determinism, and the plan should state which model the eval is expected to run against. Note that assertion flexibility (e.g., checking argument content via substring match rather than exact JSON equality) accounts for model-specific formatting differences.

## Roadmap Sub-Item Coverage

| Sub-item | Covered | Assessment |
|---|---|---|
| Vitest unit tests: tool handlers, guardrail, history, loop | Yes | Steps 2-3 fill gaps in `query_phone`/`query_last_note` dispatch and history truncation content verification |
| Vitest integration tests: Artillery Park multi-turn | Yes | Step 4 covers the exact scenario from the roadmap |
| Promptfoo evals: new provider | Partially | Step 5 covers the provider rewrite but context-injection for existing cases is unspecified (HIGH-1) |
| Promptfoo evals: adapted 200-case dataset | Partially | Steps 6-9 cover all 4 dataset files but assertion quality regresses significantly (HIGH-2) |
| Promptfoo evals: multi-turn and false-positive cases | Yes | Steps 9-10 add these as specified |
| Smoke tests: verify existing pass | Yes | Step 13 confirms unchanged contract |
| Acceptance criteria parity: full benchmark + thresholds | Partially | Step 14 lists all thresholds but contact-resolution precision measurement is underspecified (MEDIUM-2) |

## Architecture & Boundary Compliance

- All changes are confined to `ai-router`. No Telegram types, Monica types, or other service concerns leak.
- The promptfoo provider correctly accesses `buildAgentSystemPrompt` and `TOOL_DEFINITIONS` from the agent module, maintaining the correct abstraction level.
- No new endpoints, callers, or service dependencies are introduced.
- Security considerations are adequate: synthetic data only, env-based API key with skip-guard, no credentials in fixtures.

## KISS / Over-Engineering Assessment

The plan is well-scoped and avoids over-engineering. The steps are incremental and focused. The multi-turn integration test mock strategy (capture `saveHistory` output, replay via `getHistory`) is the simplest viable approach. No speculative features or unnecessary abstractions are introduced.

## DRY Assessment

The plan correctly imports from existing agent modules (`system-prompt.ts`, `tools.ts`, `loop.ts`) rather than duplicating definitions. The promptfoo provider wraps a single LLM call using the same system prompt and tool definitions as the production agent loop.

## Verdict Rationale

The plan demonstrates strong structural design with accurate gap analysis, clean architecture boundaries, and appropriate scope. However, two HIGH findings prevent approval:

1. **HIGH-1 (context injection):** 14 clarification cases will lose their conversation context because the plan does not specify how the old `recentTurns`/`activePendingCommand` vars map to the new tool-calling provider's context mechanism. This could silently invalidate a significant portion of the clarification benchmark.

2. **HIGH-2 (assertion regression):** The proposed assertion migration drops both `contactRef` validation and per-case `commandType` precision, making the write-accuracy and contact-resolution metrics effectively unmeasurable. The benchmark thresholds become meaningless gates if the assertions cannot discriminate between different command types or verify contact reference extraction.

Both findings require specific design additions to the plan text. The fixes are straightforward and should not significantly change the implementation scope or complexity.
