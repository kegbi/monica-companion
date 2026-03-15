---
name: doc-review
description: >
  Perform thorough review of project documentation for gaps, mistakes, security
  issues, SOLID principle violations, architecture errors, and over-engineering.
  Use when the user asks to review docs, audit documentation, or check project
  specs for quality. Accepts a folder path as argument (defaults to context/product/).
  Outputs a detailed markdown report to context/reviews/.
---

# Documentation Review Skill

Perform a comprehensive, multi-dimensional review of project documentation and produce a detailed findings report saved to disk.

## Invocation

The user will provide a folder path containing documentation to review. If no path is given, default to `context/product/`.

## Review Process

Follow these steps exactly, in order. Do not skip steps.

### Step 1: Discover Documents

1. Recursively list all `.md` files in the target folder.
2. If no markdown files are found, check for other doc formats (`.txt`, `.yaml`, `.yml`, `.json`).
3. Report the total document count and list of files to be reviewed.

### Step 2: Read All Documents

Read every document found in Step 1. For each document, note:
- Its stated purpose or scope
- Key claims, decisions, and constraints
- Cross-references to other documents or external resources

### Step 3: Perform Multi-Dimensional Review

Analyze all documents across these review dimensions. For each finding, assign a severity level.

#### Severity Levels

| Level | Meaning |
|-------|---------|
| **CRITICAL** | Blocks correctness, security, or delivery. Must fix before proceeding. |
| **HIGH** | Significant gap or error that will cause problems if not addressed. |
| **MEDIUM** | Inconsistency, unclear spec, or design concern worth addressing. |
| **LOW** | Minor improvement, style issue, or nice-to-have clarification. |
| **INFO** | Observation or positive note — no action required. |

#### 3.1 Completeness & Gaps

- Are all essential topics covered (purpose, scope, stakeholders, constraints, success criteria)?
- Are there referenced documents, APIs, or services that are not defined anywhere?
- Are there user journeys, edge cases, or failure scenarios left unspecified?
- Are acceptance criteria present and testable?
- Are there TODO/TBD/placeholder markers left unresolved?
- Do cross-references between documents resolve correctly?

#### 3.2 Correctness & Consistency

- Do documents contradict each other on facts, terminology, or decisions?
- Are data types, field names, endpoint paths, and schemas consistent across docs?
- Are version numbers, dates, and status markers up to date?
- Do diagrams and text descriptions match?
- Are abbreviations and domain terms used consistently?

#### 3.3 Security Analysis

- Are authentication and authorization requirements clearly specified?
- Are data classification levels defined (PII, secrets, internal, public)?
- Is sensitive data handling documented (encryption at rest/transit, redaction, key rotation)?
- Are threat vectors and mitigations identified for external-facing surfaces?
- Are trust boundaries between services explicitly drawn?
- Are credential storage, transmission, and lifecycle documented?
- Do security requirements align with OWASP Top 10 and the project's own security rules?

#### 3.4 SOLID Principles & Design Quality

- **Single Responsibility**: Does each service/component have one clear reason to change?
- **Open/Closed**: Are extension points defined without requiring modification of existing contracts?
- **Liskov Substitution**: Are interface contracts and their implementations consistent?
- **Interface Segregation**: Are APIs and contracts lean, or do they force consumers to depend on things they don't use?
- **Dependency Inversion**: Do high-level modules depend on abstractions, not concrete implementations?
- Are coupling and cohesion appropriate for the documented architecture?

#### 3.5 Architecture Review

- Does the architecture match stated requirements and constraints?
- Are service boundaries clearly defined and justified?
- Are communication patterns (sync/async, pub-sub, request-response) appropriate?
- Are data flow directions and ownership clear?
- Are scaling, availability, and fault-tolerance strategies documented?
- Are deployment topology and infrastructure requirements specified?
- Do the documented patterns match the actual codebase structure (if checkable)?

#### 3.6 Over-Engineering Assessment

- Are there abstractions, layers, or indirections without clear justification?
- Are there speculative features or "future-proofing" without concrete requirements?
- Is the architecture more complex than the stated requirements demand?
- Are there unnecessary technology choices that add operational burden?
- Could simpler solutions achieve the same goals?
- Are there enterprise patterns applied to problems that don't warrant them?

#### 3.7 Clarity & Actionability

- Can a new team member understand the system from these docs alone?
- Are decisions documented with rationale (ADR-style "why", not just "what")?
- Are responsibilities and ownership clear for each component?
- Are operational procedures (deploy, rollback, incident response) documented?
- Is the writing clear, unambiguous, and free of jargon without definition?

### Step 4: Cross-Document Analysis

After reviewing individual documents, analyze relationships:
- Identify orphan documents (referenced nowhere, or referencing nothing)
- Identify circular dependencies in document references
- Check for scope overlaps or contradictions between documents
- Verify that the document set tells a coherent story end-to-end

### Step 5: Generate Report

Produce a structured markdown report with the following sections:

```markdown
# Documentation Review Report

**Reviewed folder:** `<path>`
**Review date:** <YYYY-MM-DD>
**Documents reviewed:** <count>

## Executive Summary

<2-4 sentence overview: overall documentation health, most critical issues, key recommendation>

## Documents Reviewed

| # | Document | Purpose | Status |
|---|----------|---------|--------|
| 1 | `path/to/doc.md` | Brief purpose | Needs work / Acceptable / Good |

## Findings

### Critical Findings
<numbered list with document reference, dimension, description, and recommended action>

### High Findings
<same format>

### Medium Findings
<same format>

### Low Findings
<same format>

### Positive Observations
<things done well worth preserving>

## Cross-Document Analysis

<orphans, contradictions, scope overlaps, coherence assessment>

## Summary Statistics

| Severity | Count |
|----------|-------|
| Critical | N |
| High | N |
| Medium | N |
| Low | N |
| Info | N |
| **Total** | **N** |

## Recommended Actions

<prioritized list of concrete next steps, ordered by severity and effort>
```

### Step 6: Save Report

1. Save the report to `context/reviews/doc-review-<YYYY-MM-DD>.md`.
2. If the `context/reviews/` directory doesn't exist, create it.
3. If a report for today already exists, append a counter: `doc-review-<YYYY-MM-DD>-2.md`.
4. Report the saved file path to the user.

## Review Principles

- **Be specific**: "Section X in doc Y contradicts section Z in doc W" — not "some docs are inconsistent".
- **Quote evidence**: Include the conflicting text or missing element.
- **Be actionable**: Every finding except INFO must have a recommended action.
- **Be proportional**: Don't flag simple docs for lacking enterprise patterns.
- **Respect intent**: Evaluate docs against their stated goals, not hypothetical ones.
- **No false positives**: If you're unsure whether something is an issue, mark it INFO with your reasoning rather than inflating severity.
