# Implementation Plan: Monica Contract Completion

## Objective

Complete the Monica API contract documentation (`context/product/monica-api-scope.md`) and create the corresponding Zod schemas, TypeScript types, and test fixtures so that downstream work (the typed Monica client library, the `monica-integration` service, contact resolution, and all CI mock tests) can be built against verified contracts instead of guesswork.

This task is the foundation for Phase 2 (Typed Monica Integration, Testing Strategy Split) and Phase 3 (Contact Resolution Boundary, Command Contract).

## Scope

### In Scope

- Complete `context/product/monica-api-scope.md` with the missing Relationships, Relationship Types, Relationship Type Groups, and Tags API sections.
- Expand the embedded relationship data inside the full Contact object from untyped `"array"` to the documented `RelationshipShort` shape.
- Add a new section to `monica-api-scope.md` that maps Monica API fields to the `ContactResolutionSummary` projection fields, documenting exactly which endpoints and fields are consumed.
- Create Zod schemas in `@monica-companion/monica-api-lib` for all Monica v4 API response and request shapes documented in `monica-api-scope.md`.
- Create the `ContactResolutionSummary` Zod schema in `@monica-companion/types` (this is the Monica-agnostic internal contract consumed by `ai-router`).
- Create realistic JSON test fixtures in `@monica-companion/monica-api-lib` that parse cleanly against the Zod schemas.
- Add the `Source Code References` table entries for the newly documented endpoints.
- Add entries to the `Doc vs Actual Discrepancies Summary` table if new discrepancies are discovered.

### Out of Scope

- Implementing the actual HTTP client (`monica-api-lib` client class) -- that is the "Typed Monica Integration" roadmap item.
- Implementing the `monica-integration` service endpoints -- that is a separate roadmap item.
- Implementing the contact-resolution logic in `ai-router` -- that is Phase 3 "Contact Resolution Boundary".
- Verifying contracts against a live Monica instance (requires the controlled real-Monica smoke suite from "Testing Strategy Split").
- Any Monica endpoints not needed for V1 operations (gifts, debts, journal, conversations, calls, documents, photos, life events, occupations, companies, pets).

## Affected Services & Packages

| Package/Service | Changes |
|-----------------|---------|
| `context/product/monica-api-scope.md` | Add Relationships, Relationship Types, Relationship Type Groups, and Tags sections; expand Contact relationship shape; add ContactResolutionSummary mapping section |
| `packages/monica-api-lib` | Add `zod` dependency; create Zod schemas for all Monica API response/request types; create test fixtures; add Vitest tests |
| `packages/types` | Add `ContactResolutionSummary` Zod schema and types |

## Implementation Steps

### Step 1: Document Relationships API in `monica-api-scope.md`

**What to do:**
Add a new `## Relationships` section to `context/product/monica-api-scope.md` after the existing `## Supporting Endpoints` section (before `## Doc vs Actual Discrepancies Summary`). Document the following based on the verified Monica v4.1.1 source code in `references/remote/`:

**Endpoints to document:**
- `GET /api/contacts/:id/relationships` -- list all relationships for a contact (not paginated; returns collection directly)
- `GET /api/relationships/:id` -- get single relationship
- `POST /api/relationships` -- create relationship (request: `contact_is`, `of_contact`, `relationship_type_id`; note: also creates the reverse relationship automatically)
- `PUT /api/relationships/:id` -- update relationship (request: `relationship_type_id`)
- `DELETE /api/relationships/:id` -- delete relationship

**Shapes to document:**

Relationship object (full):
```jsonc
{
  "id": "int",
  "uuid": "string",
  "object": "relationship",
  "contact_is": "EmbeddedContact (short form)",
  "relationship_type": "RelationshipType",
  "of_contact": "EmbeddedContact (short form)",
  "url": "string (API URL)",
  "account": { "id": "int" },
  "created_at": "string (ISO 8601)",
  "updated_at": "string (ISO 8601)"
}
```

RelationshipShort object (embedded in full Contact `information.relationships.{group}.contacts[]`):
```jsonc
{
  "relationship": {
    "id": "int",
    "uuid": "string",
    "name": "string"       // relationship type name, e.g. "partner", "child", "friend"
  },
  "contact": "EmbeddedContact (short form)"
}
```

**Also update** the `Full Contact Object` section to replace the untyped `"array"` in `information.relationships.{love,family,friend,work}.contacts` with `"RelationshipShort[]"`.

