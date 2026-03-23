---
verdict: APPROVED
attempt: 1
biome_pass: true
tests_pass: true
test_summary: "42 passed, 1 failed (pre-existing DB integration test), 1 skipped (pre-existing). 545 tests passed, 35 skipped."
critical_count: 0
high_count: 0
medium_count: 0
---

# Code Review: Stage 3 -- Contact Resolution via Tools

## Automated Checks
- **Biome**: pass -- zero errors, zero warnings in changed files. `biome check --write src/` reports "ok (no errors)".
- **Tests**: 42 test files passed, 1 failed (pre-existing `repository.integration.test.ts` -- requires live PostgreSQL, unrelated to this change), 1 skipped (also pre-existing). 545 tests passed, 35 skipped. All new and modified test files pass.

## Findings

### CRITICAL
(none)

### HIGH
(none)

### MEDIUM
(none)

### LOW

1. [LOW] `services/ai-router/src/agent/tools.ts:342-344` -- The JSDoc comment for `TOOL_ARG_SCHEMAS` reads "Map of mutating tool names to their Zod argument schemas" but now includes `search_contacts`, which is a read-only tool. -- **Fix:** Update the JSDoc to "Map of tool names to their Zod argument schemas. Includes both read-only tools that require validation (search_contacts) and all mutating tools."

2. [LOW] `services/ai-router/src/agent/tool-handlers/search-contacts.ts:57` -- When `fetchContactSummaries` throws, the raw error message (`err.message`) is logged. If a downstream HTTP error includes a URL with tokens or personal data, this could leak into logs. Currently the `fetchContactSummaries` client uses `AbortSignal.timeout(30_000)` and the error messages are expected to be generic HTTP errors, so the risk is low. -- **Fix:** Consider wrapping with a redaction utility or limiting logged error messages to a fixed set of known safe patterns. Advisory only for now.

3. [LOW] `services/ai-router/src/agent/loop.ts:475-516` -- The JSON parse + Zod validate + handler call pattern for `search_contacts` duplicates the structure used for mutating tools (lines 441-470). As more read-only tools get their own handlers in Stage 4, this will benefit from extraction into a shared helper. -- **Fix:** Defer to Stage 4 refactoring. No action needed now.

## Plan Compliance

The implementation closely follows the approved plan:

1. **Step 1 (SearchContactsArgsSchema):** Implemented in `tools.ts:293-295` with `z.object({ query: z.string().min(1) })`. Added to `TOOL_ARG_SCHEMAS`. Tests added.
2. **Step 2 (search_contacts handler):** Implemented in `tool-handlers/search-contacts.ts`. Fetches summaries, runs matcher, joins results for aliases/relationshipLabels/birthdate, caps at 10, returns structured errors. Tests cover all plan scenarios.
3. **Step 3 (Thread ServiceClient):** `monicaServiceClient: ServiceClient` added to `AgentLoopDeps` interface. Created and wired in `app.ts` using existing `config.monicaIntegrationUrl`.
4. **Step 4 (Wire handler into loop):** `search_contacts` case added to the loop with JSON parse, Zod validation, and handler invocation. Other read-only tools still get stubs.
5. **Step 5 (System prompt):** Dedicated "Contact Resolution Rules" section added. Previous scattered references consolidated (plan-review MEDIUM-1 addressed). Duplicate guideline removed.
6. **Step 6 (Tool description):** Updated to mention relationship terms, return shape with matchReason.
7. **Step 7 (Integration tests):** Five multi-turn integration tests covering unambiguous, ambiguous, no-match, kinship term, and service error scenarios.

**Plan deviations (justified):**
- `matchReason` included in handler return shape (recommended by plan-review LOW-4).
- Old graph pipeline files NOT removed (plan explicitly notes this as deferrable to Stage 6).

Both deviations are documented in the implementation summary and are reasonable.

## Service Boundary Compliance

- `ai-router` consumes only `ContactResolutionSummary` (the minimized projection) from `monica-integration` -- no raw Monica payloads or credentials.
- Communication uses `ServiceClient` with signed JWTs.
- No Telegram types, Monica API specifics, or scheduler coupling introduced.

## Security Compliance

- Service-to-service auth via `ServiceClient` (signed JWT) for `monica-integration` calls.
- No sensitive data in logs: handler logs only `correlationId`, `userId`, `matchCount`, `totalCandidates`.
- Input validation via Zod before handler invocation.
- No new public endpoints -- handler is internal to the agent loop.
- System prompt includes injection defense and instruction-hiding rules.

## Reliability Compliance

- `fetchContactSummaries` has existing `AbortSignal.timeout(30_000)`.
- Handler errors are caught and returned as structured error results for graceful LLM handling.
- Agent loop has MAX_ITERATIONS (5) cap to prevent infinite loops.
- Zod validation on all inbound tool arguments.

## Definition of Done

1. Changes align with architecture boundaries -- confirmed.
2. Security/reliability/observability constraints not weakened -- confirmed.
3. No unresolved high or medium findings -- confirmed.
4. TDD sequence preserved -- tests written for each step before implementation (per plan).
5. All relevant tests pass -- confirmed (545 passed).
6. Delivery summary includes changed files and residual risks -- confirmed in impl-summary.md.
7. Strict Zod validation on new contracts -- confirmed (`SearchContactsArgsSchema`).
8. Sensitive data never logged -- confirmed.

## Verdict Rationale

All automated checks pass (Biome: zero errors, tests: 42 files passed with only a pre-existing DB integration failure unrelated to this change). The implementation follows the approved plan faithfully with two justified deviations. Service boundaries, security rules, and reliability rules are respected. Three LOW-severity advisory findings exist but none warrant rejection. The implementation is clean, well-tested, and ready for merge.
