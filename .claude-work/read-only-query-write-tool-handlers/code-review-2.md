---
verdict: APPROVED
attempt: 2
biome_pass: true
tests_pass: true
test_summary: "ai-router: 592 passed, 35 skipped, 1 pre-existing integration failure (requires live PostgreSQL). monica-integration: 59 passed, 0 failed."
critical_count: 0
high_count: 0
medium_count: 1
low_count: 2
---

# Code Review (Re-review): Stage 4 -- Read-Only Query & Write Tool Handlers

## Automated Checks
- **Biome (ai-router)**: PASS -- zero errors. 128 warnings, all pre-existing (unused constructors, `any` types in legacy test files). 2 additional warnings for unused `text` variables in new files (LOW-1 carry-over, warnings only, not errors).
- **Biome (monica-integration)**: PASS -- zero errors, zero warnings.
- **Tests (ai-router)**: 592 passed, 35 skipped. 1 pre-existing integration test failure (`repository.integration.test.ts` requires live PostgreSQL -- not related to this change).
- **Tests (monica-integration)**: 59 passed, 0 failed. Previously failing test (`GET /internal/contact-field-types` returning 403 for ai-router) now passes.

## Previous Findings Status

### HIGH-1 (writeRoutes global middleware) -- FIXED
**Previous:** `services/monica-integration/src/routes/write.ts` used global `routes.use(schedulerAuth)` that leaked scheduler-only auth to sibling route groups, blocking ai-router on reference routes.

**Verification:** The global `routes.use(schedulerAuth)` has been removed. All six write endpoints now use per-endpoint inline middleware (`routes.post("/contacts", schedulerAuth, async (c) => { ... })`). Confirmed via grep: zero `routes.use(` calls remain in `write.ts`. The test that previously failed (`GET /internal/contact-field-types` called by ai-router) now passes with status 200.

### MEDIUM-1 (duplicate PENDING_COMMAND_VERSION) -- DOCUMENTED, DEFERRED
**Status:** Still present. `PENDING_COMMAND_VERSION = 1` exists in both `loop.ts:40` and `mutating-handlers.ts:12`. The implementation summary explicitly documents this as deferred for future cleanup. Acceptable for V1 given the comment in `mutating-handlers.ts:9` ("must match the constant in loop.ts").

### LOW-1 (unused `text` variable) -- DOCUMENTED, DEFERRED
**Status:** Still present in `mutating-handlers.ts:204` and `query-birthday.ts:37`. Documented in impl summary as not fixed. Biome reports these as warnings (not errors).

### LOW-2 (`as` type assertions instead of Zod) -- DOCUMENTED, DEFERRED
**Status:** Still present. Read-only handlers use `as { ... }` type assertions for internal API response parsing. Documented in impl summary as accepted V1 pragmatism.

## Findings

### CRITICAL
(none)

### HIGH
(none)

### MEDIUM
1. [MEDIUM] `services/ai-router/src/agent/tool-handlers/mutating-handlers.ts:12` and `services/ai-router/src/agent/loop.ts:40` -- **Duplicate `PENDING_COMMAND_VERSION` constant** (carry-over from review 1). Two independent copies with no compile-time enforcement. Explicitly deferred and documented. -- **Fix:** Export from a single shared location in a future cleanup pass.

### LOW
1. [LOW] `services/ai-router/src/agent/tool-handlers/mutating-handlers.ts:204` and `services/ai-router/src/agent/tool-handlers/query-birthday.ts:37` -- **Unused `text` variable** (carry-over from review 1). Response body is fetched but never referenced. -- **Fix:** Either include `text` in the error message or prefix with underscore (`_text`).

2. [LOW] `services/ai-router/src/agent/tool-handlers/query-birthday.ts:50`, `query-phone.ts:46`, `query-last-note.ts:48` -- **Response parsing uses `as` type assertions instead of Zod** (carry-over from review 1). Internal API responses are cast without runtime validation. -- **Fix:** Consider lightweight Zod schemas for internal response shapes, or accept as V1 pragmatism.

## Plan Compliance

The implementation follows the approved plan closely. All 8 plan steps were implemented. All 5 plan review MEDIUM findings (M1-M5) were addressed. The HIGH-1 fix from the first code review has been correctly applied using per-endpoint inline middleware in both `write.ts` and `reference.ts`. No unjustified deviations.

Justified deviations documented in the impl summary:
- `SearchContactsArgsSchema` import removed from `loop.ts` (replaced by generic `TOOL_ARG_SCHEMAS[toolName]` lookup in `executeReadOnlyTool`).
- New loop test cases added to existing `loop.test.ts` rather than separate files.
- MEDIUM-1, LOW-1, LOW-2 explicitly deferred and documented.

## Unintended Removals Check

- `.env.example`: No changes.
- `docker-compose.yml`: No changes.
- `pnpm-workspace.yaml`: No changes.
- Barrel exports: No existing exports removed.
- The only deletions in the diff are: (1) the old `routes.use(schedulerAuth)` line in `write.ts` (intentional fix for HIGH-1), (2) the old search_contacts-specific code block in `loop.ts` (replaced by the generalized `executeReadOnlyTool` helper), and (3) the old stub code block for unimplemented tools in `loop.ts` (replaced by real handler dispatch). All deletions are intentional and plan-aligned.

## Verdict Rationale

APPROVED. The HIGH-1 finding from the previous review has been correctly fixed: `write.ts` no longer uses global `routes.use()` middleware, and all six write endpoints apply `schedulerAuth` as inline per-endpoint middleware. The previously failing test (`GET /internal/contact-field-types` accepting ai-router tokens) now passes. All automated checks pass (Biome: zero errors, Tests: 651 passed across both services). The remaining MEDIUM-1 and LOW findings are documented and explicitly deferred, with no impact on correctness or security. No new issues were introduced by the fix.
