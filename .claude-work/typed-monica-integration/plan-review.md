---
verdict: APPROVED
attempt: 1
findings_critical: 0
findings_high: 0
findings_medium: 2
findings_low: 4
---

# Plan Review: Typed Monica Integration

## Findings

### CRITICAL
(none)

### HIGH
(none)

### MEDIUM

1. [MEDIUM] **Missing userId guard in route handlers.** The plan states each route handler "Extracts userId from JWT context" (Steps 10-11), but `getUserId()` from `@monica-companion/auth` returns `string | undefined`. The JWT `sub` claim is optional in `ServiceTokenPayloadSchema`. If a service-to-service call omits `sub`, the credential resolution call will fail with an opaque error rather than a clean 400.

   **Fix:** Add an explicit check in each route handler (or a shared middleware) that rejects with 400 if `userId` is undefined. Create a utility like `requireUserId(c: Context): string` that throws a well-formed 400 response.

2. [MEDIUM] **Stub credential endpoint lacks a safety guard against production use.** Step 14 adds a temporary stub on `user-management` that returns `MONICA_BASE_URL` and `MONICA_API_TOKEN` from environment variables as plaintext credentials. There is no runtime guard to prevent this stub from being accidentally deployed to production.

   **Fix:** Gate the stub endpoint behind an explicit environment check, e.g., only register the route when `NODE_ENV !== "production"` or when `ENABLE_CREDENTIAL_STUB=true` is set. Log a startup warning when the stub is active.

### LOW

1. [LOW] **Logger callback type diverges from existing codebase convention.** Step 4 defines the client as accepting `logger?: (msg: string, attrs?) => void`. The existing codebase uses `StructuredLogger` from `@monica-companion/observability` with `info()`, `warn()`, `error()`, `debug()` methods.

   **Fix:** Accept `StructuredLogger` (or a `{ info, warn, error, debug }` interface) instead of a raw callback.

2. [LOW] **`contactFieldTypeId` in the internal contract leaks a Monica concept.** Acceptable for V1 pragmatism, but acknowledge this as a known boundary leak.

3. [LOW] **Route file proliferation in Step 11.** 8 separate route files for simple handlers. Consider grouping by access pattern: `routes/read.ts`, `routes/write.ts`, `routes/reference.ts`.

4. [LOW] **No mention of request body size limits on `monica-integration` internal endpoints.** Apply Hono's `bodyLimit` middleware on the `/internal` route group.

## Verdict Rationale

The plan is well-structured, comprehensive, and architecturally sound. It correctly covers all three roadmap sub-items. Architecture boundaries are respected, DRY principles followed, security properly handled. The two MEDIUM findings are straightforward to address during implementation.
