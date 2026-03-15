---
name: doc-review
description: >
  Perform thorough review of project documentation for gaps, mistakes, security
  issues, SOLID principle violations, architecture errors, and over-engineering.
  Use when the user asks to review docs, audit documentation, or check project
  specs for quality. Accepts a folder path or seed document (defaults to
  context/product/), expands the local document graph from references, and
  outputs a detailed markdown report with file/line evidence to
  context/reviews/.
---

# Documentation Review Skill

Perform a comprehensive, multi-dimensional review of project documentation and produce a detailed findings report saved to disk.

## Invocation

```
/doc-review [path-or-seed]
```

- `path-or-seed` may be:
  - a folder path containing documentation to review
  - a seed document such as `AGENTS.md`, `README.md`, or another index/spec file
- If no path is given, default to `context/product/`.
- If the user asks for a repo-wide scan, prefer repo root or a seed doc plus local link expansion instead of only one docs folder.

## Review Process

Follow these steps exactly, in order. Do not skip steps.

### Step 1: Discover Scope and Seed Documents

1. Determine whether the target is a folder or a single document.
2. If the target is a folder, recursively list all `.md` files in that folder.
3. If the target is a single document, treat it as a seed document.
4. If the target folder is repo root or contains index-style docs such as `AGENTS.md`, `README.md`, or architecture/product indexes, include those as seed documents.
5. Resolve local document references from the seed set and expand the review set to include linked local docs even when they live outside the initial folder.
6. Record broken or unresolved local references as findings.
7. If no markdown files are found, check for other doc formats (`.txt`, `.yaml`, `.yml`, `.json`) that clearly act as docs or contracts.
8. Report the total document count, seed documents, expanded linked documents, and any broken references found during discovery.

### Step 2: Read All Documents

Read every document found in Step 1. For each document, note:
- Its stated purpose or scope
- Key claims, decisions, and constraints
- Cross-references to other documents or external resources
- Whether it appears to be a source-of-truth doc, a summary, a rules file, or a derived/duplicate doc
- Any TODO/TBD/placeholder markers
- The exact file/line locations for claims likely to become evidence in findings

If local repo context exists and can be checked cheaply, also compare documentation claims against:
- actual package/service names
- container/service counts
- local config or schema names
- directory structure and boundary placement
- duplicated docs that may have drifted apart

### Step 3: Perform Multi-Dimensional Review

Analyze all documents across these review dimensions. For each finding, assign a severity level.

#### Severity Levels

| Level | Meaning |
|-------|---------|
| **CRITICAL** | Blocks correctness, security, or delivery. Must fix before proceeding. |
| **HIGH** | Significant gap or error that will cause problems if not addressed. |
| **MEDIUM** | Inconsistency, unclear spec, or design concern worth addressing. |
| **LOW** | Minor improvement, style issue, or nice-to-have clarification. |
| **INFO** | Observation or positive note; no action required. |

#### 3.1 Completeness & Gaps

- Are all essential topics covered (purpose, scope, stakeholders, constraints, success criteria)?
- Are referenced documents, APIs, or services defined somewhere authoritative?
- Are user journeys, edge cases, or failure scenarios left unspecified?
- Are acceptance criteria present and testable?
- Are TODO/TBD/placeholder markers left unresolved?
- Do cross-references between documents resolve correctly?
- Is there a designated source-of-truth contract that other docs depend on, and is it actually complete?
- For stateful or multi-step flows, are pending states, transitions, expiration, retries, and failure recovery documented?

#### 3.2 Correctness & Consistency

- Do documents contradict each other on facts, terminology, or decisions?
- Are data types, field names, endpoint paths, and schemas consistent across docs?
- Are version numbers, dates, and status markers up to date?
- Do diagrams and text descriptions match?
- Are abbreviations and domain terms used consistently?
- Are counts, matrices, allowed-caller lists, ownership tables, and deployment totals internally consistent?
- Do summary docs faithfully compress source docs, or do they introduce drift and new facts?

#### 3.3 Security Analysis

- Are authentication and authorization requirements clearly specified?
- Are data classification levels defined (PII, secrets, internal, public)?
- Is sensitive data handling documented (encryption at rest/transit, redaction, key rotation)?
- Are threat vectors and mitigations identified for external-facing surfaces?
- Are trust boundaries between services explicitly drawn?
- Are credential storage, transmission, and lifecycle documented?
- Do security requirements align with OWASP Top 10 and the project's own security rules?
- Are public ingress paths and internal-only endpoints clearly separated?
- Are replay, CSRF, webhook authenticity, rate limits, and one-time link/token semantics specified where relevant?
- Are untrusted outbound targets controlled (for example SSRF, egress restrictions, redirect handling, or callback validation)?
- Is least-privilege access defined for services/components that can reach secrets or sensitive user data?
- Are retention, deletion, and minimization rules defined for logs, traces, queues, audits, and stored histories?

