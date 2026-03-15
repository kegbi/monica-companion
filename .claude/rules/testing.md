# Testing Rules

## TDD Workflow

- Use test-driven development for all feature, bugfix, and refactor work.
- Enforce RED -> GREEN -> REFACTOR: write a failing test first, implement minimal code to pass, then clean up.
- TDD sequence must be preserved for behavior changes: failing test observed first, then minimal implementation.

## Monica API Testing

- Use mock or stub Monica payloads in automated tests and local validation by default.
- Do not call a real Monica instance during automated tests or normal CI runs.
- Prefer fixtures aligned with `context/product/monica-api-scope.md` contracts.
- Maintain a separate controlled real-Monica smoke suite outside normal CI, such as nightly or release-candidate execution.
- Production release requires the latest passing controlled real-Monica smoke suite.

## Test Strategy

- Unit tests per service using Vitest.
- Integration tests against real PostgreSQL and Redis via a Docker Compose test profile.
- End-to-end tests for critical user journeys, including voice transcription, pending-command confirmation, and reminder delivery.
- Relevant tests and checks must pass, or gaps are explicitly documented.
