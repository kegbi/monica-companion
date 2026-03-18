---
verdict: APPROVED
findings_critical: 0
findings_high: 0
findings_medium: 3
findings_low: 2
---

# Plan Review: Safe Multi-Instance Support

## Findings

### CRITICAL
(none)

### HIGH
(none)

### MEDIUM

1. [MEDIUM] **Redirect-following bypass is documented but not mitigated.** The acceptance criteria state "Monica redirects to blocked networks are rejected." A simple mitigation: set `redirect: "manual"` on outbound fetch calls, validate `Location` header targets against `isBlockedIp`, and follow manually. Or set `redirect: "error"` and document that redirect-issuing Monica instances are unsupported in V1.

   **Fix:** Add a sub-step to Step 5 that sets `redirect: "manual"` and validates redirect targets.

2. [MEDIUM] **`handleMonicaError` is duplicated across three route files; plan modifies all three without consolidation.** Step 8 would add the same `MonicaUrlValidationError` branch to all three copies, deepening the DRY violation.

   **Fix:** Before Step 8, extract `handleMonicaError` into `routes/shared.ts` as a single shared function.

3. [MEDIUM] **Config validation schema not fully specified for `ALLOW_PRIVATE_NETWORK_TARGETS`.**

   **Fix:** Use `z.enum(["true", "false"]).default("false").transform(v => v === "true")` to reject invalid values and produce a boolean.

### LOW

1. [LOW] **Missing test cases for IP literal hostnames in normalization.** Add tests for `"https://192.0.2.1:443/api"` and `"https://[2001:db8::1]/api"`.

2. [LOW] **Smoke test #3 is fragile.** Assert the response is NOT 422, not that it succeeds, to distinguish URL validation pass from downstream errors.

## Verdict Rationale

The plan is well-structured, covers all three roadmap sub-items, respects architecture boundaries, and provides comprehensive SSRF protection. All findings are advisory improvements. APPROVED for implementation.