**Source files:** `references/remote/app/Http/Resources/Relationship/Relationship.php`, `references/remote/app/Http/Resources/Relationship/RelationshipShort.php`, `references/remote/app/Http/Controllers/Api/ApiRelationshipController.php`, `references/remote/app/Services/Contact/Relationship/CreateRelationship.php`.

**Expected outcome:** The Relationships section is fully documented with request/response shapes matching the verified source code.

### Step 2: Document Relationship Types and Relationship Type Groups API in `monica-api-scope.md`

**What to do:**
Add `### Relationship Types` and `### Relationship Type Groups` subsections within the new `## Relationships` section.

**Endpoints to document:**

Relationship Types:
- `GET /api/relationshiptypes` -- list all relationship types (paginated)
- `GET /api/relationshiptypes/:id` -- get single relationship type

Relationship Type Groups:
- `GET /api/relationshiptypegroups` -- list all relationship type groups (paginated)
- `GET /api/relationshiptypegroups/:id` -- get single relationship type group

**Shapes:**

RelationshipType:
```jsonc
{
  "id": "int",
  "object": "relationshiptype",
  "name": "string",
  "name_reverse_relationship": "string",
  "relationship_type_group_id": "int",
  "delible": "boolean",
  "account": { "id": "int" },
  "created_at": "string (ISO 8601)",
  "updated_at": "string (ISO 8601)"
}
```

RelationshipTypeGroup:
```jsonc
{
  "id": "int",
  "object": "relationshiptypegroup",
  "name": "string",
  "delible": "boolean",
  "account": { "id": "int" },
  "created_at": "string (ISO 8601)",
  "updated_at": "string (ISO 8601)"
}
```

**Document default relationship types:** Include a table of the default relationship type names for each group.

**Note:** These are read-only in V1. We only need them for reading relationship labels during contact resolution.

**Source files:** `references/remote/app/Http/Resources/RelationshipType/RelationshipType.php`, `references/remote/app/Http/Resources/RelationshipTypeGroup/RelationshipTypeGroup.php`.

**Also update** the Source Code References table at the bottom of `monica-api-scope.md`.

**Expected outcome:** Relationship type metadata is documented so `monica-integration` can map relationship type names to `ContactResolutionSummary.relationshipLabels[]`.

### Step 3: Document Tags API in `monica-api-scope.md`

**What to do:**
Add a `## Tags` section. Tags are embedded in the full Contact object (already shown as `Tag[]`) but the shape and endpoints are not yet documented.

**Endpoints to document:**
- `GET /api/tags` -- list all tags (paginated)
- `GET /api/tags/:id` -- get single tag
- `GET /api/tags/:id/contacts` -- list contacts with a given tag
- `POST /api/contacts/:id/setTags` -- set tags on a contact
- `POST /api/contacts/:id/unsetTags` -- remove all tags from a contact
- `POST /api/contacts/:id/unsetTag` -- remove a specific tag from a contact

**Tag object:**
```jsonc
{
  "id": "int",
  "object": "tag",
  "name": "string",
  "name_slug": "string",
  "account": { "id": "int" },
  "created_at": "string (ISO 8601)",
  "updated_at": "string (ISO 8601)"
}
```

**Note:** Tag mutation endpoints are documented for reference but not used in V1.

**Source files:** `references/remote/app/Http/Resources/Tag/Tag.php`, `references/remote/routes/api.php`.

**Also update** the Source Code References table.

**Expected outcome:** Tag API shape is explicit. The full Contact object `tags` field is now traceable to a documented schema.

### Step 4: Add ContactResolutionSummary Mapping Section to `monica-api-scope.md`

**What to do:**
Add a new section `## ContactResolutionSummary Endpoint Mapping` at the end of the document (before the Source Code References section). This section documents exactly which Monica API endpoints and fields feed into each field of the `ContactResolutionSummary` projection.

**Mapping table:**

| ContactResolutionSummary Field | Monica Source Endpoint | Monica Source Fields | Notes |
|---|---|---|---|
| `contactId` | `GET /api/contacts` | `id` | Stable integer ID |
| `displayName` | `GET /api/contacts` | `complete_name` | Computed as "First Last (Nickname)" |
| `aliases[]` | `GET /api/contacts` | `nickname`, `first_name`, `last_name` | nickname is primary alias |
| `relationshipLabels[]` | `GET /api/contacts` embedded relationships | `RelationshipShort.relationship.name` per group | From contact's perspective |
| `importantDates[]` | `GET /api/contacts` | `information.dates.birthdate.date` | V1 focuses on birthdate |
| `lastInteractionAt` | `GET /api/contacts` | `last_activity_together` | Nullable |

