---
name: doc-audit
description: >
  End-to-end product documentation audit. Discovers project docs, dispatches
  parallel reviewer agents per doc category, checks for gaps, missing user flow
  steps, inconsistencies, and incorrect assumptions. Collects findings, presents
  questions to the user, applies fixes, and re-runs review until clean. Works
  with any repository — dynamically discovers structure and adapts review briefs.
user-invocable: true
---

# Product Documentation Audit

Discover project documentation, dispatch parallel reviewer agents, iteratively fix and re-verify until clean. Adapts to any repository structure.

## Invocation

```
/doc-audit [--fix] [--focus <category>]
```

- `--fix`: After presenting findings, automatically apply fixes that don't need user input, then re-run
- `--focus <category>`: Audit only one category (e.g., `roadmap`, `product`, `architecture`, `criteria`, `testing`)
- No flags: Full audit of all discovered docs, present findings, wait for user direction

---

## Process

Follow precisely. Do not skip steps.

### Step 0: Discovery

Before dispatching any reviewers, you must understand what exists.

1. **Find product/spec docs.** Search the repo for documentation directories and files:
   - Glob for common locations: `context/**/*.md`, `docs/**/*.md`, `spec/**/*.md`, `design/**/*.md`, `.github/**/*.md`, `**/README.md`, `**/ARCHITECTURE.md`, `**/ROADMAP.md`
   - Also check root-level files: `CLAUDE.md`, `AGENTS.md`, `*.md`
   - Read any index/table-of-contents file to discover further docs

2. **Classify each discovered doc** into one of these categories based on its content:

   | Category | What it is | Examples |
   |----------|-----------|---------|
   | `roadmap` | Execution plan, task list, milestones | roadmap.md, TODO.md, milestones.md |
   | `product` | Product definition, features, user journeys, scope | product-definition.md, PRD.md, features.md, product-spec.md |
   | `architecture` | System design, service boundaries, communication | architecture.md, service-architecture.md, system-design.md, ADRs |
   | `criteria` | Acceptance criteria, definition of done, release gates | acceptance-criteria.md, requirements.md, DoD.md |
   | `testing` | Test strategy, test plan, QA approach | testing-strategy.md, test-plan.md, QA.md |
   | `other` | Anything else (API specs, runbooks, guides) | Reviewed but not dispatched as a primary category |

   A single file can belong to only one primary category. If unsure, read the first 50 lines to determine purpose.

3. **Discover project structure.** Quickly scan to understand:
   - What services/packages/modules exist (check top-level dirs, workspace config, docker-compose, etc.)
   - What the tech stack is (check package.json, go.mod, Cargo.toml, pyproject.toml, etc.)
   - How things are deployed (Dockerfiles, docker-compose, k8s manifests, etc.)

4. **Extract user journeys.** Read the product doc (if found) and extract every distinct user-facing flow. These become the happy paths to trace through the roadmap. If no product doc exists, infer flows from README, code structure, or ask the user.

5. **Report discovery results** to the user before proceeding:
   ```
   Discovered N docs across M categories:
   - roadmap: <file> (N lines)
   - product: <file> (N lines)
   - ...

   Project structure: <brief summary>
   User journeys found: <list>

   Proceeding with audit...
   ```

---

### Step 1: Dispatch Parallel Reviewers

Spawn **one `doc-auditor` agent per discovered category** using the Agent tool. Launch ALL agents in parallel (single message, multiple Agent tool calls).

For each agent, construct a prompt containing:
1. The **target document path**
2. A **review brief** built from the templates in "Review Brief Templates" below, with all `{placeholders}` filled in using discovery results
3. **Cross-reference documents** — all other discovered docs the agent must read for consistency
4. **Output file path**: `context/reviews/doc-audit-<category>-<YYYY-MM-DD>.md` (create `context/reviews/` if needed)
5. If re-auditing: the **previous findings file** with instruction to verify fixes

