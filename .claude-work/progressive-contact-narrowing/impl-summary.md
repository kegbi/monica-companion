# Implementation Summary: Progressive Contact Narrowing

## Files Changed
| File | Action | Description |
|------|--------|-------------|
| `services/ai-router/src/db/schema.ts` | modified | Added `narrowingContext` JSONB nullable column to `pendingCommands` table |
| `services/ai-router/drizzle/0001_add_narrowing_context.sql` | created | Migration to add `narrowing_context` column |
| `services/ai-router/drizzle/meta/_journal.json` | modified | Registered new migration entry |
| `services/ai-router/src/pending-command/repository.ts` | modified | Added `updateNarrowingContext()` and `clearNarrowingContext()` functions |
| `services/ai-router/src/graph/state.ts` | modified | Added `NarrowingContextSchema`, `NarrowingContext` type, field to both `ConversationAnnotation` and `ConversationStateSchema` |
| `services/ai-router/src/contact-resolution/resolver.ts` | modified | Exported `NARROWING_BUTTON_THRESHOLD` (5) and `MAX_NARROWING_ROUNDS` (3) constants |
| `services/ai-router/src/contact-resolution/index.ts` | modified | Re-exported new constants |
| `services/ai-router/src/graph/nodes/resolve-contact-ref.ts` | modified | Full progressive narrowing implementation: initial detection (5a), subsequent rounds (5b), abandonment (5c), deterministic template text, round cap logic |
| `services/ai-router/src/graph/nodes/execute-action.ts` | modified | Added `updateNarrowingContext`/`clearNarrowingContext` to deps; narrowing persistence after create/update; clearing before confirmation transition; MEDIUM-1 fix for independent persistence |
| `services/ai-router/src/graph/nodes/load-context.ts` | modified | Extracts `narrowingContext` from active pending command row via `NarrowingContextSchema.safeParse()` |
| `services/ai-router/src/graph/graph.ts` | modified | Wired `updateNarrowingContext` and `clearNarrowingContext` in config and executeAction deps |
| `services/ai-router/src/app.ts` | modified | Imported and wired `updateNarrowingContext`/`clearNarrowingContext` from repository into graph config |
| `services/ai-router/src/db/__tests__/schema.test.ts` | modified | Added test verifying `narrowingContext` column exists and is nullable JSONB |
| `services/ai-router/src/pending-command/__tests__/narrowing-context.test.ts` | created | Unit tests for `updateNarrowingContext` and `clearNarrowingContext` |
| `services/ai-router/src/graph/__tests__/state.test.ts` | modified | Tests for `NarrowingContextSchema` validation and `ConversationStateSchema` narrowingContext field |
| `services/ai-router/src/graph/nodes/__tests__/resolve-contact-ref.test.ts` | modified | 8 new tests: initial narrowing trigger, subsequent round, single match, zero matches, continued narrowing, round cap, abandonment, null contactRef fallback |
| `services/ai-router/src/graph/nodes/__tests__/execute-action.test.ts` | modified | 4 new tests: persist after create, persist after update, clear before confirmation, MEDIUM-1 independent persistence |
| `services/ai-router/src/graph/nodes/__tests__/load-context.test.ts` | modified | 3 new tests: load valid narrowingContext, null when absent, null when no active command |
| `services/ai-router/src/contact-resolution/__tests__/matcher.test.ts` | modified | 4 new compound narrowing tests verifying pool filtering behavior |
| `services/ai-router/src/graph/__tests__/graph.test.ts` | modified | 4 new integration tests: 9a (initiation), 9b (continuation to buttons), 9c (pool zero fallback), 9d (round cap forced buttons) |

