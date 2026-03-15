# Testing Rules

## TDD Workflow
- Use test-driven development for all feature, bugfix, and refactor work.
- Enforce RED -> GREEN -> REFACTOR: write a failing test first, implement minimal code to pass, then clean up.
- TDD sequence must be preserved for behavior changes: failing test observed first, then minimal implementation.

## Monica API Testing
- Use mock/stub Monica payloads in tests and local validation by default.
- Do not call a real Monica instance during automated tests or CI runs.
- Prefer fixtures aligned with `context/product/monica-api-scope.md` contracts.

## Test Strategy
- Unit tests per service using Vitest.
- Integration tests against real PostgreSQL and Redis via Docker Compose test profile.
- E2E tests for critical user journeys (voice -> transcribe -> command -> MonicaHQ).
- Relevant tests/checks must pass, or gaps are explicitly documented.
