---
verdict: APPROVED
attempt: 1
critical_count: 0
high_count: 0
medium_count: 4
---

# Plan Review: Command Contract & Lifecycle

## Summary

The plan defines structured Zod command schemas for all V1 create/update/query actions, implements pending-command storage in PostgreSQL within `ai-router` with a state machine governing lifecycle transitions, and creates the `ConfirmedCommandPayload` contract consumed by `scheduler`.

## Findings

### MEDIUM

1. **Command payload schemas may duplicate monica-integration write schemas.** Document the relationship between command payloads and monica-integration write schemas. They are intentionally separate (AI-facing vs Monica-integration-facing) and will be reconciled in Phase 4.

2. **`contactFieldTypeId` leak extends to shared `@monica-companion/types`.** Document explicitly as known V1 boundary pragmatism and add code comment.

3. **Expiry sweep lifecycle management not specified.** `startExpirySweep` must return a cleanup function, and `index.ts` shutdown handler must call it.

4. **No explicit test for concurrent version conflicts.** Add test case: two `transitionStatus` calls with same `expectedVersion` — exactly one succeeds.

### LOW

1. **Type `PendingCommandRecord.commandType` as `MutatingCommandType`** instead of `CommandType` to enforce the design invariant.

2. **Define `sourceMessageRef` semantics** — connector-neutral opaque string.

3. **Table name conflicts** — current names are distinct enough. Add ownership comment.

4. **Smoke test write path** — consider simple SQL insert+select to verify schema.

## Verdict

**APPROVED.** Well-structured, correctly scoped, follows established patterns. All architecture and security rules respected. Medium findings are design hygiene items addressable during implementation.
