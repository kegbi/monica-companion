---
verdict: REJECTED
attempt: 1
critical_count: 0
high_count: 2
medium_count: 3
---

# Plan Review: Progressive Contact Narrowing

## Findings

### CRITICAL
(none)

### HIGH

1. [HIGH] **No mechanism to generate narrowing-specific clarification text.** The LLM produces `userFacingText` BEFORE the candidate count is known (classifyIntent runs before resolveContactRef). When resolveContactRef detects >5 candidates, it sets `needsClarification: true` but does NOT override `userFacingText`. The user will see the LLM's original text instead of a targeted narrowing question like "What's your mom's name?"

   **Fix:** In Step 4a, when narrowing is triggered, override `userFacingText` with a deterministic template-based question (e.g., `"I found several contacts matching '${contactRef}'. Can you tell me their name?"`) -- simplest, works without LLM.

2. [HIGH] **Type safety violation when piggybacking `_narrowingContext` on pending command payload.** `createPendingCommand` and `updateDraftPayload` accept `MutatingCommandPayload` -- a strict Zod discriminated union that does NOT allow extra properties. Cannot merge `_narrowingContext` without unsafe casts or widening signatures.

   **Fix:** Either (a) add a dedicated `narrowing_context` JSONB column to `pending_commands`, or (b) widen repository functions to accept `MutatingCommandPayload & { _narrowingContext?: unknown }` and document the widening.

### MEDIUM

1. [MEDIUM] **Narrowing abandonment only covers `mutating_command` intent.** `read_query`, `greeting`, and `out_of_scope` intents during narrowing should also abandon it.

   **Fix:** Abandon narrowing when intent is anything other than `clarification_response`.

2. [MEDIUM] **Smoke test does not verify narrowing behavior.** Per testing rules, smoke tests must verify the actual network path for the change.

   **Fix:** Add at least one smoke test case with >5 ambiguous candidates verifying text clarification response.

3. [MEDIUM] **`ConversationStateSchema` not updated alongside `ConversationAnnotation`.** Both must stay in sync.

   **Fix:** Add `narrowingContext: NarrowingContextSchema.nullable().default(null)` to `ConversationStateSchema`.

### LOW

1. [LOW] Clarification text extraction under-specified. Add explicit fallback logic.
2. [LOW] `round` field semantics ambiguous. Add clarifying comment.
3. [LOW] Only 3 test cases for executeAction narrowing persistence. Add a full create-then-update cycle test.

## Verdict Rationale

REJECTED due to HIGH-1 (functional correctness: cannot produce narrowing question) and HIGH-2 (type safety: payload type rejects extra properties). Both have straightforward fixes. Overall design is sound once these are addressed.
