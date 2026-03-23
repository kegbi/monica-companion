# Implementation Summary: Stage 4 -- Read-Only Query & Write Tool Handlers

## Files Changed

| File | Action | Description |
|------|--------|-------------|
| `services/ai-router/src/agent/tools.ts` | modified | Added Zod schemas for `query_birthday`, `query_phone`, `query_last_note` (exported); registered them in `TOOL_ARG_SCHEMAS`; added `.max(255)` to `CreateActivityArgsSchema.description` (M2 fix) |
| `services/ai-router/src/agent/tool-handlers/query-birthday.ts` | created | Read-only handler: fetches contact from monica-integration, extracts birthdate from importantDates |
| `services/ai-router/src/agent/tool-handlers/query-phone.ts` | created | Read-only handler: fetches contact fields from monica-integration, filters for phone type entries |
| `services/ai-router/src/agent/tool-handlers/query-last-note.ts` | created | Read-only handler: fetches latest note (limit=1) from monica-integration |
| `services/ai-router/src/agent/tool-handlers/mutating-handlers.ts` | created | `executeMutatingTool()` function mapping LLM tool args to `ConfirmedCommandPayload` and calling `SchedulerClient.execute()`; includes `fetchContactFieldTypeId()` helper and `parseDateString()` utility; uses `PENDING_COMMAND_VERSION` constant (M3 fix); defaults address `name` to `"Main"` (M5 fix) |
| `services/ai-router/src/agent/loop.ts` | modified | Added `schedulerClient` to `AgentLoopDeps`; replaced read-only stub dispatch with `executeReadOnlyTool()` helper (M4 fix); replaced `handleConfirm` stub execution with real `executeMutatingTool()` call; imported all new handlers |
| `services/ai-router/src/app.ts` | modified | Added `schedulerClient` to `agentDeps` wiring |
| `services/monica-integration/src/routes/read.ts` | modified | Added `GET /contacts/:contactId/contact-fields` endpoint with `aiRouterAuth`, using `ContactField.safeParse()` to validate each field entry |
| `services/monica-integration/src/routes/reference.ts` | modified | Split global `schedulerAuth` middleware into per-endpoint auth: `schedulerOnlyAuth` on `/genders`, `schedulerAndAiRouterAuth` on `/contact-field-types` (M1 fix) |
| `services/ai-router/src/agent/__tests__/tools.test.ts` | modified | Updated test from "has no entries for read-only tools except search_contacts" to "has an entry for every read-only tool" |
| `services/monica-integration/src/__tests__/app.test.ts` | modified | Added `getContactWithFields` to default mock client; added tests for contact-fields endpoint and per-endpoint auth on reference routes |

## Tests Added

| Test File | What It Tests |
|-----------|---------------|
| `services/ai-router/src/agent/__tests__/tools-schemas.test.ts` | Validates `TOOL_ARG_SCHEMAS` entries exist and correctly validate/reject args for `query_birthday`, `query_phone`, `query_last_note` (10 tests) |
| `services/ai-router/src/agent/tool-handlers/__tests__/query-birthday.test.ts` | `handleQueryBirthday`: successful lookup, no birthday, unknown year, fetch error, non-200 response, correct URL (6 tests) |
| `services/ai-router/src/agent/tool-handlers/__tests__/query-phone.test.ts` | `handleQueryPhone`: phone fields present, no phone fields, multiple phones, fetch error, non-200, correct URL (6 tests) |
| `services/ai-router/src/agent/tool-handlers/__tests__/query-last-note.test.ts` | `handleQueryLastNote`: note present, no notes, fetch error, non-200, limit=1 in URL (5 tests) |
| `services/ai-router/src/agent/tool-handlers/__tests__/mutating-handlers.test.ts` | `executeMutatingTool` for all 7 mutating tools, scheduler error, unknown tool, idempotency key format; `fetchContactFieldTypeId`; `parseDateString` (17 tests) |
| `services/ai-router/src/agent/__tests__/loop.test.ts` (modified) | Updated: `query_birthday` dispatches to handler (not stub); validation error for invalid args; unknown tool returns error; confirm calls `executeMutatingTool`; confirm with scheduler error (+5 new/updated tests) |
| `services/monica-integration/src/__tests__/app.test.ts` (modified) | Contact-fields endpoint: 200 with fields, 400 invalid ID, skips unparseable fields, 403 for scheduler; per-endpoint auth on reference routes (+6 new tests) |

