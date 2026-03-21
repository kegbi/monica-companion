# Implementation Plan: Bidirectional Kinship Matching

## Objective

Fix the kinship matching logic so that asymmetric relationship terms (e.g., "mom", "dad", "uncle", "boss") match contacts in **both** directions of the Monica relationship model. Currently, "mom" maps to the Monica label "parent", which only matches contacts that have a "parent" relationship entry. But in Monica's data model, `relationshipLabels: ["parent"]` on contact A means A has someone listed as their parent -- it does NOT mean A is a parent. The user's mom is a contact who IS a parent, which is expressed as having a "child" entry. Both the direct label ("parent") and its inverse ("child") are valid signals for the kinship term "mom". This change makes kinship matching bidirectional while keeping the score equal for both directions (0.9), relying on the downstream disambiguation flow to narrow results when multiple candidates match.

## Scope

### In Scope

- Restructure `KINSHIP_MAP` in `matcher.ts` to carry both direct and inverse Monica labels for asymmetric relationship types.
- Update `scoreRelationship()` to check the candidate's `relationshipLabels` against all mapped labels (direct + inverse).
- Keep the same score (0.9) for both directions -- neither direction is conclusive alone.
- Symmetric relationship types (spouse, sibling, friend, colleague, cousin, bestfriend, partner, date, lover, ex-*) remain unchanged (same label in both directions).
- Add unit tests with realistic bidirectional relationship topologies.
- Update benchmark fixtures to cover bidirectional kinship scenarios.

### Out of Scope

- Progressive contact narrowing (separate roadmap item).
- Confirm-then-resolve conversation flow restructuring (separate roadmap item).
- Promptfoo migration (separate roadmap item).
- Graph-level integration tests for multi-turn contact flow (separate roadmap item).
- Changes to `ContactResolutionSummary` type or `buildContactResolutionSummary()` in `monica-integration` -- the projection already carries `relationshipLabels` correctly; the problem is entirely in the matcher's interpretation.
- Changes to `resolver.ts` thresholds -- the scoring and resolution thresholds stay at current values.

## Affected Services & Packages

| Package/Service | Changes |
|-----------------|---------|
| `services/ai-router` | `src/contact-resolution/matcher.ts` -- restructure `KINSHIP_MAP`, update `scoreRelationship()` |
| `services/ai-router` | `src/contact-resolution/__tests__/matcher.test.ts` -- new bidirectional test cases |
| `services/ai-router` | `src/benchmark/fixtures/contact-resolution.ts` -- new benchmark cases |

No changes to `@monica-companion/types`, `monica-integration`, `resolver.ts`, or any other service.

## Background: Monica's Relationship Semantics

Understanding how Monica stores relationships is critical to this change.

When a `RelationshipShort` entry appears on contact A's full contact response:
```json
{ "relationship": { "name": "parent" }, "contact": B }
```
This means: **B is A's parent** (the relationship name describes what B is TO A).

The `buildRelationshipLabels()` function in `monica-integration` extracts `entry.relationship.name` for each entry. So `relationshipLabels: ["parent"]` on contact A means "A has a parent" -- NOT "A is a parent."

Monica's default asymmetric relationship type pairs (from `monica-api-scope.md`):

| name | name_reverse_relationship |
|------|--------------------------|
| child | parent |
| parent | child |
| grandparent | grandchild |
| grandchild | grandparent |
| uncle | nephew |
| nephew | uncle |
| godparent | godchild |
| godchild | godparent |
| stepparent | stepchild |
| stepchild | stepparent |
| boss | subordinate |
| subordinate | boss |
| mentor | protege |
| protege | mentor |

When the user says "mom", the system should match:
1. Contacts with `relationshipLabels` containing "parent" (contacts that have a parent -- the parent might be the user or another contact)
2. Contacts with `relationshipLabels` containing "child" (contacts that have children -- meaning they ARE parents)

Both are uncertain signals; the disambiguation flow narrows to the correct contact.

## Implementation Steps

### Step 1: Change KINSHIP_MAP type from `Map<string, string>` to `Map<string, string[]>`

**File:** `services/ai-router/src/contact-resolution/matcher.ts`

