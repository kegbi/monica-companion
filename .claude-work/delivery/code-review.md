---
verdict: APPROVED
attempt: 1
biome_pass: true
tests_pass: true
test_summary: "157 passed (141 types + 16 delivery), 0 failed"
critical_count: 0
high_count: 0
medium_count: 2
---

# Code Review: Delivery

## Automated Checks
- **Biome**: PASS -- 0 errors, 0 warnings on all changed files (18 files checked). Pre-existing warning in `packages/types/src/__tests__/commands.test.ts` (unused imports) is unrelated to this change.
- **Tests (types)**: 9 test files, 141 tests passed (includes 11 new delivery type tests)
- **Tests (delivery)**: 2 test files, 16 tests passed (6 config + 10 app)

## Findings

### CRITICAL
(none)

### HIGH
(none)

### MEDIUM

1. [MEDIUM] `services/delivery/src/app.ts:44-46` and `services/delivery/src/app.ts:50-52` -- Validation rejection responses (invalid JSON body, invalid payload) do not persist audit records. The plan (Step 4) specifies: "On validation failure: insert audit with 'rejected', return 400". The current implementation returns 400 with `status: "rejected"` in the JSON response body, but no database audit row is written for rejections. This diverges from the plan's "insert audit with rejected" requirement, though the 400 response itself is correct. -- **Fix:** Either insert a rejection audit record for invalid payloads (requires extracting userId/correlationId from the raw body if available, which may not always be possible) or explicitly document this as an accepted deviation since the payload may lack the fields needed to populate the audit row. The current behavior is pragmatically reasonable because a malformed payload may not contain the required audit fields (userId, correlationId, connectorType, etc.), making audit insertion impossible without nullable columns.

2. [MEDIUM] `services/delivery/src/app.ts:154` -- The error message from connector failures is passed through directly to the HTTP response body: `c.json({ deliveryId: auditId, status: "failed", error: errorMessage }, 502)`. While the callers are internal services (ai-router, scheduler), transport-level error messages could potentially contain internal infrastructure details (hostnames, ports, stack traces). The plan's security section states "No sensitive data in errors: Transport-level failure info only." -- **Fix:** Consider sanitizing or truncating the error message before including it in the response. A simple approach would be to map known error types (AbortError, connection refused, etc.) to generic messages, or cap the error string length. The audit row can store the full error for debugging.

### LOW

1. [LOW] `services/delivery/src/app.ts:94` -- Tautological ternary: `intent.connectorType === "telegram" ? "telegram-bridge" : "telegram-bridge"`. Both branches produce the same value. This is pre-existing (confirmed in the committed version) and acceptable for V1 since only Telegram is supported, but should be cleaned up when multi-connector support is added. -- **Fix:** Replace with `"telegram-bridge"` or a proper connector-to-audience map when adding new connectors.

2. [LOW] `services/delivery/package.json` -- `@monica-companion/redaction` is listed as a dependency but is never imported in any delivery source file. This is a pre-existing dependency (present before this change) and is a standard inclusion across all services. -- **Fix:** No action needed now. When redaction is needed for structured logging of payloads, the import is already available.

3. [LOW] `services/delivery/vitest.config.ts:5-6` -- Hardcoded version strings in pnpm store paths (e.g., `hono@4.12.8`, `zod@4.3.6`, `drizzle-orm@0.45.1`). These will break when dependencies are updated. This follows the same pattern as `services/ai-router/vitest.config.ts` and is a known monorepo workaround. -- **Fix:** Track as tech debt. Consider a shared vitest config helper or workspace-level path resolution.

4. [LOW] `packages/types/src/index.ts:76` -- One blank line between the `transcription` and `user-management` export blocks was removed. This is cosmetic and has no functional impact. -- **Fix:** None needed.

## Plan Compliance

The implementation follows the approved plan with the following observations:

1. **Step 1 (DeliveryResponseSchema)**: Fully implemented. Schema uses `DeliveryResponseStatusSchema` naming instead of `DeliveryAuditStatusSchema` mentioned in the plan. This is a reasonable naming improvement since the schema represents API response status, not internal audit status.

2. **Step 2 (Drizzle schema and DB connection)**: Fully implemented. Table schema matches the plan specification exactly. `createDb()` returns `{db, sql}` to support `sql.end()` as requested in the plan review.

3. **Step 3 (Config and dependencies)**: Fully implemented. All dependencies use `catalog:` references. `DATABASE_URL` required, `HTTP_TIMEOUT_MS` defaults to 10000.

4. **Step 4 (app.ts refactoring)**: Implemented with audit persistence, `AbortSignal.timeout()`, OpenTelemetry spans, 503 on DB failure. Minor deviation: rejection audit records not persisted for invalid payloads (MEDIUM finding #1).

5. **Step 5 (index.ts wiring)**: Fully implemented with `sql.end()` in shutdown handler.

6. **Step 6 (Docker Compose)**: Fully implemented. `DATABASE_URL` and `HTTP_TIMEOUT_MS` added to delivery container.

7. **Step 7 (Tests)**: All 16 delivery tests and 141 types tests pass.

8. **Step 8 (Smoke tests)**: Not executed. Documented as pending in the implementation summary, which is acceptable per project rules -- smoke tests are required before marking roadmap items complete, and the roadmap has not been updated.

9. **Step 9 (Roadmap)**: Correctly NOT marked as complete, since smoke tests have not been run.

**Deviations from plan:**
- `vitest.config.ts` added (not in plan) -- justified as test infrastructure requirement.
- `createDb()` returns `{db, sql}` instead of just `db` -- justified by plan review LOW finding.
- Rejection audit records not persisted -- pragmatic decision since invalid payloads may lack required audit fields.

## Verdict Rationale

APPROVED. All automated checks pass with zero errors. All 157 tests pass. The implementation faithfully follows the approved plan across all 9 steps. The two MEDIUM findings are not blocking: (1) rejection audit persistence is pragmatically reasonable given that malformed payloads cannot populate required audit fields, and (2) error message passthrough is limited to internal service-to-service communication where the callers are trusted. No CRITICAL or HIGH findings. Service boundaries are respected -- delivery remains connector-neutral, no Telegram-specific types leak in. Security enforcement (JWT auth, caller allowlists) is properly implemented. Reliability requirements are met with explicit timeout handling and DB failure graceful degradation.
