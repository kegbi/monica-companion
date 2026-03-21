# Implementation Summary: Contact Resolution Integration into LangGraph Pipeline

## Files Changed
| File | Action | Description |
|------|--------|-------------|
| `services/ai-router/src/graph/state.ts` | modified | Replaced `resolvedContact: Record<string, unknown> \| null` with `contactResolution: ContactResolutionResult \| null` and `contactSummariesCache: ContactResolutionSummary[] \| null` in both the Zod schema and LangGraph Annotation |
| `services/ai-router/src/graph/nodes/resolve-contact-ref.ts` | created | New graph node that resolves contact references against real Monica data. Handles resolved/ambiguous/no_match outcomes with OTel span instrumentation (M1). On fetch failure, returns {} for graceful degradation (M2). Preserves LLM's userFacingText on no_match (M3). |
| `services/ai-router/src/graph/graph.ts` | modified | Added `resolveContactRef` node between `classifyIntent` and `executeAction`. Added `monicaIntegrationClient: ServiceClient` to `ConversationGraphConfig`. Updated topology comment. |
| `services/ai-router/src/app.ts` | modified | Created `monicaIntegrationServiceClient` and passed it to `createConversationGraph` config |
| `services/ai-router/src/graph/nodes/__tests__/resolve-contact-ref.test.ts` | created | 15 unit tests covering all resolution outcomes, skip conditions, graceful degradation, OTel spans, caching, and label formatting |
| `services/ai-router/src/graph/nodes/__tests__/node-spans.test.ts` | modified | Added 3 span tests for the new `resolveContactRef` node, plus mock for `fetchContactSummaries` |
| `services/ai-router/src/graph/nodes/__tests__/execute-action.test.ts` | modified | Updated `makeState()` helper (resolvedContact -> contactResolution/contactSummariesCache). Added 2 tests verifying executeAction integration with contact resolution outcomes. |
| `services/ai-router/src/graph/nodes/__tests__/classify-intent.test.ts` | modified | Updated `makeState()` helper |
| `services/ai-router/src/graph/nodes/__tests__/deliver-response.test.ts` | modified | Updated `makeState()` helper |
| `services/ai-router/src/graph/nodes/__tests__/format-response.test.ts` | modified | Updated `makeState()` helper. Added 1 test for real-data-style disambiguation options. |
| `services/ai-router/src/graph/nodes/__tests__/load-context.test.ts` | modified | Updated `makeState()` helper |
| `services/ai-router/src/graph/nodes/__tests__/persist-turn.test.ts` | modified | Updated `makeState()` helper |
| `services/ai-router/src/graph/__tests__/graph.test.ts` | modified | Added mock for `fetchContactSummaries` with default contact summaries. Added `monicaIntegrationClient` to `makeConfig()`. Updated intentClassification test to account for contact resolution modifications. |
| `services/ai-router/src/graph/__tests__/state.test.ts` | modified | Added 4 tests for new `contactResolution` and `contactSummariesCache` fields, including verification that old `resolvedContact` field is gone |
| `services/ai-router/src/__smoke__/contact-resolution.smoke.test.ts` | created | Smoke tests verifying the real network path for contact resolution (POST /internal/process with contact ref, POST /internal/resolve-contact) |

## Tests Added
| Test File | What It Tests |
|-----------|---------------|
| `services/ai-router/src/graph/nodes/__tests__/resolve-contact-ref.test.ts` | All 15 tests: resolved outcome with contactId injection, ambiguous outcome with real disambiguation options, no_match preserving LLM text (M3), skip for create_contact/null contactRef/null classification/greeting/out_of_scope, graceful degradation on fetch failure (M2), cache reuse, read_query support, OTel span creation/attributes/end-on-error, disambiguation label formatting with and without relationship labels |
| `services/ai-router/src/graph/nodes/__tests__/node-spans.test.ts` | 3 new tests: span name, outcome attribute, span end on fetch failure |
| `services/ai-router/src/graph/nodes/__tests__/execute-action.test.ts` | 2 new tests: pending command with resolved contactId, command stays in draft when needsClarification set by contact resolution |
| `services/ai-router/src/graph/nodes/__tests__/format-response.test.ts` | 1 new test: disambiguation with real-data-style options (contactId as value, displayName + relationship as label) |
| `services/ai-router/src/graph/__tests__/state.test.ts` | 4 new tests: contactResolution field validation, contactResolution defaults to null, contactSummariesCache defaults to null, old resolvedContact field rejected |
| `services/ai-router/src/__smoke__/contact-resolution.smoke.test.ts` | 2 smoke tests: process endpoint with contact reference does not 500, resolve-contact endpoint returns valid shape |

## Verification Results
- **Biome**: `pnpm check:fix` passes with no errors (ok, no errors)
- **Tests**: 335 passed, 39 skipped (LLM integration tests requiring OpenAI key), 0 failed across 31 test files. The 1 skipped test file is the LLM integration suite.
- **TypeScript**: Pre-existing TS issues (99 OverwriteValue errors from LangGraph's Annotation.Update type, 7 @monica-companion/auth declaration errors). No new TS errors introduced.

## Plan Review Findings Addressed
| Finding | Resolution |
|---------|------------|
| M1: Missing OTel span instrumentation | Added `tracer.startActiveSpan("ai-router.graph.resolve_contact_ref", ...)` with `span.end()` in `finally` block. Records `ai-router.resolution_outcome` attribute (resolved/ambiguous/no_match/skipped/fetch_error). Added 3 span tests in `node-spans.test.ts` plus 3 span tests in `resolve-contact-ref.test.ts`. |
| M2: Fetch failure maps to no_match | Changed to return `{}` (no state changes) on `fetchContactSummaries` failure, preserving the LLM's original classification as graceful degradation. Logs warning with correlationId only (no PII). Records `fetch_error` as span attribute. |
| M3: no_match overrides LLM userFacingText | For `no_match`, the node sets `needsClarification: true` and `clarificationReason: "ambiguous_contact"` but preserves the LLM's original `userFacingText` instead of generating hardcoded English text. |

## Plan Deviations
1. **contactResolutionRoutes ServiceClient sharing (Step 5)**: The plan specified sharing the `monicaIntegrationServiceClient` with `contactResolutionRoutes` to avoid creating a second instance. This was not implemented because it would require changing the `contactResolutionRoutes` function signature and its tests, which is out of scope for this task. The routes continue to create their own ServiceClient inline. Both instances are functionally identical.
2. **Graph test fixture adjustment**: The `defaultSummaries` in `graph.test.ts` use `displayName: "Jane"` (not "Jane Doe") to ensure exact display name match (score 1.0) for the existing `mutatingResult` fixture that has `contactRef: "Jane"`. This ensures the resolution succeeds deterministically in integration tests.

## Residual Risks
1. **LLM-fabricated contactId values**: When contact resolution is skipped (e.g., no contactRef, greeting, or fetch failure), the LLM's fabricated contactId passes through unchecked. This is a pre-existing issue documented in the plan as a separate hardening task.
2. **Pre-existing TypeScript OverwriteValue errors**: LangGraph's `Annotation.Update` type creates union types with `OverwriteValue<>` that make property access checks fail at the TS level. All runtime tests pass. This is a pre-existing issue affecting all node tests.
3. **Smoke tests require live stack**: The new smoke test at `services/ai-router/src/__smoke__/contact-resolution.smoke.test.ts` requires ai-router, monica-integration, user-management, postgres, and redis running with OPENAI_API_KEY and JWT_SECRET set. It has not been executed against a live stack in this session.
