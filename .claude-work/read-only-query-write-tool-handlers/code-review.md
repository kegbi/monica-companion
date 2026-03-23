---
verdict: REJECTED
attempt: 1
biome_pass: true
tests_pass: false
test_summary: "ai-router: 592 passed, 35 skipped, 1 pre-existing integration failure (requires live PostgreSQL). monica-integration: 58 passed, 1 failed."
critical_count: 0
high_count: 1
medium_count: 1
low_count: 2
---

# Code Review: Stage 4 -- Read-Only Query & Write Tool Handlers

## Automated Checks
- **Biome**: PASS -- zero errors in both `ai-router` and `monica-integration`. 128 warnings in ai-router are all pre-existing (unused constructors, `any` types in legacy test files). 0 warnings in monica-integration.
- **Tests (ai-router)**: 592 passed, 35 skipped. 1 pre-existing integration test failure (`repository.integration.test.ts` requires live PostgreSQL -- not related to this change).
- **Tests (monica-integration)**: 58 passed, 1 FAILED. `GET /internal/contact-field-types (per-endpoint auth - M1) > returns 200 when called by ai-router` fails with status 403 instead of expected 200.

## Findings

### CRITICAL
(none)

### HIGH

1. [HIGH] `services/monica-integration/src/routes/write.ts:73` / `services/monica-integration/src/app.ts:35` -- **writeRoutes global scheduler middleware blocks ai-router on reference routes**. The `writeRoutes` function registers a global `routes.use(schedulerAuth)` middleware (scheduler-only: `allowedCallers: ["scheduler"]`). When all three sub-routers (readRoutes, writeRoutes, referenceRoutes) are mounted at the same prefix via `internal.route("/", ...)`, Hono's route merging causes the writeRoutes' global middleware to also intercept requests destined for reference routes. This means `ai-router` tokens are rejected with 403 on `GET /internal/contact-field-types`, even though `reference.ts` correctly defines `schedulerAndAiRouterAuth` with `allowedCallers: ["scheduler", "ai-router"]` on that endpoint. The test correctly catches this bug. This blocks `update_contact_phone` and `update_contact_email` flows because `fetchContactFieldTypeId` calls this endpoint. -- **Fix:** In `services/monica-integration/src/routes/write.ts`, remove the global `routes.use(schedulerAuth)` at line 73 and instead apply `schedulerAuth` as inline per-route middleware on each write endpoint (e.g., `routes.post("/contacts", schedulerAuth, async (c) => { ... })`). This prevents the middleware from leaking to sibling route groups mounted on the same parent Hono instance.

### MEDIUM

1. [MEDIUM] `services/ai-router/src/agent/tool-handlers/mutating-handlers.ts:12` and `services/ai-router/src/agent/loop.ts:40` -- **Duplicate `PENDING_COMMAND_VERSION` constant**. Two independent copies of `const PENDING_COMMAND_VERSION = 1` exist. The comment in mutating-handlers.ts says "must match the constant in loop.ts" but there is no compile-time enforcement. If one is updated without the other, idempotency key mismatches will occur silently. -- **Fix:** Export the constant from a single shared location (e.g., `loop.ts` exports it, `mutating-handlers.ts` imports it), or extract it into a shared constants module within `ai-router`. Acceptable to defer to a future cleanup if documented.

### LOW

1. [LOW] `services/ai-router/src/agent/tool-handlers/mutating-handlers.ts:204` and `services/ai-router/src/agent/tool-handlers/query-birthday.ts:37` -- **Unused `text` variable**. In `fetchContactFieldTypeId`, line 204: `const text = await response.text().catch(() => "unknown")` is computed but `text` is never referenced in the error message or log output. Same pattern in `query-birthday.ts:37`. -- **Fix:** Either remove the unused `text` fetch, or include it in the error/log: e.g., `throw new Error(\`Failed to fetch contact field types: ${response.status} ${text}\`)`.

2. [LOW] `services/ai-router/src/agent/tool-handlers/query-birthday.ts:50`, `query-phone.ts:46`, `query-last-note.ts:48` -- **Response parsing uses `as` type assertions instead of Zod validation**. The read-only handlers cast the response JSON with `as { ... }` rather than validating with a Zod schema. While the data comes from a trusted internal service, Zod parsing would provide better error messages if the internal API contract changes. -- **Fix:** Consider adding lightweight Zod schemas for the internal response shapes, or accept as V1 pragmatism and document the trust boundary assumption.

## Plan Compliance

The implementation follows the approved plan closely with justified deviations:

1. **All 8 plan steps were implemented**: Zod schemas added (Step 1), contact-fields endpoint added (Step 2), reference route auth updated (Step 3), read-only handlers created (Step 4), mutating handlers created (Step 5), loop wired up (Step 6), AgentLoopDeps extended and handleConfirm updated (Step 7), existing tests updated (Step 8).

2. **All 5 plan review MEDIUM findings were addressed**:
   - M1 (per-endpoint auth): Implemented correctly in `reference.ts`, but effectiveness is blocked by the writeRoutes global middleware (see HIGH-1).
   - M2 (255-char limit): `.max(255)` added to `CreateActivityArgsSchema.description`.
   - M3 (PENDING_COMMAND_VERSION constant): Used the constant, though duplicated (see MEDIUM-1).
   - M4 (extracted executeReadOnlyTool): Implemented as a clean helper function.
   - M5 (default "Main" address name): Added `name: "Main"` in the mapper.

3. **Justified deviations**: The `SearchContactsArgsSchema` import removal from loop.ts and adding loop test cases to the existing `loop.test.ts` file rather than separate files are both reasonable and documented in the impl summary.

4. **Test coverage**: 10 schema tests, 6 birthday tests, 6 phone tests, 5 last-note tests, 17 mutating handler tests, 5 updated loop tests, 6 new monica-integration tests = 55 new tests total. Comprehensive coverage matching or exceeding the plan.

## Verdict Rationale

REJECTED due to one HIGH finding. The `writeRoutes` global `routes.use(schedulerAuth)` middleware in `write.ts:73` leaks scheduler-only auth to all sibling route groups mounted on the same Hono parent, causing the `contact-field-types` endpoint to reject `ai-router` callers with 403. This is confirmed by a real test failure in `monica-integration`. The fix is straightforward: convert the global middleware in `write.ts` to per-endpoint inline middleware. Once fixed, the implementation is otherwise solid -- clean code, proper service boundaries, comprehensive test coverage, and all plan review findings addressed.
