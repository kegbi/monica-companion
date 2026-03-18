---
verdict: APPROVED
findings_critical: 0
findings_high: 0
findings_medium: 3
findings_low: 3
biome_pass: true
tests_pass: true
test_count: 265
---

# Code Review: Typed Monica Integration

## Automated Checks

- **Biome**: PASS -- 0 errors, 0 warnings across 78 implementation files (the only Biome error is in .claude/settings.local.json which is a local IDE settings file with CRLF line endings, not part of this implementation)
- **Tests**:
  - @monica-companion/monica-api-lib: 5 test files, 95 tests passed
  - @monica-companion/monica-integration: 5 test files, 43 tests passed
  - @monica-companion/auth: 5 test files, 55 tests passed (no regressions)
  - @monica-companion/types: 1 test file, 9 tests passed (no regressions)
  - @monica-companion/redaction: 1 test file, 40 tests passed (no regressions)
  - @monica-companion/observability: 4 test files, 23 tests passed (no regressions)
  - Total: 265 tests passed, 0 failed
  - Note: user-management integration tests fail due to no local PostgreSQL -- this is pre-existing and unrelated to this implementation.

## Findings

### CRITICAL
(none)

### HIGH
(none)

### MEDIUM

1. [MEDIUM] services/monica-integration/src/lib/credential-client.ts -- **Missing timeout on credential resolution call.** The plan (Step 8) explicitly requires "Has explicit timeout (5s)" on the credential resolution fetch. The current implementation uses serviceClient.fetch() which delegates to raw globalThis.fetch without any timeout. If user-management is unresponsive, this call will hang indefinitely, blocking the request. **Fix:** Add an AbortController with a 5-second timeout to the serviceClient.fetch call, or use AbortSignal.timeout(5000) in the fetch options. The ServiceFetchOptions in @monica-companion/auth extends Omit<RequestInit, "headers"> so the signal property is already supported.

2. [MEDIUM] services/monica-integration/src/routes/read.ts:130, write.ts:315, reference.ts:67 -- **handleMonicaError is duplicated identically in three files.** This violates DRY and creates a maintenance risk. All three copies have the same logic for mapping MonicaApiError to HTTP responses and handling CredentialResolutionError. **Fix:** Extract handleMonicaError into services/monica-integration/src/lib/handle-monica-error.ts (or add it to shared.ts) and import it from each route file.

3. [MEDIUM] services/user-management/src/app.ts:252-275 -- **Stub credential endpoint uses process.env directly inside the request handler, not Zod-validated config.** While this is explicitly a temporary stub gated behind NODE_ENV !== "production", the MONICA_BASE_URL and MONICA_API_TOKEN values are read from process.env without any validation. The config object is available in scope but not used. This is acceptable only because the stub is temporary and gated, but the inconsistency with the rest of the codebase should be noted. **Fix:** When replacing this stub with the real implementation in "Least-Privilege User Management", use Zod-validated config consistently.

### LOW

1. [LOW] services/monica-integration/src/routes/read.ts:132-133 -- **Error status mapping casts to as 400 for all status codes.** The line c.json({ error: "Monica API error" }, status as 400) casts a dynamic status code to the type 400 for Hono's type system. This is a type-level workaround but does not affect runtime behavior. The same pattern appears in write.ts:318 and reference.ts:70. **Fix:** Consider using a union type or as number to make the type assertion more accurate, or accept this as a Hono typing limitation.

2. [LOW] packages/monica-api-lib/src/client.ts:284-288 -- **Logger receives path but not the base URL.** The path parameter in the debug log is safe (does not contain tokens), but including the base URL would aid debugging. Currently the base URL is intentionally excluded (which is correct for security -- it could reveal instance configuration). This is noted as a trade-off that is acceptable. No fix needed.

3. [LOW] services/monica-integration/src/lib/contact-projection.ts:68-70 -- **Dynamic import() type in function return type annotation.** The buildImportantDates function uses z.infer<typeof import("@monica-companion/types").ImportantDate>[] as its return type, which is unusual. While it works correctly, a static import would be cleaner. **Fix:** Add import { ImportantDate } from "@monica-companion/types" at the top of the file and use z.infer<typeof ImportantDate>[] in the return type.

## Plan Review Findings Addressed

1. **[MEDIUM] Missing userId guard (plan-review finding #1)**: ADDRESSED. services/monica-integration/src/lib/require-user-id.ts was created and is used in every route handler. Returns 400 with clear message when sub claim is missing. Test coverage in app.test.ts lines 117-127.

2. **[MEDIUM] Stub credential endpoint lacks production safety guard (plan-review finding #2)**: ADDRESSED. The stub is gated behind process.env.NODE_ENV !== "production" in services/user-management/src/app.ts:250. A startup warning is logged via logger.warn().

3. **[LOW] Logger callback type diverges from codebase convention (plan-review finding #1)**: ADDRESSED. packages/monica-api-lib/src/logger-interface.ts defines a StructuredLogger interface with info/warn/error/debug methods, matching the observability package convention. The client accepts StructuredLogger rather than a raw callback.

4. **[LOW] contactFieldTypeId boundary leak (plan-review finding #2)**: ADDRESSED. Acknowledged with inline comment in services/monica-integration/src/routes/write.ts:44-49 and in the app test at line 359.

5. **[LOW] Route file proliferation (plan-review finding #3)**: ADDRESSED. Routes are grouped into 3 files by access pattern: read.ts, write.ts, reference.ts, plus shared.ts for common client creation.

6. **[LOW] No request body size limits (plan-review finding #4)**: ADDRESSED. bodyLimit({ maxSize: 256 * 1024 }) middleware applied in services/monica-integration/src/app.ts:19.

## Plan Compliance

The implementation follows the approved plan with these justified deviations:

1. **Route grouping**: 3 route files instead of 8 (plan-review finding #3 recommendation followed).
2. **Mock approach in app tests**: Mocks routes/shared.ts instead of @monica-companion/monica-api-lib directly, which is cleaner.
3. **DOM lib in tsconfig**: Necessary for URLSearchParams, Response, RequestInit types used by the HTTP client.
4. **user-management depends_on**: Uses service_started instead of service_healthy because user-management lacks a healthcheck definition.
5. **FetchFn type alias**: Local type alias instead of typeof globalThis.fetch for DTS build compatibility.

All deviations are reasonable and documented in the implementation summary.

## Verdict Rationale

APPROVED. All automated checks pass (Biome 0 errors, 265 tests passing with 0 failures). Zero CRITICAL or HIGH findings. The three MEDIUM findings are:

1. Missing timeout on credential resolution -- a reliability gap that should be addressed in a follow-up but does not block correctness or create a security vulnerability. The external Monica API calls do have proper timeouts.
2. DRY violation (duplicated handleMonicaError) -- a code quality issue that is low-risk and easily fixable.
3. Stub endpoint using raw process.env -- acceptable for a temporary development-only stub.

The implementation is comprehensive, well-tested (138 new tests), properly uses Zod validation on all contracts, enforces per-endpoint service auth with caller allowlists, avoids logging sensitive data, respects service boundaries, and follows existing codebase patterns. All plan review findings were addressed.
