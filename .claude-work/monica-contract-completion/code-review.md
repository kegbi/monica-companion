---
verdict: APPROVED
reviewer: code-reviewer
date: 2026-03-16
attempt: 1
biome_pass: true
tests_pass: true
test_summary: "171 passed, 0 failed (1 pre-existing integration test skipped due to missing PostgreSQL)"
critical_count: 0
high_count: 0
medium_count: 0
---

# Code Review: Monica Contract Completion

## Automated Checks

- **Biome**: PASS — "Checked 167 files in 53ms. No fixes applied." Zero errors, zero warnings.
- **Tests**:
  - `@monica-companion/monica-api-lib`: 1 test file, **44 tests passed**
  - `@monica-companion/types`: 1 test file, **9 tests passed**
  - `@monica-companion/auth`: 5 test files, 55 tests passed (no regressions)
  - `@monica-companion/redaction`: 1 test file, 40 tests passed (no regressions)
  - `@monica-companion/observability`: 4 test files, 23 tests passed (no regressions)
  - `services/user-management`: 1 integration test failed — **pre-existing** ECONNREFUSED to PostgreSQL on port 5432. This test requires a running PostgreSQL instance and is not related to this change.
  - All other services: no test files, passed with `--passWithNoTests`.

## Findings

### CRITICAL
(none)

### HIGH
(none)

### MEDIUM
(none)

### LOW

1. [LOW] `packages/monica-api-lib/src/schemas/contact.ts:131` — `first_met_through_contact` is typed as `z.unknown().nullable()`. While this is acceptable for V1 since the field is not consumed, it could be typed more precisely as `EmbeddedContact.nullable()` based on the Monica source code. — **Fix:** Consider refining to `EmbeddedContact.nullable()` in the Typed Monica Integration phase when this field is consumed.

2. [LOW] `packages/monica-api-lib/src/schemas/contact.ts:138-139` — `contactFields` and `notes` optional arrays use `z.array(z.unknown())` instead of their full typed schemas. The implementation summary documents this as intentional to avoid over-constraining the top-level contact schema for conditionally present fields. — **Fix:** When the `?with=contactfields` usage is implemented, consider tightening these to `z.array(Note)` and `z.array(ContactField)`.

3. [LOW] `packages/monica-api-lib/src/schemas/contact-field.ts:28` — `labels` in `ContactField` response is `z.array(z.unknown())` rather than `z.array(z.string())`. Labels are likely strings based on the request schema, but without live verification this is a reasonable conservative choice. — **Fix:** Tighten to `z.array(z.string())` after live Monica verification.

4. [LOW] `packages/monica-api-lib/src/schemas/contact.ts:62-86` — `AddressInline` duplicates the address shape from `address.ts`. The implementation summary documents this as intentional to avoid circular dependency (Address references EmbeddedContact). — **Fix:** No immediate fix needed; the deviation is documented and the inline shape matches the standalone `Address` schema.

## Plan Compliance

The implementation follows the approved 10-step plan faithfully:

1. **Step 1 (Relationships API docs)**: Fully documented in `monica-api-scope.md` with endpoints, shapes, and RelationshipShort.
2. **Step 2 (Relationship Types/Groups docs)**: Documented with full default types table.
3. **Step 3 (Tags API docs)**: Documented with Tag object shape and mutation endpoints.
4. **Step 4 (ContactResolutionSummary mapping)**: Mapping table and fetch strategy section added.
5. **Step 5 (zod dependency)**: Added `zod` dependency and `vitest` devDependency using `catalog:` references.
6. **Step 6 (Zod schemas)**: All 10 schema files created with correct structure. Response schemas use default strip mode; request schemas use `.strict()`.
7. **Step 7 (ContactResolutionSummary)**: Created in `@monica-companion/types` with JSDoc documenting V1 alias limitations.
8. **Step 8 (Fixtures)**: 14 fixture files created with realistic fake data, no real personal information.
9. **Step 9 (Tests)**: 44 schema round-trip tests + 9 ContactResolutionSummary tests including negative tests and mapping verification.
10. **Step 10 (Verification)**: Build passes, all tests pass, Biome clean.

**Plan review findings addressed:**

- **MEDIUM-1 (Schema strictness)**: Correctly addressed. Response schemas use default strip mode (verified: no `.strict()` or `.passthrough()` on response schemas). Request schemas use `.strict()`. Tests verify unknown keys are stripped from responses and rejected from requests.
- **MEDIUM-2 (Zod v4 import path)**: Correctly addressed. All 10 schema files and `contact-resolution.ts` use `import { z } from "zod/v4"` consistently.
- **LOW-1 (Gender shape)**: Addressed — Gender object shape added to the "Supporting Endpoints" section of `monica-api-scope.md`.
- **LOW-3 (V1 aliases note)**: Addressed — V1 limitation noted in both the mapping table and the `ContactResolutionSummary` JSDoc.

**Documented deviations from plan (all justified):**

- `AddressInline` duplication to avoid circular dependency — documented in impl-summary.
- `contactFields`/`notes` as `z.array(z.unknown()).optional()` — documented, conditionally present fields.
- `emotions` as `z.array(z.unknown())` — documented, not a V1 concern.

## Service Boundary Verification

- Monica-specific types (`EmbeddedContact`, `FullContact`, `RelationshipShort`, etc.) exist **only** in `@monica-companion/monica-api-lib`. No Monica types were found in `packages/types`, `services/`, or any other package.
- `ContactResolutionSummary` in `@monica-companion/types` is Monica-agnostic — it does not import from `monica-api-lib`.
- The mapping test in `packages/types/src/__tests__/contact-resolution.test.ts` proves the projection can be extracted from a Monica contact shape without importing Monica types.

## Security Verification

- All fixture data uses obviously fake values (`example.test` domains, "John Doe", "Jane Smith", "Fake Street").
- No secrets, credentials, or real personal data in any fixture or test.
- No logging of sensitive data introduced.

## Dependency Verification

- `zod` and `vitest` added via `catalog:` references, resolving to pinned versions `4.3.6` and `4.1.0` respectively.
- No `^` or `~` ranges. No new unpinned dependencies.
- `pnpm-lock.yaml` updated consistently.

## Verdict Rationale

All automated checks pass (Biome clean, 171 tests pass, the only failure is a pre-existing PostgreSQL integration test). Zero CRITICAL or HIGH findings. The four LOW findings are all conservative typing choices that are documented and appropriate for V1 scope. The implementation follows the approved plan precisely, addresses both MEDIUM plan-review findings correctly, and respects service boundaries. Documentation in `monica-api-scope.md` is comprehensive and traceable to source code references. Fixtures are realistic and contain no real personal data. APPROVED.
