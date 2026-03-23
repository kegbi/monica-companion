# Implementation Summary: Stage 3 -- Contact Resolution via Tools

## Files Changed
| File | Action | Description |
|------|--------|-------------|
| `services/ai-router/src/agent/tools.ts` | modified | Added `SearchContactsArgsSchema` (Zod schema for search_contacts args), added it to `TOOL_ARG_SCHEMAS` map, updated search_contacts tool description to mention relationship terms, return shape |
| `services/ai-router/src/agent/tool-handlers/search-contacts.ts` | created | `handleSearchContacts` function: fetches contact summaries, runs matcher, joins results back to summaries for aliases/relationshipLabels/birthdate, caps at 10, returns structured errors |
| `services/ai-router/src/agent/loop.ts` | modified | Added `monicaServiceClient: ServiceClient` to `AgentLoopDeps`, wired `search_contacts` tool handler with Zod validation, other read-only tools still get stub |
| `services/ai-router/src/agent/system-prompt.ts` | modified | Added dedicated "Contact Resolution Rules" section, consolidated scattered contact resolution instructions (MEDIUM finding), removed duplicate guideline #2 |
| `services/ai-router/src/app.ts` | modified | Created `monicaIntegrationServiceClient`, passed it to `agentDeps` as `monicaServiceClient` |
| `services/ai-router/src/agent/__tests__/tools.test.ts` | modified | Updated "has no entries for read-only tools" test to exclude search_contacts (MEDIUM finding), added tests for SearchContactsArgsSchema validation |
| `services/ai-router/src/agent/tool-handlers/__tests__/search-contacts.test.ts` | created | Unit tests for handleSearchContacts: match results, no matches, service error, cap at 10, birthdate extraction, parameter passing |
| `services/ai-router/src/agent/__tests__/loop.test.ts` | modified | Added `monicaServiceClient` to mock deps, added tests for search_contacts handler invocation, validation error handling, and stub behavior for other read-only tools |
| `services/ai-router/src/agent/__tests__/system-prompt.test.ts` | modified | Added tests for Contact Resolution Rules section, contactId instructions, disambiguation, zero results, never-guess rule |
| `services/ai-router/src/agent/__tests__/search-contacts-integration.test.ts` | created | Multi-turn integration tests: unambiguous (1 result -> proceed), ambiguous (3 results -> clarification), no match (0 results -> clarify), kinship term ("mom" -> relationship match), service error -> graceful message |

## Tests Added
| Test File | What It Tests |
|-----------|---------------|
| `services/ai-router/src/agent/tool-handlers/__tests__/search-contacts.test.ts` | Handler correctness: match enrichment (aliases, labels, birthdate, matchReason), empty results, service errors, 10-result cap, birthdate extraction from importantDates, parameter forwarding |
| `services/ai-router/src/agent/__tests__/tools.test.ts` (modified) | SearchContactsArgsSchema validation: valid args, empty query rejection, missing query rejection; updated read-only schema exclusion test |
| `services/ai-router/src/agent/__tests__/loop.test.ts` (modified) | Agent loop wiring: search_contacts invokes handler with correct params, validation errors return error tool results, other read-only tools still get stub |
| `services/ai-router/src/agent/__tests__/system-prompt.test.ts` (modified) | System prompt includes Contact Resolution Rules section, contactId resolution instructions, never-guess rule, disambiguation instructions, zero-result handling |
| `services/ai-router/src/agent/__tests__/search-contacts-integration.test.ts` | Multi-turn flows with scripted mock LLM: unambiguous resolution, ambiguous disambiguation, no-match clarification, kinship term matching, service error graceful handling |

## Verification Results
- **Biome**: `biome check` passes with 0 errors on all new/modified files. Pre-existing warnings (3 unused correlationId params in loop.ts, 3 unused client variables in app.ts) are unrelated to this change.
- **Tests**: 42 test files passed, 1 skipped (pre-existing). 545 tests passed, 13 skipped. The 1 skipped file is `repository.integration.test.ts` which requires a live PostgreSQL database and was already failing before this change.

## Plan Deviations

1. **matchReason included in tool results**: The plan did not explicitly mention `matchReason` in the handler return shape, but the plan review LOW-4 finding suggested including it. It was added to help the LLM explain why contacts matched and aid disambiguation.

2. **No files removed in this stage**: The plan mentioned removing `graph/nodes/resolve-contact-ref.ts` and its test file (~2,200 lines), but the "What Gets Removed" section also notes this might be deferred. Since the plan steps 1-7 do not include a removal step, and the plan explicitly says "NOT removed yet (deferred to Stage 6)" for the graph pipeline, no files were deleted. The old graph pipeline remains as dead code until Stage 6.

## Residual Risks

1. **LLM compliance**: The LLM may not always call `search_contacts` first before using a contactId. This is mitigated by system prompt instructions and will be evaluated in Stage 5 (promptfoo evals).

2. **Per-invocation contact cache**: Each `search_contacts` call fetches the full contact list from monica-integration. If the LLM calls `search_contacts` multiple times in one conversation turn, this results in redundant fetches. A per-invocation cache is deferred as an optimization (tracked as LOW-2 in plan review).

3. **Pre-existing DB integration test failure**: `pending-command/repository.integration.test.ts` fails when no PostgreSQL is available. This is not related to this change.
