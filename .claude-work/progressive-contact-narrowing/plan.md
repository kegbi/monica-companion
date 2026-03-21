# Implementation Plan: Progressive Contact Narrowing (Revision 2)

## Review Findings Resolution

| Finding | Severity | Resolution |
|---------|----------|------------|
| HIGH-1: No mechanism to generate narrowing-specific clarification text | HIGH | Override `userFacingText` with deterministic template in `resolveContactRef` when narrowing triggers (Step 5a) |
| HIGH-2: Type safety violation piggybacking `_narrowingContext` on `MutatingCommandPayload` | HIGH | Add dedicated `narrowing_context` JSONB column to `pending_commands` table (Step 1); dedicated repository functions (Step 2) |
| MEDIUM-1: Narrowing abandonment only covers `mutating_command` | MEDIUM | Abandon narrowing when intent is anything other than `clarification_response` (Step 5c) |
| MEDIUM-2: Smoke test does not verify narrowing | MEDIUM | Verify migration applied and service starts; narrowing behavior verified in graph-level integration tests |
| MEDIUM-3: `ConversationStateSchema` not updated alongside `ConversationAnnotation` | MEDIUM | Add to both in Step 3 |

## Objective

When contact resolution produces more than 5 ambiguous candidates (now common after bidirectional kinship matching), the system must NOT render them all as inline keyboard buttons. Instead, it asks clarifying questions ("What's your mom's name?"), re-runs the matcher with the accumulated information, and repeats until the pool is small enough for buttons or the 3-round cap is reached.

## Scope

### In Scope

- Detecting when ambiguous candidates exceed the button threshold (5) and switching to clarification mode.
- Generating a deterministic narrowing clarification question by overriding `userFacingText` in `resolveContactRef`.
- Storing narrowing state in a dedicated `narrowing_context` JSONB column on `pending_commands`.
- Adding `narrowingContext` to both `ConversationAnnotation` and `ConversationStateSchema`.
- Loading narrowing context from the active pending command into graph state.
- Re-running `matchContacts()` with the clarification term against the narrowed candidate pool.
- Abandoning narrowing when intent is anything other than `clarification_response`.
- Pool-reaches-zero fallback.
- 3-round cap.
- Unit tests, graph-level integration tests.

### Out of Scope

- Confirm-then-resolve conversation flow restructuring (separate roadmap item).
- Promptfoo migration (separate roadmap item).
- Changes to `matchContacts()` scoring algorithm.
- Changes to `ContactResolutionSummary` type or monica-integration endpoints.
- Any changes to telegram-bridge, delivery, scheduler, or other services.

## Affected Services & Packages

| Package/Service | Changes |
|-----------------|---------|
| `services/ai-router` | `src/db/schema.ts` -- add `narrowingContext` JSONB column to `pendingCommands` |
| `services/ai-router` | `drizzle/0001_*.sql` -- migration adding column |
| `services/ai-router` | `src/pending-command/repository.ts` -- add `updateNarrowingContext` and `clearNarrowingContext` |
| `services/ai-router` | `src/graph/state.ts` -- add `NarrowingContextSchema` to both Annotation and Zod schema |
| `services/ai-router` | `src/graph/nodes/resolve-contact-ref.ts` -- progressive narrowing logic with deterministic text |
| `services/ai-router` | `src/graph/nodes/execute-action.ts` -- persist narrowing context to dedicated column |
| `services/ai-router` | `src/graph/nodes/load-context.ts` -- extract narrowing context from pending command row |
| `services/ai-router` | `src/graph/graph.ts` -- wire new deps |
| `services/ai-router` | `src/contact-resolution/resolver.ts` -- export constants |
| `services/ai-router` | `src/contact-resolution/index.ts` -- re-export constants |
| `services/ai-router` | Test files for all above |

No changes to `@monica-companion/types`, `telegram-bridge`, `delivery`, `scheduler`, `monica-integration`, `web-ui`, `user-management`.

## Background: Two-Pass Filtering

The current `matchContacts` scores compound queries by checking each word independently and taking MAX score. This means "mom Elena" gives 0.9 to all kinship matches regardless of name.

**Solution:** On each narrowing round:
1. Take current narrowing pool (contacts from initial broad match).
2. Run `matchContacts(newClarificationTerm, poolSummaries)` where `poolSummaries` is only contacts in the pool.
3. Contacts matching the clarification remain; others are eliminated.
4. Cleanly separates kinship matching (pool establishment) from name/detail matching (pool narrowing).

## Implementation Steps

### Step 1: Add `narrowing_context` column to pending_commands schema

**File:** `services/ai-router/src/db/schema.ts`

- Add `narrowingContext: jsonb("narrowing_context")` (nullable, no default) to `pendingCommands`.
- Run `pnpm drizzle-kit generate` to produce migration.
- Verify SQL: `ALTER TABLE "pending_commands" ADD COLUMN "narrowing_context" jsonb;`

**Why (HIGH-2 fix):** Dedicated column avoids violating the strict `MutatingCommandPayload` discriminated union. Payload stays clean for validated command data only.

### Step 2: Add repository functions for narrowing context

**File:** `services/ai-router/src/pending-command/repository.ts`

- `updateNarrowingContext(db, id, expectedVersion, narrowingContext)`: Updates column, bumps version/updatedAt. Version check + status='draft'.
- `clearNarrowingContext(db, id)`: Sets column to null. Idempotent.

