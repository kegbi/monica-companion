---
verdict: APPROVED
reviewed: connector-ready-contracts implementation
date: 2026-03-17
---

# Code Review: Connector-Ready Contracts

## Summary

This implementation systematically removes hardcoded Telegram-specific assumptions from all connector-neutral services (scheduler, delivery, ai-router, voice-transcription, monica-integration) and replaces them with configurable, data-driven patterns. The changes are well-structured, follow the approved plan closely, maintain backward compatibility, and include comprehensive tests and boundary enforcement. The code quality is high with clean separation of concerns.

## Automated Checks

### Biome
- **Result**: PASS (0 errors, 51 warnings)
- All 51 warnings are pre-existing (noExplicitAny, noNonNullAssertion, noUnusedImports in files NOT touched by this change). None of the warnings originate from files modified in this PR.

### Tests

| Package/Service | Test Files | Tests | Status | Notes |
|----------------|------------|-------|--------|-------|
| @monica-companion/types | 9 passed | 144 passed | PASS | All tests pass including new connector-neutral tests |
| scheduler (changed tests) | 7 passed | 50 passed | PASS | command-worker, dead-letter, reminder-executor, connector-neutrality all pass |
| scheduler (pre-existing failures) | 4 failed | 0 from these | PRE-EXISTING | queue-metrics, reminder-poller, execute, config fail due to module resolution (confirmed on clean main) |
| delivery (config + boundary) | 2 passed | 11 passed | PASS | Config and connector-neutrality tests pass |
| delivery (app) | 1 failed | 0 | PRE-EXISTING | @opentelemetry/resources module resolution failure (confirmed on clean main) |
| ai-router (config) | 6 passed | 69 passed | PASS | Config tests with new inboundAllowedCallers pass |
| ai-router (pre-existing failures) | 5 failed | 4 failed | PRE-EXISTING | Module resolution + 1 pre-existing assertion mismatch (502 vs 500) |
| voice-transcription (boundary) | 1 passed | 2 passed | PASS | Connector-neutrality boundary test passes |
| voice-transcription (pre-existing) | 5 failed | 0 | PRE-EXISTING | Module resolution failures |
| user-management | 2 passed | 28 passed | PASS | Switch refactor works correctly |
| user-management (pre-existing) | 4 failed | 0 | PRE-EXISTING | drizzle-orm module resolution |
| monica-integration (boundary) | 1 passed | 2 passed | PASS | New connector-neutrality boundary test passes |

All test failures are pre-existing Windows/Node 24 pnpm symlink resolution issues, confirmed by running the same test suites on the unmodified main branch.

## Findings

### CRITICAL
(none)

### HIGH
(none)

### MEDIUM

1. [MEDIUM] services/scheduler/src/workers/command-worker.ts:44 -- The resolveConnectorRouting function makes an HTTP call to user-management without an explicit timeout (no AbortSignal.timeout). While this is consistent with the pre-existing pattern for monicaClient.fetch calls in the same file, the reliability rules require explicit timeout handling on external calls. -- **Fix:** Add signal: AbortSignal.timeout(10_000) to the user-management fetch call. Note: this is a pre-existing pattern issue, not introduced by this PR, but the new code extends it.

2. [MEDIUM] services/scheduler/src/index.ts:81 -- The resolveConnectorRoutingForDeadLetter function similarly lacks an explicit timeout on its user-management fetch call. -- **Fix:** Same as above, add an AbortSignal.timeout to the fetch call.

3. [MEDIUM] context/spec/connector-extension-guide.md:65-76 -- The switch statement example in the documentation is missing break or return statements, which would cause fall-through from the telegram case to the whatsapp case and then to default. This could mislead a future connector author. -- **Fix:** Add return statements to each case (matching the actual implementation in user-management/src/app.ts which correctly uses return c.json(...) inside each case block).

### LOW

