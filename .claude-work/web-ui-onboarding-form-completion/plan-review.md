---
verdict: APPROVED
attempt: 1
critical_count: 0
high_count: 0
medium_count: 4
---

# Plan Review: Web-UI Onboarding Form Completion

## Summary

Well-structured plan that aligns with architecture boundaries and reuses existing shared packages. Four medium findings are all addressable during implementation without changing the overall design.

## Findings

### CRITICAL
(none)

### HIGH
(none)

### MEDIUM

1. [MEDIUM] `connectorRoutingId` derivation not specified — derive from consumed token's `telegramUserId`, `connectorType` defaults to `"telegram"`. Not a user-supplied field.

2. [MEDIUM] Transaction refactoring for `consumeToken` not designed — add optional `tx` parameter to `consumeToken` so it can join an outer transaction. Preserves existing API for non-onboarding callers.

3. [MEDIUM] Error page `reason` query param must use an allowlist — map through strict allowlist of predefined messages, never render raw `reason` string.

4. [MEDIUM] `ALLOW_PRIVATE_NETWORK_TARGETS` dual config — simpler approach: only do syntactic normalization + HTTPS check at onboarding, leave full policy enforcement to `monica-integration`. Avoids duplicating config.

### LOW

1. [LOW] `normalizeMonicaUrl` appends `/api` — form placeholder should say base URL, stored value will include `/api`.

2. [LOW] `ConsumeSetupTokenWithOnboardingRequest` name is verbose — consider shorter name.

3. [LOW] Smoke test needs token pre-seeded — issue token via internal API before running form submission check.

## Verdict Rationale

APPROVED. Zero critical or high findings. Medium findings are implementation details, not design flaws. Plan correctly reuses existing packages, respects service boundaries, follows TDD sequence, and covers the real network path in smoke tests.