**TDD:**
1. Failing test: stores JSONB and bumps version. RED → GREEN
2. Failing test: version mismatch returns null. RED → GREEN
3. Failing test: clear sets to null. RED → GREEN

### Step 3: Add NarrowingContext schema and graph state field

**File:** `services/ai-router/src/graph/state.ts`

```ts
export const NarrowingContextSchema = z.object({
  originalContactRef: z.string(),
  clarifications: z.array(z.string()),
  /** 0-indexed. Incremented after each clarification round. Narrowing continues while round < MAX_NARROWING_ROUNDS. */
  round: z.number().int().min(0),
  narrowingCandidateIds: z.array(z.number().int()),
});
export type NarrowingContext = z.infer<typeof NarrowingContextSchema>;
```

Add to `ConversationAnnotation`:
```ts
narrowingContext: Annotation<NarrowingContext | null>({
  reducer: (_prev, next) => next,
  default: () => null,
})
```

**(MEDIUM-3 fix)** Add to `ConversationStateSchema`:
```ts
narrowingContext: NarrowingContextSchema.nullable().default(null),
```

### Step 4: Export narrowing constants

**File:** `services/ai-router/src/contact-resolution/resolver.ts`

```ts
export const NARROWING_BUTTON_THRESHOLD = 5;
export const MAX_NARROWING_ROUNDS = 3;
```

Re-export from `index.ts`.

### Step 5: Implement progressive narrowing in resolveContactRef

**File:** `services/ai-router/src/graph/nodes/resolve-contact-ref.ts`

**5a: Initial narrowing detection (no existing narrowingContext)**

After `matchContacts` + `resolveFromCandidates`, if outcome is `"ambiguous"` AND `candidates.length > NARROWING_BUTTON_THRESHOLD`:
- Create narrowingContext with candidateIds, round 0.
- **(HIGH-1 fix)** Override userFacingText: `"I found ${candidates.length} contacts matching \"${contactRef}\". Can you tell me their name to help narrow it down?"`
- Set `needsClarification: true`, NO `disambiguationOptions`.

**5b: Subsequent narrowing (existing narrowingContext + clarification_response)**

Extract clarification text (explicit fallback chain):
1. `intentClassification.contactRef` if non-null/non-empty
2. `inboundEvent.text` for text_message
3. `inboundEvent.transcribedText` for voice_message
4. If none: abandon narrowing

Filter summaries to pool → run `matchContacts(clarificationText, poolSummaries)` → branch:
- **0 matches:** no-match fallback, clear narrowingContext
- **1 match:** resolved, inject contactId
- **2-5 matches:** present buttons
- **>5 AND round+1 < MAX_NARROWING_ROUNDS:** continue narrowing, update context
- **>5 AND round+1 >= MAX_NARROWING_ROUNDS:** cap, force top 5 as buttons

**5c: Abandonment (MEDIUM-1 fix)**

If narrowingContext present AND intent !== `clarification_response`: clear narrowingContext, process normally.

**TDD:** 11 test cases covering all branches.

### Step 6: Persist/load narrowing context in executeAction and loadContext

**loadContext:** Parse `activeCommand.narrowingContext` with `NarrowingContextSchema.safeParse()`. Valid → state. Invalid/absent → null.

**executeAction:**
- After `createPendingCommand`: if `state.narrowingContext` non-null, call `updateNarrowingContext`.
- After `updateDraftPayload`: if `state.narrowingContext` non-null, call `updateNarrowingContext`.
- Before `transitionToConfirmation`: call `clearNarrowingContext`.

**TDD:** 8 test cases (3 loadContext, 5 executeAction).

### Step 7: Wire new deps in graph.ts

Import and pass `updateNarrowingContext`, `clearNarrowingContext` to execute-action deps.

### Step 8: Compound narrowing tests for matcher

**File:** `services/ai-router/src/contact-resolution/__tests__/matcher.test.ts`

4 tests validating `matchContacts` with filtered pools (existing behavior, no code changes needed).

### Step 9: Graph-level integration tests

**File:** `services/ai-router/src/graph/__tests__/graph.test.ts`

- **9a:** Full narrowing initiation (8 candidates → text clarification).
- **9b:** Narrowing continuation to buttons (clarification narrows to 2).
- **9c:** Pool reaches 0 → no-match fallback.
- **9d:** 3-round cap → forced buttons.

## Smoke Test Strategy

**Services:** `ai-router`, `postgres`, `redis` via Docker Compose.

1. **Health check:** `curl http://localhost:3002/health` — 200 OK (proves migration applied).
2. **Regression:** Existing smoke test checks pass.
3. **(MEDIUM-2)** Verify column: `\d pending_commands | grep narrowing_context`.

Narrowing flow behavior verified in graph-level integration tests (mocked LLM + contacts).

## Security Considerations

- No new endpoints or ingress.
- `narrowing_context` column subject to same 30-day retention and redaction rules as `pending_commands`.
- Contains only contact IDs (integers) and contact reference strings -- same class as existing payload data.
- Deterministic templates don't leak internal state.
- Contact summaries fetched through existing authenticated client.

## Risks & Mitigations

1. **Deterministic template quality** — Less natural than LLM text, but predictable and correct. Future: inject context into LLM prompt.
2. **Short clarifications** — May keep many contacts; 3-round cap ensures termination.
3. **Migration risk** — Nullable JSONB column is non-breaking. No backfill needed.
4. **Language mismatch in templates** — English-only for V1. Acceptable given simple content.
5. **Concurrent narrowing** — Version check prevents stale writes.
