---
verdict: APPROVED
reviewer: plan-reviewer
date: 2026-03-16
attempt: 1
critical_count: 0
high_count: 0
medium_count: 2
---

# Plan Review: Monica Contract Completion

## Findings

### CRITICAL
(none)

### HIGH
(none)

### MEDIUM

1. [MEDIUM] **"Strict schemas" phrasing is ambiguous and risks runtime failures on external API responses.** Step 6 states "Strict schemas (no `.passthrough()`)". In Zod v4 (which this project uses via `import { z } from "zod/v4"`), the default `z.object()` behavior already strips unknown keys -- which is the safe choice for external APIs. However, the word "Strict" could be read as an instruction to use `.strict()`, which would cause `z.ZodError` if Monica ever returns an undocumented field. -- **Fix:** Use default strip mode for response schemas (no `.passthrough()`, no `.strict()`); use `.strict()` only for request schemas where we control the payload shape.

2. [MEDIUM] **Zod v4 import path not specified.** The existing codebase consistently uses `import { z } from "zod/v4"` (six files across auth, types, observability, and services), matching `zod: 4.3.6` in the pnpm catalog. Without this guidance, the implementer may use `import { z } from "zod"` which resolves to a Zod v3 compatibility shim. -- **Fix:** Add to Step 6 design rules: "Import Zod as `import { z } from 'zod/v4'` to match the project convention."

### LOW

1. [LOW] **Gender object shape not included in documentation steps.** Step 6 creates a `gender.ts` Zod schema, but no documentation step adds the full Gender resource shape to `monica-api-scope.md`. -- **Fix:** Add a brief Gender object shape to the existing "Supporting Endpoints" section.

2. [LOW] **Smoke test exemption rationale is underdocumented.** The plan should formally cite `completion.md` and explain that this task produces zero runtime changes. -- **Fix:** Expand the exemption rationale.

3. [LOW] **`ContactResolutionSummary.aliases[]` sourcing is narrower than the architecture document describes.** V1 aliases are limited to name-derived fields vs the broader set described in `service-architecture.md`. -- **Fix:** Add a V1 note to the mapping table.

## Verdict Rationale

The plan is well-scoped, architecturally sound, and correctly bounded. Both roadmap sub-items are fully covered. The documentation shapes are source-verified against the actual Monica v4.1.1 PHP code. The two MEDIUM findings are implementation-guidance ambiguities, not structural design problems. No critical or high findings exist. APPROVED.
