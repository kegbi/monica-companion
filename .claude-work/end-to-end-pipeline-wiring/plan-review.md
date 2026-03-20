---
verdict: REJECTED
attempt: 1
critical_count: 0
high_count: 2
medium_count: 1
---

# Plan Review: End-to-End Pipeline Wiring

## Findings

### CRITICAL
(none)

### HIGH

1. [HIGH] **Step 1 payload validation would break the clarification flow.** The plan adds `MutatingCommandPayloadSchema.safeParse()` before `deps.createPendingCommand()` and says to "return a `passthrough` outcome with an error userFacingText if validation fails." However, when `needsClarification` is true, the LLM intentionally produces an incomplete payload (e.g., `create_note` with `body` but missing the required `contactId`). Strict Zod validation against `MutatingCommandPayloadSchema` would reject these legitimate draft payloads. If validation fails and the node returns passthrough, no draft is created in the DB. The subsequent clarification response (Step 3) would find no `activePendingCommand` to update, breaking the entire clarification round-trip. This directly contradicts the roadmap sub-item "Connect intent classification output to pending command creation (mutating)" because drafts that need clarification would never be created.

   **Fix:** Validate the payload only when `needsClarification` is false (the payload is supposed to be complete). When `needsClarification` is true, skip the strict schema validation and allow the incomplete payload to be stored as a draft. Alternatively, define a lenient `DraftPayloadSchema` that only requires the `type` discriminator, and use the strict `MutatingCommandPayloadSchema` only at the `pending_confirmation` transition point (which is also where `buildConfirmedPayload` is called). Update the TDD test plan for Step 1 to include a test case: "allows incomplete payload when needsClarification is true."

2. [HIGH] **Step 4 select callback will be stale-rejected before reaching `case "select"`.** The plan identifies in Risk #3 that disambiguation buttons encode data as `select:{contactValue}:0` (version hardcoded to 0 in `outbound-renderer.ts` at line 53). After `telegram-bridge` strips the action prefix in `callback-query.ts` line 32, ai-router receives `data: "{contactValue}:0"`. The `parseCallbackData` function in `execute-action.ts` returns `{ pendingCommandId: contactValue, version: 0 }`. The version check at line 267 compares `parsed.version` (always 0 for select) against `activePendingCommand.version` (1 for a newly created draft), causing every select callback to be stale-rejected before execution reaches `case "select"` at line 309. Step 4 describes modifications to the `case "select"` handler but does not address the fact that execution never reaches it.

   **Fix:** The plan must specify a concrete resolution. Two viable options that keep changes in `ai-router` only (within scope): (a) Check for `action === "select"` before the version check and branch to a separate handler that extracts the selected value from `parsed.pendingCommandId`, uses `state.activePendingCommand` for the actual pending command reference, and skips version validation; (b) Restructure `handleCallbackAction` so the action switch runs first, with version checks applied only in the `confirm`/`cancel`/`edit` cases. Either way, the plan must also specify a TDD test that verifies a select callback with version 0 is NOT stale-rejected when an active draft exists.

### MEDIUM

1. [MEDIUM] **Existing smoke test not acknowledged.** Step 7 proposes creating `tests/smoke/pipeline.smoke.test.ts`, but `tests/smoke/e2e-pipeline-wiring.mjs` already exists (244 lines) and covers health checks for ai-router/delivery/scheduler/user-management, auth enforcement (missing and invalid tokens), payload validation (invalid payload and non-UUID userId), graph invocation with a valid text message, service connectivity from ai-router, delivery-routing endpoint reachability and caller allowlist, scheduler execute endpoint validation, and callback action event handling. The plan does not reference this file.

   **Fix:** Acknowledge the existing `tests/smoke/e2e-pipeline-wiring.mjs` in the plan. Either extend it with the additional contract checks described in Step 7 (delivery `POST /internal/deliver` with a valid `OutboundMessageIntent`, scheduler `POST /internal/execute` with a valid `ConfirmedCommandPayload`), or explain why a separate Vitest-based `.smoke.test.ts` file is needed alongside the existing `.mjs` runner. If the existing file is to be superseded, note it for removal.

### LOW

1. [LOW] **Step 3 phrasing implies `needsClarification` could change during `executeAction`.** The plan says "check if `needsClarification` is still true" after updating the draft, but `needsClarification` is set by the LLM during the `classifyIntent` node, which runs before `executeAction` in the linear graph topology. The value is fixed in `state.intentClassification.needsClarification` and cannot change during `executeAction`. The implementation would naturally just read the existing value, but the phrasing could cause confusion.

   **Fix:** Rephrase to "read `needsClarification` from `state.intentClassification`" rather than "check if `needsClarification` is still true."

2. [LOW] **Roadmap sub-item coverage could be more explicit.** The roadmap's "End-to-End Pipeline Wiring" group has six sub-items. Several were partially implemented in commit `92cfe8f` (confirmed commands to scheduler, auto-confirmation, read-only bypass, callback handling, stale rejection). The plan correctly focuses on remaining gaps but could be clearer about what is already done vs. what remains.

   **Fix:** Add a short "Current State" section at the top of the plan listing which roadmap sub-items are already implemented (with commit references) and which are the specific gaps being addressed. This prevents re-implementation of existing functionality.

## Verdict Rationale

The plan is **REJECTED** due to two HIGH findings:

**HIGH-1** (Step 1 payload validation) would prevent draft creation during clarification flows, breaking a core user-facing feature. The validation must be conditional on `needsClarification`.

**HIGH-2** (Step 4 select callback) describes changes to a code path that is unreachable due to the version mismatch stale-rejection occurring earlier in the control flow. The plan must specify how to restructure the callback handling to allow select actions through.

Both findings are fixable with targeted amendments to the plan text. The overall scope, architecture compliance, security coverage, test strategy, TDD approach, and service boundary adherence are sound. The plan correctly reuses `@monica-companion/types` for Zod schemas, `@monica-companion/auth` for JWT verification, and `@monica-companion/redaction` for data sanitization. No over-engineering or boundary violations were found. Changes are contained within `ai-router` as appropriate for pending-command orchestration logic.