**What to do:**
- Change the type of `KINSHIP_MAP` from `Map<string, string>` to `Map<string, string[]>`.
- For **symmetric** relationship types, the array contains a single element (the label is the same in both directions):
  - `"wife"` -> `["spouse"]`
  - `"brother"` -> `["sibling"]`
  - `"friend"` -> `["friend"]`
  - `"colleague"` -> `["colleague"]`
  - `"cousin"` -> `["cousin"]`
  - `"partner"` -> `["partner"]`
  - `"best friend"` -> `["bestfriend"]`
- For **asymmetric** relationship types, the array contains both the direct label and the inverse:
  - `"mom"` -> `["parent", "child"]`
  - `"mother"` -> `["parent", "child"]`
  - `"mama"` -> `["parent", "child"]`
  - `"mum"` -> `["parent", "child"]`
  - `"dad"` -> `["parent", "child"]`
  - `"father"` -> `["parent", "child"]`
  - `"papa"` -> `["parent", "child"]`
  - `"son"` -> `["child", "parent"]`
  - `"daughter"` -> `["child", "parent"]`
  - `"grandma"` -> `["grandparent", "grandchild"]`
  - `"grandmother"` -> `["grandparent", "grandchild"]`
  - `"nana"` -> `["grandparent", "grandchild"]`
  - `"grandpa"` -> `["grandparent", "grandchild"]`
  - `"grandfather"` -> `["grandparent", "grandchild"]`
  - `"uncle"` -> `["uncle", "nephew"]`
  - `"aunt"` -> `["uncle", "nephew"]`
  - `"auntie"` -> `["uncle", "nephew"]`
  - `"nephew"` -> `["nephew", "uncle"]`
  - `"niece"` -> `["nephew", "uncle"]`
  - `"boss"` -> `["boss", "subordinate"]`
  - `"mentor"` -> `["mentor", "protege"]`
  - `"godfather"` -> `["godparent", "godchild"]`
  - `"godmother"` -> `["godparent", "godchild"]`
  - `"godson"` -> `["godchild", "godparent"]`
  - `"goddaughter"` -> `["godchild", "godparent"]`
  - `"stepson"` -> `["stepchild", "stepparent"]`
  - `"stepdaughter"` -> `["stepchild", "stepparent"]`

**Expected outcome:** The data structure change compiles. No behavioral change yet since `scoreRelationship()` still needs updating.

### Step 2: Update `scoreRelationship()` to check against all mapped labels

**File:** `services/ai-router/src/contact-resolution/matcher.ts`

**What to do:**
- In `scoreRelationship()`, change the kinship lookup from:
  ```ts
  const mapped = KINSHIP_MAP.get(term);
  if (mapped && normalizedLabels.includes(mapped)) return 1;
  ```
  to:
  ```ts
  const mappedLabels = KINSHIP_MAP.get(term);
  if (mappedLabels && mappedLabels.some(label => normalizedLabels.includes(label))) return 1;
  ```
- The function signature and return type stay the same.
- The direct match check (`normalizedLabels.includes(term)`) stays unchanged -- it handles the case where the user's query term is already a Monica label.

**Expected outcome:** `scoreRelationship("mom", ["child"])` now returns 1. `scoreRelationship("mom", ["parent"])` still returns 1. `scoreRelationship("wife", ["spouse"])` still returns 1.

### Step 3: Add unit tests for bidirectional kinship matching

**File:** `services/ai-router/src/contact-resolution/__tests__/matcher.test.ts`

**What to do:** Add a new `describe("bidirectional kinship matching")` block with the following test cases.

**Test case 3a:** "mom" matches contact with `relationshipLabels: ["child"]` (contact IS a parent)
- Contact A (id: 100, "Elena Yuryevna", labels: `["child"]`) -- Elena has children listed, meaning she IS a parent.
- Query: "mom" → Expected: Contact A matches at score 0.9, matchReason: "relationship_label_match".

**Test case 3b:** "mom" matches contact with `relationshipLabels: ["parent"]` (backward compat)
- Contact B (id: 101, "Olga Petrova", labels: `["parent"]`) -- Olga has a parent listed.
- Query: "mom" → Expected: Contact B matches at score 0.9.

