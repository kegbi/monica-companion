---
verdict: APPROVED
attempt: 2
critical_count: 0
high_count: 0
medium_count: 3
---

# Plan Review: Contact Resolution Boundary

## Findings

### CRITICAL
(none)

### HIGH
(none)

### MEDIUM

1. [MEDIUM] **UserId source mismatch between request body and JWT subject.** The `ContactResolutionRequest` schema includes a `userId` field in the request body, but the established pattern across the codebase is to extract the userId from the JWT `sub` claim via `requireUserId(c)`, not from the request body. — **Fix:** The route handler should extract `userId` from the JWT subject via `requireUserId(c)`. Either remove `userId` from `ContactResolutionRequest` or explicitly validate that `body.userId === jwtSubject` and reject with 403 on mismatch.

2. [MEDIUM] **No explicit timeout on the HTTP client call to monica-integration.** The plan's Step 3 client design does not specify a timeout value for the `fetchContactSummaries()` call. Per `.claude/rules/reliability.md`: "All external API calls must have explicit timeout handling." — **Fix:** Specify an explicit timeout (e.g., `AbortSignal.timeout(30_000)`) in the `fetchContactSummaries()` implementation.

3. [MEDIUM] **Redaction usage not shown in client/resolver code paths.** The plan's Security Considerations section correctly states that `contactRef` must be redacted but the implementation steps don't mention importing or using the redaction package. — **Fix:** Use the shared logger from `@monica-companion/observability` and register `contactRef` and `displayName` as redactable fields.

### LOW

1. [LOW] **DisplayName matching rule has minor ambiguity.** Rephrase to clarify both checks (full displayName and stripped parenthetical) are performed.
2. [LOW] **Missing `depends_on` for monica-integration in docker-compose ai-router definition.**
3. [LOW] **Prefix match minimum length not validated in test cases.** Add test case for single-char query.
4. [LOW] **`ContactResolutionRequest.correlationId` lacks `.min(1)` constraint.**

## Verdict Rationale

The plan is **APPROVED**. It covers all three roadmap sub-items. The three MEDIUM findings are advisory improvements to address during implementation. Architecture boundaries are respected, security concerns are addressed, and TDD sequence is explicit.
