# Implementation Summary: Telegram /start Command Handler

## Files Changed
| File | Action | Description |
|------|--------|-------------|
| `services/telegram-bridge/src/bot/handlers/start-command.ts` | created | New /start command handler with factory pattern, reuses `UserLookupFn` type |
| `services/telegram-bridge/src/bot/handlers/__tests__/start-command.test.ts` | created | 5 test cases: unregistered user, registered user, issueSetupToken error, lookupUser error, missing ctx.from |
| `services/telegram-bridge/src/lib/user-management-client.ts` | modified | Added `issueSetupToken()` method that POSTs to `/internal/setup-tokens` |
| `services/telegram-bridge/src/lib/__tests__/user-management-client.test.ts` | created | 3 test cases: successful call, non-2xx error, timeout signal |
| `services/telegram-bridge/src/bot/setup.ts` | modified | Added `issueSetupToken` to `SetupDeps`, registered /start before userResolver, updated JSDoc |
| `services/telegram-bridge/src/bot/__tests__/setup.test.ts` | modified | Updated to expect 2 commands, verify /start before userResolver ordering |
| `services/telegram-bridge/src/app.ts` | modified | Wired `issueSetupToken` dep to `setupBot` via `userManagementClient` |
| `services/telegram-bridge/vitest.config.ts` | created | Added vitest config with pnpm alias resolution (was missing) |
| `tests/smoke/services.smoke.test.ts` | modified | Added reissue/supersede smoke test case |

## Tests Added
| Test File | What It Tests |
|-----------|---------------|
| `services/telegram-bridge/src/bot/handlers/__tests__/start-command.test.ts` | /start handler: unregistered user gets setup URL, registered user gets "already set up" message, issueSetupToken error returns fallback, lookupUser error returns fallback, missing ctx.from returns early |
| `services/telegram-bridge/src/lib/__tests__/user-management-client.test.ts` | issueSetupToken client method: correct POST body/URL/auth, response parsing, non-2xx error throwing, timeout signal |
| `services/telegram-bridge/src/bot/__tests__/setup.test.ts` (updated) | Bot setup ordering: 2 commands registered, /start before userResolver middleware, issueSetupToken in deps |
| `tests/smoke/services.smoke.test.ts` (updated) | Reissue/supersede: same telegramUserId produces different tokenId on second call |

## Verification Results
- **Biome**: `pnpm biome check` passes on all 9 changed files. No lint or format issues.
- **Tests**: 76 tests pass across 18 test files in telegram-bridge. 2 pre-existing test file failures (`app.test.ts`, `observability.test.ts`) remain -- these are caused by missing transitive `@opentelemetry/*` package aliases in the vitest config, not related to this change. These tests were failing before this work began (telegram-bridge had no vitest.config.ts at all).

## Plan Review Findings Addressed
1. **[MEDIUM] Reuse UserLookupFn**: Imported `UserLookupFn` from `../middleware/user-resolver` instead of defining duplicate `StartUserLookupFn`.
2. **[MEDIUM] lookupUser failure test**: Added test case "sends fallback error message when lookupUser throws". Implementation's try/catch wraps both `lookupUser` and `issueSetupToken`.
3. **[LOW] Smoke test overlap**: Only added incremental reissue/supersede test case; did not duplicate existing auth/response-shape tests.
4. **[LOW] JSDoc in setupBot**: Updated JSDoc to reflect full 8-step middleware ordering.
5. **[LOW] correlationId scope**: `correlationId` is a local variable in the handler, not assigned to `ctx.correlationId`.

## Plan Deviations
- Created `services/telegram-bridge/vitest.config.ts` which was not in the plan. This was necessary because the service had no vitest config, causing all workspace package imports to fail during test resolution. Without this, no tests (including pre-existing ones) could run.

## Residual Risks
- **Pre-existing test failures**: `app.test.ts` and `observability.test.ts` in telegram-bridge fail due to missing transitive `@opentelemetry/*` aliases. These failures existed before this change (the service had no vitest.config.ts). They do not affect the /start handler functionality.
- **Smoke test not yet executed**: The new reissue/supersede smoke test has been written but requires a running Docker Compose stack to verify. Per project rules, it should be run before marking the roadmap item complete.
