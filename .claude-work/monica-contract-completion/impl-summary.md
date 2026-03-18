# Implementation Summary: Monica Contract Completion

## Files Changed

| File | Action | Description |
|------|--------|-------------|
| `context/product/monica-api-scope.md` | modified | Added Relationships (full, short, types, type groups), Tags, Gender object shape sections; ContactResolutionSummary endpoint mapping with fetch strategy; updated Full Contact relationship type from untyped "array" to "RelationshipShort[]"; added source code references for new resources |
| `packages/monica-api-lib/package.json` | modified | Added `zod` dependency, `vitest` devDependency, and `test` script |
| `packages/monica-api-lib/src/index.ts` | modified | Re-exports all schema types from schemas/index.ts |
| `packages/monica-api-lib/src/schemas/common.ts` | created | AccountRef, MonicaDateField, Avatar, PaginationMetaLink, PaginationLinks, PaginationMeta, PaginatedResponse, DeleteResponse, ErrorResponse schemas |
| `packages/monica-api-lib/src/schemas/contact.ts` | created | EmbeddedContact, RelationshipShort, FullContact, CreateContactRequest, UpdateContactCareerRequest schemas |
| `packages/monica-api-lib/src/schemas/note.ts` | created | Note, CreateNoteRequest schemas |
| `packages/monica-api-lib/src/schemas/activity.ts` | created | ActivityTypeCategory, ActivityType, Activity, CreateActivityRequest schemas |
| `packages/monica-api-lib/src/schemas/reminder.ts` | created | FrequencyType, Reminder, ReminderOutbox, CreateReminderRequest schemas |
| `packages/monica-api-lib/src/schemas/contact-field.ts` | created | ContactFieldType, ContactField, CreateContactFieldRequest schemas |
| `packages/monica-api-lib/src/schemas/address.ts` | created | Country, Address, CreateAddressRequest schemas |
| `packages/monica-api-lib/src/schemas/relationship.ts` | created | RelationshipType, RelationshipTypeGroup, Relationship, CreateRelationshipRequest, UpdateRelationshipRequest schemas |
| `packages/monica-api-lib/src/schemas/tag.ts` | created | Tag schema |
| `packages/monica-api-lib/src/schemas/gender.ts` | created | Gender schema |
| `packages/monica-api-lib/src/schemas/index.ts` | created | Re-exports all schemas |
| `packages/monica-api-lib/src/__fixtures__/embedded-contact.ts` | created | Embedded contact fixtures (2 contacts) |
| `packages/monica-api-lib/src/__fixtures__/full-contact.ts` | created | Full contact fixture with relationships, addresses, tags |
| `packages/monica-api-lib/src/__fixtures__/note.ts` | created | Note and CreateNoteRequest fixtures |
| `packages/monica-api-lib/src/__fixtures__/activity.ts` | created | Activity, ActivityType, ActivityTypeCategory, and CreateActivityRequest fixtures |
| `packages/monica-api-lib/src/__fixtures__/reminder.ts` | created | Reminder, ReminderOutbox, and CreateReminderRequest fixtures |
| `packages/monica-api-lib/src/__fixtures__/contact-field.ts` | created | ContactField, ContactFieldType, and CreateContactFieldRequest fixtures |
| `packages/monica-api-lib/src/__fixtures__/address.ts` | created | Address and Country fixtures |
| `packages/monica-api-lib/src/__fixtures__/relationship.ts` | created | Relationship, RelationshipType, RelationshipTypeGroup, RelationshipShort, and request fixtures |
| `packages/monica-api-lib/src/__fixtures__/tag.ts` | created | Tag fixture |
| `packages/monica-api-lib/src/__fixtures__/gender.ts` | created | Gender fixture |
| `packages/monica-api-lib/src/__fixtures__/common.ts` | created | DeleteResponse and ErrorResponse fixtures |
| `packages/monica-api-lib/src/__fixtures__/paginated.ts` | created | Paginated contacts response fixture |
| `packages/monica-api-lib/src/__fixtures__/create-contact.ts` | created | CreateContactRequest fixture |
| `packages/monica-api-lib/src/__fixtures__/index.ts` | created | Re-exports all fixtures |
| `packages/monica-api-lib/src/__tests__/schemas.test.ts` | created | Comprehensive schema-fixture round-trip tests |
| `packages/types/package.json` | modified | Added `vitest` devDependency and `test` script |
| `packages/types/src/contact-resolution.ts` | created | ImportantDate and ContactResolutionSummary Zod schemas and types |
| `packages/types/src/index.ts` | modified | Added re-export of ContactResolutionSummary and ImportantDate |
| `packages/types/src/__tests__/contact-resolution.test.ts` | created | ContactResolutionSummary schema tests and Monica contact mapping test |

