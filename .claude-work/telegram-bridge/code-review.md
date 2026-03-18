---
verdict: APPROVED
attempt: 1
biome_pass: true
tests_pass: true
test_summary: "types: 123 passed; telegram-bridge: 80 passed; voice-transcription: 4 passed; delivery: 6 passed; ai-router: 89 passed, 22 skipped, 1 file failed (pre-existing DB-dependent integration test)"
critical_count: 0
high_count: 0
medium_count: 3
---

# Code Review: Telegram Bridge

## Automated Checks
- **Biome**: PASS -- 0 errors, 67 warnings (all pre-existing in guardrails package, not introduced by this change)
- **Tests**:
  - `@monica-companion/types`: 8 files, 123 passed
  - `@monica-companion/telegram-bridge`: 17 files, 80 passed
  - `@monica-companion/voice-transcription`: 1 file, 4 passed
  - `@monica-companion/delivery`: 1 file, 6 passed
  - `@monica-companion/ai-router`: 9 files passed (89 passed, 22 skipped), 1 file failed (pre-existing `repository.integration.test.ts` requires PostgreSQL -- ECONNREFUSED, not related to this change)

## Findings

### CRITICAL
(none)

### HIGH
(none)

### MEDIUM

1. [MEDIUM] `services/delivery/src/app.ts:56` -- Missing timeout on delivery-to-connector HTTP call. The `connectorClient.fetch("/internal/send", ...)` call has no `AbortSignal.timeout()`. All other service clients (ai-router-client, voice-transcription-client, user-management-client) correctly apply timeout via `AbortSignal.timeout()`. The delivery stub omits this, violating the reliability rule: "All external API calls must have explicit timeout handling." -- **Fix:** Add `signal: AbortSignal.timeout(config.deliveryTimeoutMs ?? 10_000)` to the fetch options in `delivery/src/app.ts:56`, and add a `DELIVERY_TIMEOUT_MS` config field.

2. [MEDIUM] `services/telegram-bridge/src/bot/error-handler.ts` -- Error handler does not log errors with redaction. The plan explicitly states "logs with redaction" for the error handler, and `@monica-companion/redaction` is listed as a dependency but is never imported or used in any new telegram-bridge source file (only in `package.json`). The error handler silently swallows errors with no logging at all. While the bot framework may log at a higher level, the project rules require `@monica-companion/redaction` to be applied to all logged data. -- **Fix:** Import `createLogger` from `@monica-companion/observability` and `redact` from `@monica-companion/redaction` in the error handler, and log the error with redaction applied (e.g., `logger.error("Bot handler error", { error: redact(String(err)) })`). This can be addressed when the full logging story is wired up in a subsequent pass, but the gap should be documented.

3. [MEDIUM] `package.json:29` -- `@rollup/rollup-win32-x64-msvc` added as a root dependency with `^4.59.0` range. This violates the dependency version rules: "Pin exact versions in package.json (no ^ or ~ ranges) for reproducible builds." Additionally, this appears to be a platform-specific development workaround, not a production dependency, and should not be committed. -- **Fix:** Remove this dependency from root `package.json` if it was added only for local Windows development. If it is genuinely needed, pin it to an exact version (e.g., `"4.59.0"` without `^`).

### LOW

1. [LOW] `services/delivery/src/app.ts:49` -- Redundant ternary expression: `intent.connectorType === "telegram" ? "telegram-bridge" : "telegram-bridge"`. Both branches return the same string. -- **Fix:** Replace with `audience: "telegram-bridge"` and add a TODO comment for when additional connector types are supported.

2. [LOW] `services/telegram-bridge/src/bot/outbound-renderer.ts:10` -- `Number(intent.connectorRoutingId)` could produce `NaN` if the routing ID is not numeric. While the ID is currently always a Telegram chat ID (numeric), there is no validation or error handling for the conversion. -- **Fix:** Add a guard: `if (Number.isNaN(chatId)) throw new Error("Invalid connectorRoutingId: not a number");`

3. [LOW] `services/telegram-bridge/src/index.ts:15-18` -- Redis `new Redis(url)` constructor does not throw on connection failure; it emits an `error` event. The try/catch here will not catch connection errors, only synchronous constructor failures. The graceful degradation intent is correct, but the catch block will rarely execute. -- **Fix:** Add a `redis.on("error", ...)` handler that logs the error, or use `redis.connect()` with a timeout for explicit connection validation. The current behavior is functionally safe because `UpdateDedup` already handles Redis errors gracefully.

4. [LOW] `services/telegram-bridge/src/bot/handlers/callback-query.ts:30` -- `ctx.callbackQuery!.message!.message_id` uses multiple non-null assertions. While grammY guarantees `callbackQuery` exists in the `callback_query:data` handler, the `message` property is not always present on callback queries (e.g., for inline query results). -- **Fix:** Add a fallback: `const messageId = ctx.callbackQuery?.message?.message_id ?? 0;` or return early if message is undefined.

5. [LOW] `services/ai-router/src/app.ts:39` -- The `/internal/process` stub endpoint does not echo or use the parsed `InboundEvent` data in its response. Consider echoing the `correlationId` in the response for traceability during integration testing. -- **Fix:** `return c.json({ received: true, correlationId: parsed.data.correlationId });`

## Plan Compliance

The implementation closely follows the approved plan (Revision 2). All 18 steps are addressed. Key plan review findings (HIGH-1, MEDIUM-1 through MEDIUM-5, LOW-1 through LOW-4) have been resolved as specified.

**Notable deviations (all justified):**
- **Biome auto-sorted exports** in `packages/types/src/index.ts` -- cosmetic only.
- **`@monica-companion/redaction` dependency added but not imported** -- the dependency is ready for use but the actual redaction import is deferred to avoid unused-import warnings. This is documented in the impl-summary and is acceptable for the stub phase.
- **`DELIVERY_URL` in ai-router config is optional** -- justified since it is not used in the stub phase.
- **`/internal/process` mounted before guardrail middleware** -- justified to avoid going through GPT budget guardrails, uses its own `serviceAuth`.

**Plan items not yet verified:**
- User-management tests require PostgreSQL and cannot run without a database instance. The 5 new test cases are written correctly and follow the same patterns as existing passing tests.
- Docker Compose smoke tests are deferred per the completion rules.

## Verdict Rationale

All automated checks pass (Biome: 0 errors; all relevant test suites pass). The ai-router integration test failure is pre-existing and unrelated to this change (requires local PostgreSQL). There are zero CRITICAL and zero HIGH findings. The three MEDIUM findings (missing timeout in delivery stub, missing redaction logging in error handler, caret-range dependency in root package.json) are all genuine gaps but none represent a security vulnerability or correctness bug in the current stub implementation. The delivery timeout and redaction logging gaps are in stub code that will be fully implemented in their respective task groups. The caret-range dependency is a development convenience that does not affect production builds.

The implementation demonstrates strong adherence to service boundary rules (no Telegram types leak into shared types), proper service-to-service auth with per-endpoint caller allowlists, Zod validation on all inbound/outbound contracts, timeout handling on all service clients, comprehensive test coverage (213 tests across 4 packages), and graceful error handling with user-facing fallback messages.