#### 3.4 SOLID Principles & Design Quality

- **Single Responsibility**: Does each service/component have one clear reason to change?
- **Open/Closed**: Are extension points defined without requiring modification of existing contracts?
- **Liskov Substitution**: Are interface contracts and their implementations consistent?
- **Interface Segregation**: Are APIs and contracts lean, or do they force consumers to depend on things they do not use?
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
- Are retries, timeouts, idempotency, ordering, and backpressure responsibilities assigned clearly, or duplicated across layers?
- Are interactive workflows modeled with explicit state ownership, correlation IDs, or lifecycle transitions where needed?
- Are "connector-agnostic" or "adapter" interfaces truly abstract, or do they leak platform-specific assumptions?

#### 3.6 Over-Engineering Assessment

- Are there abstractions, layers, or indirections without clear justification?
- Are there speculative features or "future-proofing" without concrete requirements?
- Is the architecture more complex than the stated requirements demand?
- Are there unnecessary technology choices that add operational burden?
- Could simpler solutions achieve the same goals?
- Are there enterprise patterns applied to problems that do not warrant them?
- Has service decomposition outrun contract maturity, creating operational overhead before core behavior is nailed down?

#### 3.7 Clarity & Actionability

- Can a new team member understand the system from these docs alone?
- Are decisions documented with rationale (ADR-style "why", not just "what")?
- Are responsibilities and ownership clear for each component?
- Are operational procedures (deploy, rollback, incident response) documented?
- Is the writing clear, unambiguous, and free of jargon without definition?
- Is it obvious which doc is authoritative when two docs cover the same topic at different levels of detail?

### Step 4: Cross-Document Analysis

After reviewing individual documents, analyze relationships:
- Identify orphan documents (referenced nowhere, or referencing nothing)
- Identify circular dependencies in document references
- Check for scope overlaps or contradictions between documents
- Verify that the document set tells a coherent story end-to-end
- Classify docs as source-of-truth, summary, rules, duplicate, or generated, and flag drift between them
- Verify that every local reference discovered from seed docs was either reviewed or reported missing
- If local code/config was checked, note any doc-versus-repo mismatches separately from doc-versus-doc contradictions

### Step 5: Generate Report

Produce a structured markdown report with the following sections:

```markdown
# Documentation Review Report

**Reviewed target:** `<path>`
**Review date:** <YYYY-MM-DD>
**Documents reviewed:** <count>
**Seed documents:** <list>
**Broken local references:** <count or none>

## Executive Summary

<2-4 sentence overview: overall documentation health, most critical issues, key recommendation>

## Documents Reviewed

| # | Document | Role | Purpose | Status |
|---|----------|------|---------|--------|
| 1 | `path/to/doc.md` | Source / Summary / Rules / Duplicate | Brief purpose | Needs work / Acceptable / Good |

## Findings

### Critical Findings
<numbered list with exact `path:line`, dimension, description, impact, and recommended action>

### High Findings
<same format>

### Medium Findings
<same format>

### Low Findings
<same format>

### Positive Observations
<things done well worth preserving>

## Cross-Document Analysis

<orphans, contradictions, scope overlaps, coherence assessment, source-vs-summary drift>

## Over-Engineering Notes

<cases where complexity appears ahead of requirements, plus simpler alternatives when appropriate>

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
2. If the `context/reviews/` directory does not exist, create it.
3. If a report for today already exists, append a counter: `doc-review-<YYYY-MM-DD>-2.md`.
4. Report the saved file path to the user.

## Review Principles

- **Be specific**: "Section X in doc Y contradicts section Z in doc W" - not "some docs are inconsistent".
- **Use exact evidence**: Include `path:line` references and quote only the minimum needed.
- **Be actionable**: Every finding except INFO must have a recommended action.
- **Be proportional**: Do not flag simple docs for lacking enterprise patterns.
- **Respect intent**: Evaluate docs against their stated goals, not hypothetical ones.
- **No false positives**: If you are unsure whether something is an issue, mark it INFO with your reasoning rather than inflating severity.
- **Expand from seed docs**: Do not stop at the initial folder if local linked docs widen the real review scope.
- **Separate drift types**: Distinguish doc-versus-doc contradictions from doc-versus-repo mismatches.
- **Check summaries carefully**: Lightweight overview docs often drift first; compare them against their source docs.