## Tests Added
| Test File | What It Tests |
|-----------|---------------|
| `src/db/__tests__/schema.test.ts` | `narrowingContext` column exists as nullable JSONB on `pendingCommands` |
| `src/pending-command/__tests__/narrowing-context.test.ts` | `updateNarrowingContext` stores JSONB and bumps version; version mismatch returns null; `clearNarrowingContext` sets to null |
| `src/graph/__tests__/state.test.ts` | `NarrowingContextSchema` accepts valid/empty/rejects negative; `ConversationStateSchema` defaults narrowingContext to null and accepts valid |
| `src/graph/nodes/__tests__/resolve-contact-ref.test.ts` | 8 narrowing scenarios: initial trigger (>5), no trigger (<=5), pool narrowing, single match, zero matches, continued narrowing, round cap, abandonment, null contactRef |
| `src/graph/nodes/__tests__/execute-action.test.ts` | 4 persistence scenarios: after create, after updateDraftPayload, clear before confirmation, MEDIUM-1 independent persistence when no commandPayload |
| `src/graph/nodes/__tests__/load-context.test.ts` | 3 loading scenarios: valid narrowingContext, null when absent, null when no active command |
| `src/contact-resolution/__tests__/matcher.test.ts` | 4 compound narrowing tests validating matchContacts with filtered pools |
| `src/graph/__tests__/graph.test.ts` | 4 graph-level integration tests: initiation, continuation to buttons, pool zero fallback, round cap forced buttons |

## Verification Results
- **Biome**: `pnpm --filter ai-router exec biome check --write ./src` -- 0 errors, 100 warnings (all pre-existing `any` usage in test files), 10 files auto-formatted
- **Tests**: 272 tests passed across 17 test files (all files that can run on this environment; 3 files have pre-existing OTel dependency issue from broken symlinks unrelated to this change)

## Review Findings Addressed
| Finding | How Addressed |
|---------|--------------|
| HIGH-1: No mechanism to generate narrowing text | `resolveContactRef` overrides `userFacingText` with deterministic template: `"I found N contacts matching \"X\". Can you tell me their name to help narrow it down?"` |
| HIGH-2: Type safety violation on payload | Dedicated `narrowing_context` JSONB column on `pending_commands` with `updateNarrowingContext`/`clearNarrowingContext` repository functions |
| MEDIUM-1 (review 1): Abandonment only covers mutating_command | Narrowing abandoned when intent is anything other than `clarification_response` |
| MEDIUM-2 (review 1): Smoke test doesn't verify narrowing | Migration + column verified; behavior verified in graph-level integration tests |
| MEDIUM-3 (review 1): ConversationStateSchema not updated | Added to both `ConversationAnnotation` and `ConversationStateSchema` |
| MEDIUM-1 (re-review): Narrowing context persistence ordering | Dedicated narrowing persistence path in `handleClarificationResponse` runs BEFORE existing handler logic, persisting narrowingContext independently when LLM produces no commandType/commandPayload |
| MEDIUM-2 (re-review): Narrowing check ordering in resolveContactRef | Narrowing context check is the FIRST branch in the node function, before existing skip guards |
| LOW-1 (re-review): NARROWING_BUTTON_THRESHOLD vs MAX_DISAMBIGUATION_CANDIDATES | Explicit `candidates.slice(0, MAX_DISAMBIGUATION_CANDIDATES)` used in cap branch |

## Plan Deviations
1. **Migration generated manually** instead of via `drizzle-kit generate` -- the tool was broken due to symlink issues on the current environment. The SQL is a simple `ALTER TABLE ADD COLUMN` and the journal was updated accordingly.
2. **Added `@monica-companion/observability` mock** to test files that previously failed due to pre-existing broken `@opentelemetry/exporter-logs-otlp-http` symlinks. This is an environment-specific issue, not a code issue.
3. **Narrowing context persistence in handleClarificationResponse** uses a split approach: the MEDIUM-1 fix persists independently on the passthrough path (when commandType/commandPayload are null); the normal path persists after `updateDraftPayload` with the new version. This avoids version conflicts between the two operations.

## Residual Risks
1. **Pre-existing OTel dependency issue**: `@opentelemetry/exporter-logs-otlp-http` has a broken symlink in the local environment. This affects 3 test files unrelated to this change (node-spans, persist-turn, deliver-response). Fix by running `pnpm install` on a clean environment.
2. **English-only templates**: Narrowing question text is hardcoded English. Acceptable for V1 per plan risk analysis.
3. **Migration not auto-generated**: The manual migration should be verified in CI/CD pipeline to match the drizzle schema.
4. **Version conflict edge case**: If `updateNarrowingContext` and `updateDraftPayload` race against each other on the same row, one will fail due to version check. The current implementation handles this by running them sequentially.