**Also document the fetch strategy** for building the contact projection cache.

**Expected outcome:** Any developer can trace each projection field to a specific Monica API response field.

### Step 5: Add `zod` dependency to `@monica-companion/monica-api-lib`

**What to do:**
- Add `"zod": "catalog:"` to `packages/monica-api-lib/package.json` dependencies.
- Add `"vitest": "catalog:"` to devDependencies.
- Add `"test": "vitest run --passWithNoTests"` script.
- Run `pnpm install`.

### Step 6: Create Monica API response Zod schemas in `@monica-companion/monica-api-lib`

**What to do:**
Create Zod schemas in `packages/monica-api-lib/src/schemas/` for all documented Monica API types:

- `common.ts` -- Pagination, error, date field, account ref schemas
- `contact.ts` -- Full contact, embedded contact, relationship short, create/update request schemas
- `note.ts` -- Note schema, create request
- `activity.ts` -- Activity, activity type, create request schemas
- `reminder.ts` -- Reminder, outbox, create request schemas
- `contact-field.ts` -- Contact field, field type schemas
- `address.ts` -- Address, country schemas
- `relationship.ts` -- Full relationship, relationship type, type group schemas
- `tag.ts` -- Tag schema
- `gender.ts` -- Gender schema
- `index.ts` -- Re-exports

**Design rules:**
- Strict schemas (no `.passthrough()`)
- `.nullable()` for nullable fields, `.optional()` for conditionally absent fields
- `z.literal()` for object type discriminators
- `z.number().int()` for IDs
- `z.string()` for ISO 8601 timestamps

### Step 7: Create the `ContactResolutionSummary` schema in `@monica-companion/types`

**What to do:**
Create `packages/types/src/contact-resolution.ts` with:
- `ImportantDate` Zod schema and type
- `ContactResolutionSummary` Zod schema and type

Update `packages/types/src/index.ts` to re-export.

### Step 8: Create test fixtures in `@monica-companion/monica-api-lib`

**What to do:**
Create `packages/monica-api-lib/src/__fixtures__/` with realistic JSON fixtures for all documented types. Each fixture exports const objects that type-check against inferred Zod types.

### Step 9: Write Vitest tests for schema-fixture round-trips

**What to do:**
Create test files that validate every fixture parses through its Zod schema, plus negative tests for malformed inputs. Also create a mapping test that proves ContactResolutionSummary fields can be extracted from a full contact fixture.

### Step 10: Verify documentation completeness and build

**What to do:**
Review `monica-api-scope.md` end-to-end, run build, test, and biome check.

## Test Strategy

### Unit Tests (Vitest)
- Every Zod schema parses its corresponding fixture successfully
- Every schema rejects malformed inputs
- ContactResolutionSummary validates projection from contact fixture
- Paginated response generic works with different types
- ContactField data/content asymmetry is correct

### Integration Tests
- None required. Pure schema validation tests.

### TDD Sequence
For each schema group: write failing test → create fixture → create schema → verify pass → add negative test.

## Smoke Test Strategy

This task is documentation and contract definition with pure Zod schema validation. No Docker Compose smoke test needed.

**Verification:**
- `pnpm run build` -- all packages compile
- `pnpm run test` -- all schema tests pass
- `pnpm run check` -- Biome passes

## Security Considerations

- No secrets in fixtures (use obviously fake values)
- No Monica credentials in documentation examples
- Redaction-compatible field naming reviewed

## Risks & Open Questions

1. **Relationship type defaults may vary across instances.** Use `name` string from API, don't hardcode.
2. **Tags mutation endpoint shapes need source verification.** Deferred — tags are read-only in V1.
3. **`information.relationships` omitted for partial contacts.** Document in mapping section.
4. **Rate limit (60 req/min) constrains full-contact-list fetching.** Implementation concern for Typed Monica Integration task.
5. **`last_activity_together` may be null.** Document nullable behavior in mapping.
6. **Embedded contact format differs between full and short forms.** Model as two distinct schemas.