## Verification Results

- **Biome**: `pnpm exec biome check --write` -- 9 files auto-fixed (formatting only), 8 warnings remaining (all pre-existing unused variable warnings). No errors.
- **Tests (ai-router)**: 592 passed, 35 skipped, 1 pre-existing integration test failed (requires live PostgreSQL). 47 of 49 test files pass.
- **Tests (monica-integration)**: Cannot run in current environment due to pre-existing pnpm symlink resolution issues on Windows. Code verified through pattern consistency with existing working endpoints.

## Plan Review Findings Addressed

| Finding | Resolution |
|---------|-----------|
| M1 - Reference route over-permissioning | Split into per-endpoint auth: `schedulerOnlyAuth` on `/genders`, `schedulerAndAiRouterAuth` on `/contact-field-types` |
| M2 - create_activity 255-char truncation | Added `.max(255)` to `CreateActivityArgsSchema.description` for early validation |
| M3 - Hardcoded idempotency key | Used `PENDING_COMMAND_VERSION` constant: `` `${pendingCommandId}:v${PENDING_COMMAND_VERSION}` `` |
| M4 - Duplicated dispatch pattern | Extracted `executeReadOnlyTool()` helper in loop.ts, eliminating 4 copies of JSON-parse-validate-dispatch |
| M5 - Missing address name field | Added `name: "Main"` default in the `update_contact_address` payload mapper |

## Plan Deviations

- The `SearchContactsArgsSchema` import was removed from loop.ts since the `executeReadOnlyTool` helper now uses `TOOL_ARG_SCHEMAS[toolName]` for all read-only tools uniformly, including `search_contacts`.
- The plan specified separate test files per step. Instead, the new loop test cases were added directly to the existing `loop.test.ts` file to follow the established pattern.

## Code Review Fixes Applied

### HIGH-1: writeRoutes global middleware blocking ai-router on reference routes (FIXED)

**File:** `services/monica-integration/src/routes/write.ts`

**Problem:** The `writeRoutes` function used a global `routes.use(schedulerAuth)` middleware that leaked scheduler-only auth to sibling route groups (`referenceRoutes`) when all three sub-routers were mounted at the same `/` prefix via `internal.route("/", ...)` in `app.ts`. This caused `ai-router` tokens to be rejected with 403 on `GET /internal/contact-field-types`, even though `reference.ts` correctly defined `schedulerAndAiRouterAuth` on that endpoint.

**Fix:** Removed the global `routes.use(schedulerAuth)` and applied `schedulerAuth` as inline per-endpoint middleware on all six write endpoints (same pattern already used in `reference.ts`). This prevents the middleware from leaking to sibling route groups.

**Verification:**
- Biome: PASS (no fixes needed)
- monica-integration tests: 59 passed, 0 failed (previously 58 passed, 1 failed)
- ai-router tests: 592 passed, 35 skipped, 1 pre-existing integration failure (requires live PostgreSQL)

## Residual Risks

- **No contactFieldTypeId caching**: Each `update_contact_phone` and `update_contact_email` call makes a fresh HTTP request to resolve the type ID. Acceptable for V1; caching deferred to future.
- **Smoke tests not updated**: Docker Compose smoke tests were not added in this implementation. The plan notes smoke tests should verify the actual network path, but the smoke test infrastructure was not in scope for this PR.
- **Roadmap not marked complete**: Per project rules, the roadmap item should only be marked complete after Docker Compose smoke tests pass against the live stack.
- **MEDIUM-1 (duplicate PENDING_COMMAND_VERSION constant)**: Not fixed in this pass. Documented for future cleanup.
- **LOW-1 (unused `text` variable)**: Not fixed in this pass.
- **LOW-2 (`as` type assertions instead of Zod)**: Not fixed in this pass. Accepted as V1 pragmatism.