1. [LOW] services/ai-router/src/config.ts:31-37 and services/voice-transcription/src/config.ts:36-42 -- The parseAllowedCallers helper function is duplicated verbatim in both services. -- **Fix:** This is explicitly documented as a deferred item in the implementation summary (F5). A future cleanup could extract it to a shared utility. Acceptable for now as it is only 5 lines.

2. [LOW] services/scheduler/src/workers/command-worker.ts:53-56 -- The user-management response is cast with a type assertion without Zod validation. Per the reliability rules, strict Zod validation should be applied on inbound contracts. However, this is an internal service-to-service call where the response shape is controlled, and the pattern is consistent with existing code. -- **Fix:** Consider adding a small Zod schema for the schedule response fields in a future hardening pass.

3. [LOW] services/delivery/src/config.ts:55 -- The connectorAudience convention (connectorType + "-bridge") is a useful default but could break if a future connector uses a different naming scheme. This is documented in the extension guide and the implementation summary (residual risk 3). -- **Fix:** Already documented. Could be made configurable in a future iteration if needed.

## Unintended Removals Check

- **.env.example**: Changes are purely additive. All pre-existing env vars and comments are preserved. PASS.
- **docker-compose.yml**: Not modified. PASS.
- **pnpm-workspace.yaml**: Not modified. PASS.
- **packages/types/src/index.ts**: Not modified. No barrel exports removed. PASS.
- **packages/types/src/commands.ts**: Only additive changes (2 new optional fields). No existing fields removed. PASS.
- **packages/types/src/outbound-message.ts**: Changed connectorType from z.enum(["telegram"]) to z.string().min(1). Core change authorized by plan (L1 fix). PASS.
- **packages/types/src/__tests__/commands.test.ts**: Removed 3 unused type imports (cleanup, not functional). PASS.

## Plan Compliance

The implementation follows the approved plan closely across all 9 steps:

1. **Step 1 (Widen OutboundMessageIntentSchema)**: Completed as planned.
2. **Step 2 (Fix scheduler hardcoded literals)**: All L2, L3, L4, L12 findings addressed.
3. **Step 3 (Extend ConfirmedCommandPayload)**: Optional connectorType and connectorRoutingId fields added with proper Zod validation.
4. **Step 4 (Refactor delivery connector resolution)**: Implemented with justified deviation: prefix-based env vars instead of JSON.
5. **Step 5 (Make allowedCallers configurable)**: Completed in both ai-router and voice-transcription.
6. **Step 6 (Fix user-management connector lookup)**: if/else replaced with switch/case as planned.
7. **Step 7 (Boundary enforcement tests)**: 4 new connector-neutrality tests created. The ai-router omission is justified.
8. **Step 8 (Documentation)**: context/spec/connector-extension-guide.md created.
9. **Step 9 (Test fixtures)**: All affected test files updated.

**Justified deviations**: Prefix-based env vars vs JSON for delivery registry (F4), duplicated parseAllowedCallers helper (F5), no ai-router connector-neutrality test (F7). All are well-reasoned and documented.

## Verdict Rationale

The implementation satisfies all approval criteria:

- **Biome check passes** with zero errors (all 51 warnings are pre-existing in untouched files)
- **All tests attributable to this change pass** (144 types, 50 scheduler, 11 delivery, 69 ai-router, 2 voice-transcription, 28 user-management, 2 monica-integration)
- **All test failures are pre-existing** environment-level module resolution issues confirmed on the unmodified main branch
- **Zero CRITICAL findings**
- **Zero HIGH findings**
- **3 MEDIUM findings**: Two are extensions of a pre-existing timeout pattern (not introduced by this PR), and one is a documentation example issue. None represent functional or security regressions.
- **Service boundaries are strengthened**, not weakened
- **Security posture is maintained**: Default allowedCallers remain restrictive, connector URLs are internal-only, no new public endpoints
- **Backward compatibility is preserved**: TELEGRAM_BRIDGE_URL fallback, optional connectorType/connectorRoutingId fields
- **Definition of Done criteria are met**: Plan alignment, security preserved, TDD sequence, tests pass, delivery summary with residual risks

**APPROVED**
