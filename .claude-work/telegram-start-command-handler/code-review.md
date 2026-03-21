---
verdict: APPROVED
attempt: 1
biome_pass: true
tests_pass: true
test_summary: "76 passed, 0 failed (2 pre-existing suite failures in app.test.ts and observability.test.ts due to missing @opentelemetry aliases, unrelated to this change)"
critical_count: 0
high_count: 0
medium_count: 2
---

# Code Review: Telegram /start Command Handler

## Automated Checks
- **Biome**: PASS -- 9 files checked, zero errors, zero warnings.
- **Tests**: PASS -- 76 tests passed across 18 test files. 2 pre-existing suite failures (`app.test.ts`, `observability.test.ts`) confirmed to fail identically on the `main` branch without these changes due to missing `@opentelemetry/resources` alias in vitest config. These are not regressions.

## Findings

### CRITICAL
(none)

### HIGH
(none)

### MEDIUM

1. [MEDIUM] `services/telegram-bridge/src/lib/user-management-client.ts:80` -- The `issueSetupToken` method returns `res.json()` without Zod runtime validation against the `IssueSetupTokenResponse` schema. The import is `import type` (compile-time only). Per `.claude/rules/reliability.md`: "Strict payload validation with Zod must be applied on all inbound and outbound service contracts." -- **Fix:** Import the Zod schema (not just the type) and parse the response: `return IssueSetupTokenResponse.parse(await res.json())`. Note: this gap also exists in `lookupByConnector` (line 48) and `disconnectUser` (line 63), which are pre-existing. For this review, only the new method is in scope.

2. [MEDIUM] `services/telegram-bridge/vitest.config.ts` -- This file was not in the approved plan. The implementation summary justifies it as necessary for test resolution (the service had no vitest.config at all), and this is confirmed to be accurate. The deviation is reasonable and documented, but it is a plan deviation that should be noted. The file correctly follows the pattern used by other services in the monorepo.

### LOW

1. [LOW] `services/telegram-bridge/src/bot/handlers/start-command.ts:42-43` -- The catch block does not log the error. While the handler correctly sends a fallback message to the user, the error is silently swallowed. Adding a `console.error` or OTel span event would aid debugging in production. -- **Fix:** Add minimal error logging inside the catch block, e.g., `console.error("Start command failed", { correlationId, error: err })`, taking care to redact any sensitive fields per the security rules.

2. [LOW] `services/telegram-bridge/src/lib/__tests__/user-management-client.test.ts:10-24` -- The test overrides `globalThis.fetch` and restores it immediately, relying on the assumption that `createServiceClient` captures fetch at creation time. This is fragile if the internal implementation changes. A comment documents this assumption, which mitigates the risk. No action needed, but worth noting.

3. [LOW] `services/telegram-bridge/src/bot/handlers/start-command.ts:40` -- The welcome message is a long template literal. If it needs to be localized or A/B tested in the future, extracting it to a constants/messages module would be beneficial. Not needed now.

## Plan Compliance

The implementation closely follows the approved plan. All 7 implementation steps were completed. All 5 plan review findings were addressed:

- **[MEDIUM] Reuse UserLookupFn**: Addressed. `UserLookupFn` is imported from `../middleware/user-resolver` instead of defining a duplicate type.
- **[MEDIUM] lookupUser failure test**: Addressed. Test case added at `start-command.test.ts:73-89`.
- **[LOW] Smoke test overlap**: Addressed. Only the incremental reissue/supersede test was added.
- **[LOW] JSDoc in setupBot**: Addressed. JSDoc updated with all 8 steps at `setup.ts:25-35`.
- **[LOW] correlationId scope**: Addressed. `correlationId` is a local variable, not assigned to `ctx.correlationId`.

One justified deviation: `vitest.config.ts` was created outside the plan scope, documented in the implementation summary with rationale (see MEDIUM #2 above).

## Verdict Rationale

APPROVED. The implementation is clean, focused, and well-tested. Biome passes with zero issues. All 76 tests pass; the 2 suite failures are confirmed pre-existing on main. Security requirements are met: credentials are never exchanged in chat, service-to-service auth uses signed JWTs, private-chat-only middleware runs first, and no Telegram types leak across service boundaries. The middleware ordering (start before userResolver) is correct and verified by test. The two MEDIUM findings are not blocking: the missing Zod validation on the response is a pre-existing pattern across the same client, and the vitest.config.ts deviation is justified and documented.
