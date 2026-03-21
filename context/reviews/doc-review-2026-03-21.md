# Documentation Review Report

**Reviewed target:** `context/product/`
**Review date:** 2026-03-21
**Documents reviewed:** 12 (10 in `context/product/`, plus `AGENTS.md` and `docs/secret-rotation.md` via cross-references)
**Seed documents:** All 10 files in `context/product/`
**Broken local references:** 5 occurrences of 1 broken path (see Finding #1)

## Executive Summary

The documentation set is comprehensive, well-structured, and internally consistent on most design decisions. The most critical issue is a stale "Current Repository State" section in `architecture.md` that says no code exists, when in fact the implementation is nearly complete through Phase 8. Five documents reference a broken path (`context/spec/adr-v1-deployment-profile.md`) for the ADR that actually lives in `context/product/`. The shared-packages list in the architecture docs omits two packages (`guardrails`, `observability`) that exist in the repo. Overall, the docs are strong source-of-truth artifacts that need a focused cleanup pass to catch up with the implemented reality.

## Documents Reviewed

| # | Document | Role | Purpose | Status |
|---|----------|------|---------|--------|
| 1 | `context/product/product-definition.md` | Source | Full product spec: vision, features, boundaries | Good |
| 2 | `context/product/product-definition-lite.md` | Summary | One-page product overview | Acceptable |
| 3 | `context/product/architecture.md` | Source | Tech stack, infra, deployment, observability | Needs work |
| 4 | `context/product/service-architecture.md` | Source | Service descriptions, responsibilities, communication | Good |
| 5 | `context/product/acceptance-criteria.md` | Source | V1 acceptance checklist | Good |
| 6 | `context/product/monica-api-scope.md` | Source | Monica v4 API contracts and endpoints | Good |
| 7 | `context/product/testing-strategy.md` | Source | Test approach, CI vs smoke, release gates | Good |
| 8 | `context/product/roadmap.md` | Source | Execution phases and task tracking | Good |
| 9 | `context/product/adr-v1-deployment-profile.md` | Source | ADR for V1 deployment decisions | Good |
| 10 | `context/product/v1-release-readiness-report.md` | Summary | Release readiness assessment | Good |
| 11 | `AGENTS.md` | Rules | Document index and reference paths | Needs work |
| 12 | `docs/secret-rotation.md` | Source | Secret rotation policy (referenced by SE-11) | Not reviewed in depth |

## Findings

### Critical Findings

_(none)_

### High Findings

**#1 [HIGH] — Broken cross-reference: `context/spec/adr-v1-deployment-profile.md` does not exist**

- **Dimension:** Completeness & Gaps
- **Files affected:**
  - `context/product/product-definition.md:119`
  - `context/product/architecture.md:18`
  - `context/product/architecture.md:58`
  - `context/product/roadmap.md:3`
  - `context/product/v1-release-readiness-report.md:24`
  - `AGENTS.md:18`
- **Description:** Six references point to `context/spec/adr-v1-deployment-profile.md`, but the file actually lives at `context/product/adr-v1-deployment-profile.md`. The `context/spec/` directory contains only `data-governance.md`, `operational-review-findings.md`, and `connector-extension-guide.md`.
- **Impact:** Anyone following these doc links will hit a dead end. The ADR is a key governance document referenced by 5 product docs.
- **Proposal:** Update all 6 references from `context/spec/adr-v1-deployment-profile.md` to `context/product/adr-v1-deployment-profile.md`. Alternatively, move the ADR file to `context/spec/` if that is the intended canonical location (but then all other product docs would need to stay referencing `context/spec/`).

---

**#2 [HIGH] — `architecture.md` "Current Repository State" section is completely stale**

- **Dimension:** Correctness & Consistency
- **File:** `context/product/architecture.md:9-12`
- **Description:** Lines 9-12 state: _"The repository currently contains product, review, and rules documentation. No pnpm workspace, service packages, Docker Compose file, or GitHub Actions workflows are committed yet."_ In reality, the repo has a full pnpm monorepo with 8 services, 8 packages, 4 Docker Compose files, 4 GitHub Actions workflows, and the roadmap is nearly complete through Phase 8.
- **Impact:** Any new contributor reading this doc will form an entirely wrong picture of the project's implementation status. This is the first section in the architecture doc after the header.
- **Proposal:** Either remove Section 0 ("Repository State") entirely — since the architecture doc should describe the target architecture, not track repo state — or update it to accurately reflect the current state: "The pnpm monorepo is implemented with 8 service packages, 8 shared packages, Docker Compose stacks for dev/smoke/CI, and GitHub Actions workflows for CI, Monica smoke, and LLM smoke testing." Also update the `> Status:` line at the top (line 3) which says "pnpm workspace, service packages, Docker Compose stack, and GitHub Actions workflows described below are target-state artifacts, not committed implementation."

---

### Medium Findings

**#3 [MEDIUM] — Shared packages list in architecture docs omits `guardrails` and `observability`**

- **Dimension:** Correctness & Consistency
- **File:** `context/product/architecture.md:26`
- **Description:** The architecture doc lists 6 shared packages: `types`, `utils`, `monica-api-lib`, `auth`, `idempotency`, `redaction`. The actual repo has 8 packages: the listed 6 plus `guardrails` (per-user rate limits, concurrency caps, budget tracking, kill switch) and `observability` (OpenTelemetry SDK initialization, log redaction processors). The `service-architecture.md:175-181` shared concerns table also omits both.
- **Impact:** New contributors and AI agents won't know these packages exist. The `guardrails` package is particularly important as it implements SE-12 (shared OpenAI key guardrails).
- **Proposal:** Add `@monica-companion/guardrails` and `@monica-companion/observability` to the shared packages list in `architecture.md:26` and to the shared concerns table in `service-architecture.md:175-181`. Include their scope descriptions: guardrails handles per-user rate limits, concurrency caps, budget alarms, and kill switch for shared OpenAI usage; observability provides OTel SDK initialization and redaction-aware log/trace processors for all services.

---

**#4 [MEDIUM] — `product-definition-lite.md` introduces drift from source doc**

- **Dimension:** Correctness & Consistency
- **Files:** `context/product/product-definition-lite.md:24` vs `context/product/product-definition.md`
- **Description:** The lite summary compresses the modular architecture into a single dense paragraph (line 24) that includes details not present in the full product definition, such as "`conversation_turns` persistence" as a parenthetical in the architecture section, and "data-governance enforcement (retention cleanup, account disconnection purges)" which is phrased differently from the source doc. Additionally, the lite doc says "Delivery audit records" as a standalone feature, while the full doc frames it as part of the delivery service responsibilities. These are minor drift points, but the lite doc is at risk of being treated as an alternative source of truth.
- **Impact:** Low immediate risk, but summary docs that evolve independently from their source are a known drift vector. The lite doc has no "derived from" header or update-tracking mechanism.
- **Proposal:** Add a header line to `product-definition-lite.md` explicitly marking it as derived: `_Derived from [product-definition.md](product-definition.md). When in conflict, product-definition.md is authoritative._` This prevents the summary from being treated as a competing source of truth.

---

**#5 [MEDIUM] — `architecture.md` status line contradicts implemented reality**

- **Dimension:** Correctness & Consistency
- **File:** `context/product/architecture.md:3`
- **Description:** The status line reads: `> Status: Planned target architecture. As of 2026-03-15 the repository contains documentation only; the pnpm workspace, service packages, Docker Compose stack, and GitHub Actions workflows described below are target-state artifacts, not committed implementation.` This is false — all of these artifacts are committed and in active use.
- **Impact:** Overlaps with Finding #2 but is the single most visible indicator of staleness. The date "2026-03-15" is only 6 days old, suggesting this was never updated during implementation.
- **Proposal:** Change the status line to: `> Status: Implemented. The architecture described below is deployed as the V1 stack. See context/product/v1-release-readiness-report.md for conformance details.`

---

**#6 [MEDIUM] — Roadmap marks all Phase 1-7 items as complete, but Phase 8 has implementation gaps blocking V1**

- **Dimension:** Completeness & Gaps
- **File:** `context/product/roadmap.md:219-243`
- **Description:** All items in Phases 1-7 are marked `[x]` (complete), but the V1 release readiness report identifies three HIGH/MEDIUM risk gaps: (1) `/start` command handler was missing (now marked complete in Phase 8), (2) web-UI form is a skeleton, (3) contact resolution not wired into LangGraph. The roadmap accurately tracks these as Phase 8 unchecked items, so there is no contradiction, but the boundary between "V1 complete" and "Phase 8 remaining" could be clearer.
- **Impact:** A reader might see Phases 1-7 complete and assume V1 is ready, not realizing Phase 8 contains V1-blocking work.
- **Proposal:** Add a note at the top of the roadmap (after the existing intro paragraph) clarifying: `> **Current status:** Phases 1-7 complete. Phase 8 contains remaining V1-blocking gaps — see v1-release-readiness-report.md for details.`

---

**#7 [MEDIUM] — `v1-release-readiness-report.md` deferred item OM-1 is now resolved but report not updated**

- **Dimension:** Correctness & Consistency
- **File:** `context/product/v1-release-readiness-report.md:176-193`
- **Description:** The deferred item "OM-1 (partial): Telegram /start Command Handler" is listed as `DEFERRED — tracked in Phase 8 of roadmap`. However, the roadmap shows the `/start` command handler task as `[x]` (complete), and the git log shows commit `7af02ef` "Mark Telegram /start Command Handler as complete in roadmap" from the recent history. The release readiness report has not been updated to reflect this.
- **Impact:** The report overstates remaining gaps. Someone relying on it for release decisions will see a stale picture.
- **Proposal:** Update the OM-1 deferred item status to `RESOLVED` with a reference to the implementing commit. Update the executive summary "Three deferred items are HIGH risk" to "Two deferred items are HIGH risk" and remove OM-1 from the high-risk list. Similarly review the other deferred items for any that may have been completed since the report was written.

---

**#8 [MEDIUM] — Container count claim ("16 total") verified but `deps-init` is not counted anywhere**

- **Dimension:** Completeness & Gaps
- **Files:** `context/product/product-definition.md:119`, `context/product/service-architecture.md:3`
- **Description:** The docs claim "16 containers — 8 application + 3 infrastructure + 5 observability." The actual `docker-compose.yml` contains a `deps-init` service (a `node:24.14.0-slim` init container used to install pnpm dependencies) that is not mentioned in any documentation. The 16-count is technically correct for running containers (init exits after completion), but the existence of this helper service is undocumented.
- **Impact:** Minor. A new contributor might be surprised by `deps-init` when reading docker-compose.yml.
- **Proposal:** Add a brief note to `architecture.md` Section 3 or `service-architecture.md` Infrastructure Services table: "A `deps-init` init container runs once at startup to install pnpm dependencies and then exits. It is not counted in the running container total."

---

### Low Findings

**#9 [LOW] — `AGENTS.md` "Where to Find What" table is missing entries for implemented artifacts**

- **Dimension:** Completeness & Gaps
- **File:** `AGENTS.md:7-19`
- **Description:** The AGENTS.md index does not list `context/product/v1-release-readiness-report.md`, `context/spec/data-governance.md`, `context/spec/operational-review-findings.md`, `context/spec/connector-extension-guide.md`, `context/product/testing-strategy.md`, or `docs/secret-rotation.md`. These are all meaningful documents that a contributor might need to locate.
- **Impact:** Reduced discoverability for important operational and testing docs.
- **Proposal:** Add rows to the AGENTS.md table for: testing strategy (`context/product/testing-strategy.md`), V1 release readiness report (`context/product/v1-release-readiness-report.md`), data governance spec (`context/spec/data-governance.md`), connector extension guide (`context/spec/connector-extension-guide.md`), operational review findings (`context/spec/operational-review-findings.md`), and secret rotation policy (`docs/secret-rotation.md`).

---

**#10 [LOW] — `testing-strategy.md` LLM smoke section says tests run through `telegram-bridge -> ai-router` path**

- **Dimension:** Correctness & Consistency
- **File:** `context/product/testing-strategy.md:87-88`
- **Description:** Line 87-88 says LLM smoke tests send messages "through the live `ai-router /internal/process` endpoint (bypassing `telegram-bridge`, which has its own smoke tests)." However, the Phase 6 roadmap entry for LLM smoke tests (roadmap.md line 181) says tests "send representative text messages through the live `telegram-bridge -> ai-router` path." These contradict each other on whether the test path includes telegram-bridge.
- **Impact:** Ambiguity about what the LLM smoke tests actually test. The actual smoke test files (`services/ai-router/src/__smoke__/`) would resolve this, but the docs should be consistent.
- **Proposal:** Verify the actual test path from the smoke test code and update whichever document is wrong. If the tests hit `ai-router` directly (as `testing-strategy.md` claims), update the roadmap Phase 6 description. If they go through `telegram-bridge`, update `testing-strategy.md`.

---

**#11 [LOW] — `monica-api-scope.md` "Source Code References" section references gitignored local paths**

- **Dimension:** Clarity & Actionability
- **File:** `context/product/monica-api-scope.md:890-920`
- **Description:** The source code references table lists paths under `references/remote/app/` which is gitignored. The re-download instructions are in `AGENTS.md` but not in `monica-api-scope.md` itself. A reader following these references without knowing about AGENTS.md will find nothing at those paths.
- **Impact:** Minor friction for contributors verifying API contracts against source.
- **Proposal:** Add a one-line note after `monica-api-scope.md:893`: "These paths are gitignored. See AGENTS.md for re-download instructions."

---

**#12 [LOW] — Test unit/integration failure count in release readiness report may be stale**

- **Dimension:** Correctness & Consistency
- **File:** `context/product/v1-release-readiness-report.md:264-266`
- **Description:** The report lists "1076 passed, 9 failed, 147 skipped" and "112 test files, 24 failed, 6 skipped" with a note about pre-existing module resolution failures. Since development has continued past this report (Phase 8 work), these numbers are likely outdated. The report is dated 2026-03-20 (yesterday).
- **Impact:** Relying on stale test counts for release decisions.
- **Proposal:** Re-run `pnpm test` and update the test results summary before any release decision. Consider adding a "last verified" timestamp to the test results section.

---

### Positive Observations

1. **Excellent contract documentation.** `monica-api-scope.md` is outstanding — verified against real API behavior with discrepancies documented, source code references provided, and input/output asymmetries called out explicitly. This is a model for API contract documentation.

2. **Strong security posture.** Security considerations are woven throughout every document, not confined to a single security section. Setup token semantics, credential encryption, SSRF protections, caller allowlists, and redaction are consistently specified.

3. **Clear service boundary rationale.** Each service in `service-architecture.md` includes a "Why separate" explanation, making architectural decisions traceable. The ADR provides additional rationale and validation criteria.

4. **Well-structured acceptance criteria.** `acceptance-criteria.md` is organized by domain, uses testable criteria (not vague goals), and has clear status markers. The criteria IDs (CF-1, SE-2, etc.) provide a shared vocabulary used consistently across the release readiness report.

5. **Honest release readiness assessment.** The `v1-release-readiness-report.md` transparently lists deferred items with risk ratings, doesn't hide gaps, and provides specific "what exists" vs "what's missing" breakdowns.

6. **Testing strategy is well-separated.** The CI vs smoke suite split is clearly documented with rationale, and the release gate policy is explicit about requiring both suites to pass.

## Cross-Document Analysis

### Orphan Documents

- `context/spec/data-governance.md`, `context/spec/operational-review-findings.md`, and `context/spec/connector-extension-guide.md` are not referenced from any document in `context/product/` or from `AGENTS.md`. They may be orphaned or only referenced from code/comments.

### Scope Overlaps

- `architecture.md` and `service-architecture.md` overlap significantly on service descriptions, container counts, and deployment topology. `service-architecture.md` is more detailed; `architecture.md` provides broader context (stack, data, infra). The two are complementary but their scope boundaries are not declared.
- `product-definition.md` Section 3.1 (In-Scope) restates much of Section 2.1 (Core Features). The repetition is acceptable for a product spec but creates two places where feature scope must be maintained.

### Source vs Summary Drift

- `product-definition-lite.md` is a faithful summary of `product-definition.md` with minor phrasing drift noted in Finding #4. No factual contradictions found.
- `v1-release-readiness-report.md` has begun to drift from the roadmap: OM-1 is now complete in the roadmap but still listed as deferred in the report (Finding #7).

### Document Coherence

The document set tells a coherent story: product-definition defines scope → architecture defines how → service-architecture details the services → acceptance-criteria defines done → roadmap sequences the work → testing-strategy defines validation → release readiness report assesses progress. Cross-references between these docs are consistent (except for the broken ADR path in Finding #1).

## Over-Engineering Notes

No significant over-engineering detected in the documentation itself. The 8-service architecture is justified by the ADR with specific criteria (independent failure domains, scaling needs, contract preservation). The documentation explicitly notes that the operational overhead is a trade-off (ADR:29-31) and includes validation criteria to re-evaluate the decision.

The data governance and retention specifications are detailed but proportional to the security requirements (handling MonicaHQ API keys and personal contact data). The benchmark and quality gate requirements are aggressive but appropriate for a system that executes mutations against a user's personal CRM.

## Summary Statistics

| Severity | Count |
|----------|-------|
| Critical | 0 |
| High | 2 |
| Medium | 6 |
| Low | 4 |
| Info | 6 |
| **Total** | **18** |

## Recommended Actions

1. **[Finding #1, HIGH]** Fix all 6 references to `context/spec/adr-v1-deployment-profile.md` — update them to `context/product/adr-v1-deployment-profile.md` (or move the file). This is a quick find-and-replace across 5 files plus AGENTS.md.

2. **[Finding #2 + #5, HIGH]** Update `architecture.md` Section 0 and the status line to reflect the current implemented state. Remove or rewrite the "Current Repository State" paragraph and update the status banner.

3. **[Finding #3, MEDIUM]** Add `guardrails` and `observability` packages to the shared packages lists in `architecture.md` and `service-architecture.md`.

4. **[Finding #7, MEDIUM]** Update `v1-release-readiness-report.md` to mark OM-1 as resolved, update the executive summary counts, and review other deferred items for staleness.

5. **[Finding #4, MEDIUM]** Add a "derived from" header to `product-definition-lite.md` marking `product-definition.md` as authoritative.

6. **[Finding #6, MEDIUM]** Add a status note at the top of `roadmap.md` clarifying current progress and pointing to the release readiness report.

7. **[Finding #8, MEDIUM]** Document the `deps-init` container in the architecture or service-architecture doc.

8. **[Finding #9, LOW]** Expand the AGENTS.md index with missing document entries.

9. **[Finding #10, LOW]** Reconcile the LLM smoke test path description between `testing-strategy.md` and `roadmap.md`.

10. **[Finding #11, LOW]** Add a re-download cross-reference note to `monica-api-scope.md`.

11. **[Finding #12, LOW]** Re-run tests and update the release readiness report test counts before release.

## Resolution Checklist

- [x] **#1 [HIGH]** Broken ADR cross-reference in 6 locations — updated all `context/spec/adr-v1-deployment-profile.md` references to `context/product/adr-v1-deployment-profile.md`
- [x] **#2 [HIGH]** Stale "Current Repository State" in `architecture.md` — rewrote Section 0 and updated status banner to reflect implemented state
- [x] **#3 [MEDIUM]** Missing shared packages — added `guardrails` and `observability` to shared package lists in `architecture.md` and `service-architecture.md`
- [x] **#4 [MEDIUM]** Summary doc drift risk — added "derived from" header to `product-definition-lite.md` marking `product-definition.md` as authoritative
- [x] **#5 [MEDIUM]** Stale architecture status line — updated `architecture.md` to say "Implemented" instead of "Planned target"
- [x] **#6 [MEDIUM]** Roadmap status ambiguity — added a current-status note to `roadmap.md` clarifying Phase 8 contains V1-blocking work
- [x] **#7 [MEDIUM]** Stale release readiness report — updated OM-1 to RESOLVED, adjusted executive summary deferred-item count (3→2 HIGH, 69→70 PASS, 6→5 DEFERRED)
- [x] **#8 [MEDIUM]** Undocumented deps-init container — added note about the init container to `architecture.md` Section 0
- [x] **#9 [LOW]** Incomplete AGENTS.md index — added entries for testing-strategy, release readiness report, data-governance spec, connector guide, operational review, secret rotation
- [x] **#10 [LOW]** LLM smoke test path contradiction — verified smoke tests hit `ai-router /internal/process` directly; updated `roadmap.md` to match `testing-strategy.md`
- [x] **#11 [LOW]** Missing re-download reference in monica-api-scope.md — added cross-reference to AGENTS.md for gitignored source paths
- [ ] **#12 [LOW]** Stale test counts in release readiness report — re-run `pnpm test` and update Section 4 before release decisions