**Test case 3c:** "mom" matches BOTH directions, producing ambiguous result
- Contact A (id: 100, labels: `["child"]`), Contact B (id: 101, labels: `["parent"]`)
- Query: "mom" → Expected: Both contacts match at score 0.9.

**Test case 3d:** "dad" matches contacts with either "parent" or "child" labels
- Similar setup with male contacts, both directions.

**Test case 3e:** "boss" matches contacts with either "boss" or "subordinate" labels

**Test case 3f:** "uncle" matches contacts with either "uncle" or "nephew" labels

**Test case 3g:** Symmetric types still work -- "wife" matches "spouse" only

**Test case 3h:** "grandma" matches contacts with either "grandparent" or "grandchild" labels

**Test case 3i:** Real-world topology -- 3-contact family demonstrating fundamental ambiguity
- Contact A (id: 700, "Alice", labels: `["parent", "sibling"]`) -- has a parent AND a sibling
- Contact B (id: 701, "Mom Mary", labels: `["child", "spouse"]`) -- has children (IS parent) and a spouse
- Contact C (id: 702, "Dad Tom", labels: `["child", "spouse"]`) -- has children (IS parent) and a spouse
- Query: "mom" → Expected: All three match at 0.9 (ambiguity is by design)

**Test case 3j:** "mentor" matches both "mentor" and "protege" labels

**Test case 3k:** "godmother" matches both "godparent" and "godchild" labels

### Step 4: Update benchmark fixtures with bidirectional kinship cases

**File:** `services/ai-router/src/benchmark/fixtures/contact-resolution.ts`

New cases:
- **cr-046:** "mom" resolved via inverse label "child" (single contact)
- **cr-047:** "dad" resolved via inverse label "child" + "spouse"
- **cr-048:** "boss" resolved via inverse label "subordinate"
- **cr-049:** "uncle" ambiguous -- two contacts with "uncle" and "nephew" labels
- **cr-050:** Bidirectional kinship ambiguous with multiple parent-like contacts

### Step 5: Verify no regressions in existing tests and benchmarks

- Run `pnpm --filter ai-router test` to verify all existing tests pass.
- Run benchmark to verify contact-resolution precision stays >= 95%.
- All existing kinship benchmark cases (cr-010, cr-011, cr-013, cr-016, cr-025) produce the same results because no existing test fixtures include inverse labels.

## TDD Sequence

1. Write test 3a first: `"mom" matches contact with labels ["child"]` -- fails with current code.
2. Change KINSHIP_MAP type and values (Step 1).
3. Update `scoreRelationship` (Step 2).
4. Test 3a passes.
5. Run all existing tests -- verify they pass.
6. Write remaining tests 3b-3k (Step 3).
7. Add benchmark cases (Step 4).

## Smoke Test Strategy

This change is purely in the deterministic matcher logic (no HTTP endpoints, no new services, no configuration changes):

- **Docker Compose services to start:** `ai-router` (to verify the service starts without errors).
- **HTTP check:** `curl http://localhost:<ai-router-port>/health` -- expect 200 OK.
- **What the smoke test proves:** The code change does not break the service startup or health check. The actual kinship matching logic is fully covered by unit tests since `matchContacts()` is a pure deterministic function.

## Security Considerations

This change has minimal security impact:
- No new endpoints or ingress.
- No credential or PII handling changes.
- No new service-to-service calls.
- The KINSHIP_MAP contains only static English kinship terms mapped to Monica relationship labels.
- Redaction rules unaffected. No new data flows introduced.

## Risks & Mitigations

1. **Increased disambiguation frequency.** Bidirectional matching produces more ambiguous results. This is by design -- the "Progressive Contact Narrowing" feature (separate Phase 9 item) handles it.
2. **Benchmark precision impact.** New benchmark cases test for correct ambiguous outcomes, so precision stays >= 95%.
3. **Compound query scoring.** A compound query like "mom Elena" gives 0.9 to both directions because kinship dominates. True disambiguation requires "Progressive Contact Narrowing."
