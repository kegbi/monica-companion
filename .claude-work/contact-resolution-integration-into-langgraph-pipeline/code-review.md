---
verdict: APPROVED
attempt: 1
biome_pass: true
tests_pass: true
test_summary: "335 passed, 61 skipped, 0 failed (1 pre-existing integration test suite fails due to missing local PostgreSQL -- not related to changes)"
critical_count: 0
high_count: 0
medium_count: 2
---

# Code Review: Contact Resolution Integration into LangGraph Pipeline

## Automated Checks
- **Biome**: PASS -- "ok (no errors)"
- **Tests**: 335 passed, 61 skipped, 0 failed across 31 test files (1 file skipped: LLM integration suite). 1 pre-existing integration test suite (`repository.integration.test.ts`) fails due to missing local PostgreSQL -- unrelated to these changes.

## Findings

### CRITICAL
(none)

### HIGH
(none)

### MEDIUM

1. [MEDIUM] `services/ai-router/src/graph/nodes/resolve-contact-ref.ts:173` -- Non-null assertion `resolution.resolved!.contactId` is used when `resolveFromCandidates` can produce `resolved: null` (line 87: `resolvedSummary ?? null`). If a candidate's `contactId` is not found in the summaries array (extremely unlikely in practice since candidates derive from summaries), the assertion would cause a runtime TypeError. -- **Fix:** Replace with `resolution.resolved?.contactId` and add a fallback/guard, e.g.: `if (!resolution.resolved) { /* treat as no_match or log warning */ }`.

2. [MEDIUM] `services/ai-router/src/graph/state.ts:91` -- `contactSummariesCache` uses `z.array(z.any())` instead of a typed Zod schema. The `ContactResolutionSummary` Zod schema exists in `@monica-companion/types` and is already imported (as a TypeScript type). The `contactResolution` field correctly uses the Zod schema for validation, but the cache field does not. This weakens the project's "strict payload validation" rule. -- **Fix:** Change `z.array(z.any())` to `z.array(ContactResolutionSummary)` (import the Zod schema value, not just the type).

### LOW

1. [LOW] `services/ai-router/src/graph/nodes/resolve-contact-ref.ts:151` -- The `console.warn` call logs `correlationId` only, which is correct per security rules. However, other nodes use a structured logger (`createLogger`) from `@monica-companion/observability`. Using `console.warn` directly is inconsistent with the existing pattern in `contact-resolution/routes.ts` which uses the structured logger. -- **Fix:** Replace with `createLogger("resolve-contact-ref").warn(...)` for consistency with the existing codebase logging pattern.

2. [LOW] `services/ai-router/src/app.ts:59-64` -- Plan Step 5 called for sharing the `monicaIntegrationServiceClient` with `contactResolutionRoutes` to avoid creating a duplicate ServiceClient instance. The implementation documents this as a deliberate deviation (out of scope). This is acceptable for this task but results in two identical ServiceClient instances at runtime. -- **Fix:** Defer to a separate cleanup task as documented.

3. [LOW] `services/ai-router/src/graph/nodes/resolve-contact-ref.ts:128` -- The skip condition does not handle the `clarification_response` intent explicitly in a way that's visible from the code comments. While it is handled at line 128, the logic skips only when there is no `contactRef`. A `clarification_response` with a non-null `contactRef` (unlikely but possible from LLM) would trigger contact resolution. This is a minor edge case. -- **Fix:** No immediate action needed; the existing behavior is safe since resolution for a valid `contactRef` would simply validate against real data.

## Plan Compliance

The implementation closely follows the approved plan with two documented deviations:

1. **ServiceClient sharing (Step 5)**: The plan specified sharing the `monicaIntegrationServiceClient` with `contactResolutionRoutes`. This was not done and is documented in the implementation summary as intentionally deferred. Acceptable.

2. **Graph test fixture adjustment**: The `defaultSummaries` in `graph.test.ts` use `displayName: "Jane"` to ensure deterministic matching. This is a reasonable test adaptation.

All three MEDIUM findings from the plan review (M1: OTel spans, M2: graceful degradation, M3: preserving LLM userFacingText) are correctly addressed:

- **M1**: OTel span `ai-router.graph.resolve_contact_ref` is created with `span.end()` in `finally` block. Outcome attribute recorded. 6 span-related tests added (3 in `resolve-contact-ref.test.ts`, 3 in `node-spans.test.ts`).
- **M2**: Fetch failure returns `{}` (no state changes) instead of mapping to `no_match`. Records `fetch_error` span attribute. Tested.
- **M3**: `no_match` outcome preserves the LLM's original `userFacingText`. Tested with a French language example.

## Service Boundary Compliance

- `resolve-contact-ref.ts` imports only from `@monica-companion/auth` (ServiceClient type), `@monica-companion/types` (ContactResolutionSummary, ContactMatchCandidate -- the Monica-agnostic projections), and internal ai-router modules.
- No Telegram types, no raw Monica API types.
- `ai-router` calls `monica-integration` only through the read-only summaries endpoint via `fetchContactSummaries`.

## Security Compliance

- No PII logged: only `correlationId` appears in the warning log. Contact names and relationship labels are not logged.
- Spread syntax used instead of mutation (line 163 comment: "Build updated intent classification (spread, no mutation)").
- ServiceClient uses signed JWT with correct issuer/audience.

## Verdict Rationale

All automated checks pass (Biome clean, all tests pass). No CRITICAL or HIGH findings. The two MEDIUM findings are both low-risk in practice: the non-null assertion is guarded by the fact that candidates derive from summaries (making null effectively impossible), and the `z.any()` cache typing is a validation weakness that does not affect runtime behavior since the data has already been validated upstream. The implementation correctly addresses all three plan review findings and follows the approved plan with justified, documented deviations.
