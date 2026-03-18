---
verdict: APPROVED
attempt: 1
critical_count: 0
high_count: 0
medium_count: 3
---

# Plan Review: Intent Classification & Command Parsing

## Summary

The plan covers all 6 roadmap sub-items, stays within ai-router service boundary, and defers downstream wiring to future tasks. Architecture is clean: two new graph nodes (classifyIntent, formatResponse), a local LLM output schema, a system prompt builder, and a thin LLM client factory.

## Findings

### CRITICAL
(none)

### HIGH
(none)

### MEDIUM

1. [MEDIUM] **Loose commandPayload schema risks silent garbage from LLM.** `commandPayload: z.record(z.string(), z.unknown()).nullable()` accepts any JSON. Should validate against typed schemas or document as explicitly deferred.

2. [MEDIUM] **Redaction of OPENAI_API_KEY not wired to shared package.** Security rules require redaction via `@monica-companion/redaction`. Add a step to register API key patterns.

3. [MEDIUM] **Smoke tests require real OpenAI API calls.** No mention of key provisioning or cost caps for smoke environment. Add notes about .env setup and budget limits.

### LOW

1. [LOW] **formatResponse is trivially thin.** Acceptable as extension point. Add code comment explaining why it's separate.
2. [LOW] **Hardcoded reasoning_effort vs. configurable option.** Inconsistency between Step 3 and Risk 4.
3. [LOW] **commandType uses z.string() instead of z.enum().** Should use enum of V1 command types for tighter validation.
4. [LOW] **No mention of OTel span attributes.** Add note about which attributes to emit.

## Verdict Rationale

APPROVED. All 6 sub-items covered. Three medium findings are advisory — loose payload is pragmatic deferral, redaction should reference shared package, smoke provisioning needs brief note. None require rearchitecting.
