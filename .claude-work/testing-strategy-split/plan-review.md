---
verdict: APPROVED
attempt: 1
critical_count: 0
high_count: 0
medium_count: 3
---

# Plan Review: Testing Strategy Split

## Summary

The plan establishes a two-tier testing strategy for Monica API interactions:
1. CI contract tests using mocked/stubbed fixtures (already in place, audit confirms CI-safety).
2. A controlled real-Monica smoke test suite running outside CI (nightly or release-candidate) as a production release gate.

The plan creates a Docker Compose overlay with a disposable Monica v4 instance, a seed script, a dedicated Vitest config for smoke tests, a GitHub Actions workflow for scheduled execution, and documentation.

## Findings

### MEDIUM

1. **Vitest default include pattern may pick up `__smoke__` files.** Create a `vitest.config.ts` for `monica-api-lib` that explicitly excludes `src/__smoke__/**`. This is a hard requirement, not conditional.

2. **`.env.smoke` gitignore entry location.** Add both `scripts/.env.smoke` and a broader `.env.smoke` pattern to `.gitignore`.

3. **Seed script needs explicit failure handling.** Fail fast with clear error if any seed step fails. Smoke test runner should verify `.env.smoke` exists before running tests.

### LOW

1. **TDD for smoke tests is adapted** — RED state is configuration absence / schema mismatch detection, not classic unit-test TDD.

2. **Rate limiting** — Ensure `fileParallelism: false` and sequential execution within files. Add inter-request delay if needed.

3. **Test result artifact format** — Specify concrete reporter config (e.g., `--reporter=junit`).

4. **Documentation placement** at `context/product/testing-strategy.md` is appropriate.

## Verdict

**APPROVED.** Well-structured, appropriately scoped, covers all roadmap sub-items and acceptance criteria. Medium findings are advisory implementation details, not design-level problems.
