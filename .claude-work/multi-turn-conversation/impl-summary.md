# Implementation Summary: Multi-Turn Conversation & Context Preservation

## Files Changed
| File | Action | Description |
|------|--------|-------------|
| `services/ai-router/package.json` | modified | Added `@monica-companion/redaction` dependency |
| `services/ai-router/src/graph/graph.ts` | modified | Extended ConversationGraphConfig with db/maxTurns/repository deps; new topology: START -> loadContext -> classifyIntent -> formatResponse -> persistTurn -> END |
| `services/ai-router/src/graph/index.ts` | modified | Added exports for ClarificationReasonSchema, DisambiguationOptionSchema |
| `services/ai-router/src/graph/intent-schemas.ts` | modified | Added needsClarification, clarificationReason, disambiguationOptions to IntentClassificationResultSchema |
| `services/ai-router/src/graph/system-prompt.ts` | modified | buildSystemPrompt now accepts optional recentTurns and activePendingCommand; includes conversation history, active command context, pronoun resolution instructions, and needsClarification instructions |
| `services/ai-router/src/graph/nodes/classify-intent.ts` | modified | Passes recentTurns and activePendingCommand to buildSystemPrompt; callback_action with active pending command now calls LLM with synthetic message |
| `services/ai-router/src/graph/nodes/format-response.ts` | modified | Handles needsClarification: text type for no options, disambiguation_prompt with options; includes pendingCommandId/version from active command |
| `services/ai-router/src/graph/nodes/load-context.ts` | created | loadContext node: loads recent turn summaries and active pending command from DB |
| `services/ai-router/src/graph/nodes/persist-turn.ts` | created | persistTurn node: writes compressed turn summaries through redaction to DB; error-resilient |
| `services/ai-router/src/graph/state.ts` | unchanged | Already had TurnSummary, PendingCommandRef, GraphResponse schemas from prior work |
| `services/ai-router/src/db/turn-repository.ts` | created | getRecentTurns and insertTurnSummary repository functions |
| `services/ai-router/src/db/index.ts` | modified | Added turn-repository exports |
| `services/ai-router/src/app.ts` | modified | Passes db, maxConversationTurns, repository functions, and redactString to createConversationGraph |
| `services/ai-router/src/config.ts` | unchanged | MAX_CONVERSATION_TURNS already present from prior work |

## Tests Added
| Test File | What It Tests |
|-----------|---------------|
| `services/ai-router/src/db/__tests__/turn-repository.test.ts` | getRecentTurns chronological ordering, empty results, row-to-TurnSummary mapping; insertTurnSummary parameter passing |
| `services/ai-router/src/graph/nodes/__tests__/load-context.test.ts` | Turn loading, empty turns, active command mapping, null command, maxTurns passthrough |
| `services/ai-router/src/graph/nodes/__tests__/persist-turn.test.ts` | Compressed user/assistant summaries, redaction defense-in-depth, error resilience, greeting compression, null classification skip |
| `services/ai-router/src/graph/__tests__/system-prompt.test.ts` | Updated: conversation history rendering, active pending command section, pronoun resolution instructions, needsClarification instructions |
| `services/ai-router/src/graph/__tests__/intent-schemas.test.ts` | Updated: needsClarification acceptance/default, clarificationReason validation, disambiguationOptions |
| `services/ai-router/src/graph/nodes/__tests__/classify-intent.test.ts` | Updated: conversation history in system prompt, active pending command in prompt, synthetic callback message with active command |
| `services/ai-router/src/graph/nodes/__tests__/format-response.test.ts` | Updated: clarification without options (text), disambiguation with options, pendingCommandId/version on disambiguation |
| `services/ai-router/src/graph/__tests__/graph.test.ts` | Updated: new config format, loadContext invocation verification, persistTurn invocation, redaction passthrough |
| `services/ai-router/src/__tests__/process-endpoint.test.ts` | Updated: mocks for turn-repository, pending-command/repository, redaction |
| `services/ai-router/src/__tests__/guardrails-wiring.test.ts` | Updated: mocks for turn-repository, pending-command/repository, redaction |

## Verification Results
- **Biome**: `pnpm biome check --diagnostic-level=error` -- 0 errors, 62 files checked
- **Tests**: 22 test files pass, 221 tests pass, 22 skipped (pre-existing integration tests needing PostgreSQL). 1 test file fails (pre-existing `repository.integration.test.ts` -- requires running PostgreSQL, not a regression)

## Plan Deviations
- **Step 1 (config)**: Already implemented in prior work. No changes needed.
- **State schemas**: TurnSummarySchema, PendingCommandRefSchema, GraphResponseSchema were already defined in state.ts from prior work. No changes needed.
- **Dependency injection for loadContext**: Used function-injection pattern (getRecentTurns, getActivePendingCommandForUser as config params) rather than class-based DI, consistent with existing codebase patterns.
- **persistTurn redaction**: Per review MEDIUM-2, summaries pass through `redactString` from `@monica-companion/redaction` as defense-in-depth before DB write.
- **Callback action handling**: Per review LOW-2, synthetic callback message format is: `"User selected callback action: {action}, data: {data}"`. Only invoked when there is an active pending command; otherwise falls back to the existing placeholder behavior.

## Residual Risks
1. **LLM pronoun resolution quality**: Compressed summaries intentionally omit raw utterances for data governance. Pronoun resolution quality depends on summary informativeness. May need tuning after benchmarks.
2. **persistTurn best-effort**: DB write failures are silently caught. Turn history will have gaps on DB errors. Acceptable for V1; metric emission deferred to OTel wiring.
3. **Smoke test**: Per review MEDIUM-3, smoke test item 3 (pronoun resolution) requires live LLM. Not feasible in automated CI. DB operations can be verified; LLM behavior requires manual/benchmark validation.
4. **No retention cleanup**: Old conversation_turns rows are not pruned. Deferred to Phase 7 Data Governance per plan scope.
5. **Integration test**: `turn-repository.integration.test.ts` not created in this iteration. The unit tests cover query construction and mapping. Integration testing with real PostgreSQL follows the same pattern as `repository.integration.test.ts`.
