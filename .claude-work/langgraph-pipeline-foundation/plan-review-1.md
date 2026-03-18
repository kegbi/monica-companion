---
verdict: REJECTED
attempt: 1
critical_count: 0
high_count: 1
medium_count: 3
---

# Plan Review: LangGraph Pipeline Foundation

## Summary

The plan is well-structured and covers all 5 roadmap sub-items, but introduces a premature `SCHEDULER_URL` config addition that contradicts the plan's own scope boundaries and breaks an existing architectural test. Several medium-severity over-engineering concerns exist around config values not needed by the echo node.

## Findings

### CRITICAL
(none)

### HIGH

1. [HIGH] **SCHEDULER_URL addition contradicts scope and breaks existing test.** The plan's Step 3 adds `SCHEDULER_URL` as a required config field, but the plan's own "Out of Scope" section explicitly states "Connecting output to delivery or scheduler" is deferred. Furthermore, the existing test at `services/ai-router/src/__tests__/read-only-bypass.test.ts` lines 33-40 explicitly asserts that `ai-router` config does NOT have a `schedulerUrl` property. Adding `SCHEDULER_URL` now would break this test and introduce a config dependency for functionality that does not exist yet. — **Fix:** Remove `SCHEDULER_URL` from Step 3 entirely. Defer it to the "End-to-End Pipeline Wiring" task group.

### MEDIUM

1. [MEDIUM] **OPENAI_API_KEY as required config for an echo node.** The echo node makes zero OpenAI calls. Making it required means every test/dev/CI run must provide a dummy API key. — **Fix:** Either defer to Intent Classification task, or make it optional.

2. [MEDIUM] **`@langchain/core` as explicit dependency may cause version conflicts.** It's a transitive dependency of both langgraph and openai. — **Fix:** Verify at implementation time whether it needs explicit pinning.

3. [MEDIUM] **Guardrail restructuring approach is underspecified.** Step 6 should specify exact route-mounting order to avoid regressions.

### LOW

1. [LOW] **`CONVERSATION_TURNS_RETENTION_DAYS` and `MAX_CONVERSATION_TURNS` configs are unused in this task.**
2. [LOW] **DB schema unit test adds limited value over smoke test.**

## Verdict Rationale

REJECTED due to one HIGH finding. Removing `SCHEDULER_URL` is a straightforward fix. Once addressed, the plan is solid.