If `--focus` is specified, dispatch only the matching reviewer.
If a category has no doc, skip it (don't invent findings for missing docs — just note the absence in the summary).

---

### Step 2: Collect and Merge Findings

After all agents return:

1. Read every output file
2. Build a merged findings list sorted by severity (CRITICAL first)
3. Collect all "Questions for User" into one list
4. Perform the cross-document consistency checks from "Cross-Document Checks" below
5. Add any cross-document issues as additional findings

---

### Step 3: Present Consolidated Report

Present to the user:

```
## Doc Audit Results — <date>

### Findings by Severity
- CRITICAL: N
- HIGH: N
- MEDIUM: N
- LOW: N

### Questions Requiring Your Input
1. <question> (source: <category>)
2. ...

### Top Findings
<list CRITICAL and HIGH findings with proposals>

### Cross-Document Issues
<contradictions or drift between documents>

Full reports saved to context/reviews/
```

---

### Step 4: Apply Fixes

If user answers questions or approves fixes (or `--fix` flag was set):

1. For each finding with a concrete proposal that does NOT need user clarification: apply the fix
2. For findings needing user input: wait for answers, then apply
3. Skip INFO items

---

### Step 5: Re-Audit (Verification Pass)

After fixes are applied:

1. Re-dispatch the same agents with previous findings as context
2. Instruction: "Verify previous CRITICAL/HIGH findings are resolved. Report any that remain or new issues from fixes."
3. Collect results
4. If CRITICAL or HIGH remain → back to Step 3
5. If only MEDIUM/LOW/INFO → proceed to Step 6

---

### Step 6: Final Summary

```
## Doc Audit Complete — <date>

### Resolution
- Resolved: N findings
- Remaining (advisory): N
- Audit rounds: N

### Files Modified
- <list>

### Remaining Advisory Items
- <MEDIUM/LOW items not fixed, with rationale>
```

---

## Review Brief Templates

Each template uses `{placeholders}` that you fill in from Step 0 discovery results. Every brief is self-contained — the reviewer agent has no prior knowledge of the project.

### Roadmap Brief

```
REVIEW TYPE: roadmap-completeness

TARGET: {roadmap_file_path}

PROJECT CONTEXT:
{project_summary — stack, structure, services/modules discovered}

CROSS-REFERENCES (read all of these):
{list all other discovered doc paths}

PRIMARY FOCUS: User happy-path tracing

INSTRUCTIONS:

1. EXTRACT USER JOURNEYS from the product/spec docs listed in cross-references.
   If no product doc exists, infer journeys from the roadmap itself and the
   codebase structure.

   The following journeys were identified during discovery:
   {user_journeys — numbered list extracted in Step 0}

2. For EACH journey, walk the happy path end-to-end:
   - Break it into concrete steps (e.g., "user clicks X → system does Y → user sees Z")
   - For each step: does a roadmap task exist that would produce the code for it?
   - For each step: does the code actually exist? (check by reading key source files)
   - If a step has no roadmap task AND no code: flag as CRITICAL
   - If a step has a roadmap task marked complete but the code is missing/incomplete:
     flag as CRITICAL

3. Check phase ordering:
   - Does any phase depend on work from a later phase?
   - Are prerequisites satisfied before dependent work begins?

4. Check coverage:
   - Does every acceptance criterion (if one exists) map to at least one roadmap task?
   - Are there roadmap tasks that don't contribute to any documented requirement?

5. Check completeness:
   - Are there tasks marked [x] (done) where the implementation is actually
     missing? Verify by reading key source files — don't trust checkboxes.
   - Are there tasks that seem incomplete but are marked done?

6. Check for over-scoping:
   - Are there tasks in the roadmap that aren't needed for the stated goals?
   - Could any tasks be deferred without blocking the user journey?
```

### Product Definition Brief

```
REVIEW TYPE: product-definition-completeness

TARGET: {product_file_path}

PROJECT CONTEXT:
{project_summary}

CROSS-REFERENCES (read all):
{list all other discovered doc paths}

PRIMARY FOCUS: Feature coverage and user journey completeness

INSTRUCTIONS:

1. For every feature described:
   - Is it covered by at least one acceptance criterion (if criteria doc exists)?
   - Is it covered by at least one roadmap task (if roadmap exists)?
   - Is the description complete enough to implement unambiguously?
   - Are error/failure scenarios described?

2. For every user journey or workflow described:
   - Is every step detailed enough to implement?
   - Are failure paths described?
   - Are there implicit steps between documented steps?

3. Check scope boundaries:
   - For every "in scope" item: is there a component/service responsible for it?
   - For every "out of scope" item: is it accidentally referenced as in-scope
     elsewhere in the docs?

4. Check assumptions:
   - Are there version numbers, API references, or pricing that may be outdated?
   - Are there behavioral assumptions about third-party services that aren't validated?
   - Are there user behavior assumptions that aren't supported by evidence?

5. Check ambiguities:
   - Where could two engineers interpret the spec differently?
   - Where is behavior under-specified for edge cases?
```

### Architecture Brief

```
REVIEW TYPE: architecture-consistency

TARGET: {architecture_file_path}

PROJECT CONTEXT:
{project_summary}

CROSS-REFERENCES (read all):
{list all other discovered doc paths}

VERIFY AGAINST CODE — for each service/module/component documented, read its
main entry point or route definitions to check documented claims.

PRIMARY FOCUS: Boundary correctness and communication completeness

INSTRUCTIONS:

1. For every service/module/component listed:
   - Does it exist in the codebase?
   - Do documented responsibilities match what the code actually does?
   - Are there routes/endpoints in code that aren't documented?
   - Are there documented routes that don't exist in code?

2. For every communication path or data flow described:
   - Does the corresponding client/caller code exist?
   - Are there service-to-service calls in code that aren't in the docs?
   - Are there documented flows that have no implementation?

3. Check access control / caller allowlists (if documented):
   - Do they match what the code enforces?
   - Are there endpoints with no access control documentation?

4. Check state management / lifecycle docs:
   - Do state machines match the code?
   - Are all states and transitions documented?

5. Check for missing paths:
   - Are there interactions required by the product definition that
     aren't documented in the architecture?
   - Is every user journey step covered by a documented communication path?

6. Check infrastructure:
   - Do documented containers/services match docker-compose or deployment configs?
   - Are ports, networks, and dependencies accurate?
```

### Acceptance Criteria Brief

```
REVIEW TYPE: acceptance-criteria-coverage

TARGET: {criteria_file_path}

PROJECT CONTEXT:
{project_summary}

CROSS-REFERENCES (read all):
{list all other discovered doc paths}

PRIMARY FOCUS: Testability and coverage gaps

INSTRUCTIONS:

1. For every criterion:
   - Is it testable? Could you write a pass/fail test?
   - Is it unambiguous? Could two testers disagree on pass/fail?
   - Does it have a corresponding roadmap task (if roadmap exists)?

2. Check coverage against the product definition (if it exists):
   - For every feature: is there at least one criterion?
   - For every user journey step: is there a criterion that verifies it works?
   - For every scope item: is it covered?

3. Find missing criteria:
   - Are there user-visible behaviors with no criterion?
   - Are there failure scenarios that should be tested?
   - Are there security properties that need explicit criteria?

4. Check for vagueness:
   - Are there criteria without measurable thresholds?
   - Are there criteria that use subjective language ("should be fast", "secure")?

5. Check for staleness:
   - Do any criteria reference descoped features?
   - Are any criteria duplicates?
```

### Testing Strategy Brief

```
REVIEW TYPE: testing-strategy-coverage

TARGET: {testing_file_path}

PROJECT CONTEXT:
{project_summary}

CROSS-REFERENCES (read all):
{list all other discovered doc paths}

VERIFY AGAINST CODE — check that referenced test files/directories actually exist.

PRIMARY FOCUS: Coverage of acceptance criteria and strategy gaps

INSTRUCTIONS:

1. For every acceptance criterion (if criteria doc exists):
   - Is there a documented test approach (unit, integration, e2e, manual)?
   - If specific test files are referenced, do they exist?

2. Check test pyramid balance:
   - Are there areas with only high-level tests but no unit tests?
   - Are there areas with only unit tests but no integration tests?

3. Check test infrastructure documentation:
   - Are test environments documented (docker-compose, test DBs, etc.)?
   - Is the CI/CD test pipeline documented?
   - Are test data fixtures documented?

4. Find testing gaps:
   - Are failure scenarios tested?
   - Are security scenarios tested?
   - Are multi-user/tenant isolation scenarios tested?
   - Are edge cases (timezone, locale, large data) tested?

5. Check consistency with project testing rules (if any exist in
   rules files, CLAUDE.md, or contributing guides).
```

---

## Cross-Document Consistency Checks

After individual reviews complete, you (the orchestrator) must check for drift:

1. **Component/service count**: all docs should agree on the number and names of components.

2. **Feature ↔ criteria coverage**: every product feature should have at least one criterion, and every criterion should map to a product feature.

3. **Communication paths**: every service interaction in the architecture doc should be consistent with the product definition's described behavior.

4. **Terminology**: same concepts should use the same names across docs (watch for subtle drift like "pending command" vs "pending action" vs "draft command").

5. **Version/tech references**: library versions, API model names, runtime versions — should be consistent across all docs.

6. **Deferred items**: items marked deferred/out-of-scope in one doc should not be described as in-scope or implemented in another.

7. **Access control**: documented caller/permission lists should be consistent across architecture, security rules, and code.

---

## Output Location

```
context/reviews/
├── doc-audit-roadmap-<YYYY-MM-DD>.md
├── doc-audit-product-<YYYY-MM-DD>.md
├── doc-audit-architecture-<YYYY-MM-DD>.md
├── doc-audit-criteria-<YYYY-MM-DD>.md
├── doc-audit-testing-<YYYY-MM-DD>.md
└── doc-audit-summary-<YYYY-MM-DD>.md
```

If `context/reviews/` does not exist, create it. If a report for today exists, append `-2`, `-3`, etc.

---

## Rules

- Always run Step 0 discovery first. Never assume file locations or project structure.
- Dispatch reviewers in PARALLEL for speed.
- Never skip the verification re-audit after fixes.
- Questions for User are blocking — do not auto-fix items that need clarification.
- Lead with CRITICAL/HIGH findings and questions. Don't bury important items.
- If a finding is disputed by the user (intentional decision), mark it resolved and don't re-flag.
- Maximum 3 audit rounds. After 3, present remaining issues as known residual items.
- If a category has no matching document, note the absence but don't fabricate findings.
- Every review brief must include the project context summary from discovery so reviewers have full context without prior knowledge.