## Tests Added

| Test File | What It Tests |
|-----------|---------------|
| `packages/monica-api-lib/src/__tests__/schemas.test.ts` | 44 tests: schema-fixture round-trips for all Monica API types (AccountRef, MonicaDateField, EmbeddedContact, FullContact, RelationshipShort, Note, Activity, Reminder, ReminderOutbox, ContactField, ContactFieldType, Address, Country, Relationship, RelationshipType, RelationshipTypeGroup, Tag, Gender, PaginatedResponse, DeleteResponse, ErrorResponse, CreateContactRequest, CreateNoteRequest, CreateActivityRequest, CreateReminderRequest, CreateContactFieldRequest, CreateRelationshipRequest, UpdateRelationshipRequest); negative tests for malformed inputs; unknown-key stripping verification for response schemas; strict-mode rejection for request schemas |
| `packages/types/src/__tests__/contact-resolution.test.ts` | 9 tests: ContactResolutionSummary schema parsing, nullable lastInteractionAt, empty arrays, non-integer contactId rejection, missing required fields; ImportantDate schema parsing; mapping test proving ContactResolutionSummary can be extracted from a Monica full contact shape |

## Verification Results

- **Biome**: `pnpm check` -- Checked 167 files in 55ms. No fixes applied. 0 errors, 0 warnings.
- **Tests**:
  - `@monica-companion/monica-api-lib`: 1 test file, 44 tests passed
  - `@monica-companion/types`: 1 test file, 9 tests passed
  - `@monica-companion/auth`: 5 test files, 55 tests passed (unrelated, verified no regressions)
  - `@monica-companion/redaction`: 1 test file, 40 tests passed (unrelated, verified no regressions)
  - `@monica-companion/observability`: 4 test files, 23 tests passed (unrelated, verified no regressions)
  - `services/user-management`: 1 integration test failed -- pre-existing, requires PostgreSQL (ECONNREFUSED). Not related to this change.
- **Build**: Both `@monica-companion/monica-api-lib` and `@monica-companion/types` build successfully with tsup.

## Plan Review Findings Addressed

| Finding | Resolution |
|---------|------------|
| MEDIUM-1 (Schema strictness) | Response schemas use default strip mode (no `.passthrough()`, no `.strict()`). Request schemas use `.strict()` to reject unknown keys. Verified with test: unknown keys are stripped from response schemas, rejected from request schemas. |
| MEDIUM-2 (Zod v4 import path) | All schema files use `import { z } from "zod/v4"` consistently. |
| LOW-1 (Gender shape) | Added Gender object shape to the "Supporting Endpoints" section of monica-api-scope.md. |
| LOW-3 (Aliases V1 note) | Added V1 note to the ContactResolutionSummary mapping table and to the ContactResolutionSummary schema JSDoc noting aliases are limited to name-derived fields. |

## Plan Deviations

- **AddressInline in contact.ts**: The FullContact schema defines an inline address object schema rather than importing from `address.ts` to avoid circular dependency issues (Address references EmbeddedContact). The standalone Address schema in `address.ts` is the canonical one used for standalone address parsing.
- **contactFields and notes optional fields**: In FullContact, `contactFields` and `notes` are typed as `z.array(z.unknown()).optional()` rather than with full schemas, because these fields are only present with the `?with=contactfields` query parameter and their detailed shape validation is not critical at the top-level contact schema. Full Note and ContactField schemas exist separately for parsing individual resources.
- **emotions field**: Activity's `emotions` field is typed as `z.array(z.unknown())` since emotions are not a V1 concern and their shape is not documented.

## Residual Risks

1. **No live Monica verification**: Schemas are based on source code analysis, not live API testing. The controlled real-Monica smoke suite (from the "Testing Strategy Split" roadmap item) will provide definitive validation.
2. **Tag mutation endpoint shapes**: `setTags`, `unsetTags`, `unsetTag` request shapes are documented but no Zod request schemas were created since they are not used in V1.
3. **Relationship list endpoint not paginated**: The `GET /api/contacts/:id/relationships` endpoint returns a collection without pagination. This is different from most other list endpoints. The schema does not enforce this -- consumers should be aware.
4. **user-management integration test failure**: Pre-existing ECONNREFUSED to PostgreSQL. Not related to this change.
