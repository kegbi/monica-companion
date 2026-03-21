---
verdict: APPROVED
reviewed: impl-summary.md
date: 2026-03-21
attempt: 1
biome_pass: true
tests_pass: true
test_summary: "308 passed, 0 failed (12 pre-existing suite failures due to missing ioredis/opentelemetry packages and no running PostgreSQL -- identical to baseline without changes: 292 passed + same 12 failures)"
critical_count: 0
high_count: 0
medium_count: 0
---

# Code Review: Confirm-Then-Resolve Conversation Flow

## Automated Checks
- **Biome**: pass -- `pnpm biome check services/ai-router/src/` reports "ok (no errors)"
- **Tests**: pass -- 308 tests pass (16 net new vs baseline of 292). 12 pre-existing suite failures are infrastructure-related (missing `ioredis`, `@opentelemetry/resources` packages, no PostgreSQL running) and identical with and without changes. 61 tests skipped (integration tests requiring DB).

## Findings

### CRITICAL
(none)

### HIGH
(none)

### MEDIUM
(none)

### LOW

1. [LOW] `services/ai-router/src/graph/nodes/load-context.ts:69-71` -- The `unresolvedContactRef` extraction uses a cast-and-fallback pattern (`(activeCommand as Record<string, unknown>).unresolvedContactRef as string | null`) rather than Zod validation like the adjacent `narrowingContext` extraction (which uses `NarrowingContextSchema.safeParse`). Since this is a simple nullable string (not a complex object), the runtime risk is minimal, but it would be more consistent with the codebase pattern to validate it. **Fix:** Consider `z.string().nullable().safeParse(...)` for consistency with the narrowingContext extraction pattern immediately above, though the current approach is functionally correct.

2. [LOW] `services/ai-router/src/graph/nodes/resolve-contact-ref.ts:407` -- The `unresolvedContactRef` value (a user-provided natural-language string like "mom") is logged in an info-level message on cancel/edit callbacks. This is consistent with existing logging of `contactRef` throughout the file and does not constitute sensitive data (no API keys, tokens, or credentials). However, if the codebase ever adds redaction rules for contact names, this would need updating. **Fix:** No action needed now; note for future redaction policy review.

3. [LOW] `services/ai-router/src/pending-command/repository.ts:261-275` -- `setUnresolvedContactRef` has no status constraint (unlike `updatePendingPayload` which requires `pending_confirmation`). This is intentional and documented (idempotent like `clearNarrowingContext`), but it means it could be called on commands in any status. The call site in `execute-action.ts:248-249` only calls it on freshly-created drafts, so this is safe in practice. **Fix:** Consider adding a status constraint (`eq(pendingCommands.status, "draft")`) for defense-in-depth, though current call sites make this a minor concern.

4. [LOW] `services/ai-router/drizzle/0002_add_unresolved_contact_ref.sql` -- The migration adds a nullable TEXT column, which is non-breaking. The implementation summary correctly notes this is safe. No migration `down` is provided, consistent with existing migration conventions in this project.

## Plan Review MEDIUM Findings -- All Addressed

1. **MEDIUM-1 (handleConfirm signature)**: Changed from `(deps, command)` to `(state, deps, command)` at `execute-action.ts:602`. Verified the call site at line 592 passes `state` as the first argument.

2. **MEDIUM-2 (payload validation after merge)**: `MutatingCommandPayloadSchema.safeParse(mergedPayload)` is called at `execute-action.ts:623` before transitioning to confirmed. On failure, transitions back to draft with `edit_draft` outcome.

3. **MEDIUM-3 (callback_action skip guard)**: The guard at `resolve-contact-ref.ts:395` is now conditional: `state.inboundEvent.type === "callback_action" && state.unresolvedContactRef`. When `unresolvedContactRef` is null, execution falls through to the existing skip guard at line 636 which skips callback_action events unconditionally.

## Plan Compliance

The implementation follows the approved plan with two justified deviations:

1. **LOW-3 rename not applied**: `updatePendingPayload` was kept instead of renaming to `updatePendingConfirmationPayload`. The doc comment and status constraint make purpose clear. This was a LOW finding and the deviation is documented.

2. **Test count difference**: Plan specified 7 new executeAction tests; implementation has 5. The missing 2 (repository integration tests for `updatePendingPayload` and `setUnresolvedContactRef`) are documented as a residual risk in the impl-summary with rationale -- these functions follow the exact same pattern as existing functions and are covered through mock-based node-level tests.

All planned files were changed. No out-of-scope files were modified (the `.claude-work/` state.json changes are pipeline metadata, not production code). No service boundary violations -- all changes are within `services/ai-router`. No Telegram types, no Monica API specifics leaked into ai-router beyond the existing `ContactResolutionSummary` projection.

## Unintended Removals Check

- **`.env.example`**: Not modified. No removals.
- **`docker-compose.yml`**: Not modified. No removals.
- **`pnpm-workspace.yaml`**: Not modified. No removals.
- **`services/ai-router/src/pending-command/index.ts`**: Additive only -- 2 new exports added, 0 removed.
- **Graph test updates**: 13 existing resolve-contact-ref tests changed intent from `mutating_command` to `clarification_response`. This is correct -- these tests verify the contact resolution logic which is unchanged; the intent change reflects the new behavior where `mutating_command` now defers resolution. The tests still exercise the same resolution paths. 3 graph integration tests were updated similarly.

## Verdict Rationale

**APPROVED.** All automated checks pass (Biome clean, all relevant tests pass). Zero CRITICAL or HIGH findings. All three plan review MEDIUM findings were addressed. The implementation faithfully follows the approved plan with minor, documented deviations. Code quality is consistent with existing patterns. Service boundaries are respected. Security constraints are maintained (no new endpoints, no sensitive data logging, payload validation enforced). The confirm-then-resolve flow correctly defers contact resolution for mutating commands, handles all callback outcomes (confirm/cancel/edit), and integrates with the existing progressive narrowing flow.
