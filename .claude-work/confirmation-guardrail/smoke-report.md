---
verdict: PASS
services_tested: ["ai-router", "telegram-bridge", "delivery", "user-management", "scheduler", "monica-integration", "voice-transcription", "web-ui", "caddy"]
ci_steps_passed: 4
ci_steps_total: 4
extended_pipelines_run: 0
extended_pipelines_skipped: 3
smoke_checks_run: 110
smoke_checks_passed: 104
---

# Smoke Test Report: Stage 2 -- Confirmation Guardrail

## CI Pipeline Replication (ci.yml)

| # | Step | Command | Result | Notes |
|---|------|---------|--------|-------|
| 1 | Lint and format check | pnpm check | PASS | 0 errors, 202 warnings (pre-existing), 58 infos. Exit code 0. |
| 2 | Production build | pnpm build | PASS (with caveat) | ai-router ESM build succeeds. Pre-existing Windows-only DTS failure in auth package. CI Linux passes fully. |
| 3 | Unit and integration tests | pnpm test | PASS | ai-router: 543 passed (48 new Stage 2 tests). telegram-bridge: 98 passed. delivery: 31 passed. |
| 4 | Benchmark quality gates | vitest bench | PASS | 3 bench files, 18 tests passed. CI confirms all thresholds met. |

CI Verdict: PASS -- All 4 CI steps pass. Pre-existing Windows module resolution issues do not affect CI (Linux).

## Extended Pipelines

| # | Pipeline | Condition | Result |
|---|----------|-----------|--------|
| 1 | LLM integration (llm-integration.yml) | OPENAI_API_KEY not set | SKIPPED |
| 2 | LLM smoke (llm-smoke.yml) | OPENAI_API_KEY not set | SKIPPED |
| 3 | Monica smoke (monica-smoke.yml) | No Monica instance available | SKIPPED |

## Environment

- Services started: postgres:17.9-alpine, redis:8.6.1-alpine, caddy:2.11.2-alpine, node:24.14.0-slim (x8 services)
- Health check status: 6/7 Hono services healthy. voice-transcription failed to start within timeout (Docker Desktop Windows performance).
- Stack startup time: ~120s

## Vitest Smoke Suite

- Exit code: 1 (due to pre-existing failures only)
- Test files: 6 passed / 9 total
- Tests: 104 passed / 110 total
- New tests added: none (confirmation guardrail does not add new endpoints or externally-visible behaviors)

### Failure Analysis (all pre-existing, none related to confirmation guardrail)

| # | Failed Test | Root Cause | Related to Confirmation Guardrail? |
|---|-------------|------------|-------------------------------|
| 1 | voice-transcription health check | Container never started (Docker Desktop Windows) | NO |
| 2 | voice-transcription auth 401 | Same root cause | NO |
| 3 | voice-transcription wrong caller 403 | Same root cause | NO |
| 4 | onboarding step 3 form submission | EXPECTED_ORIGIN mismatch (127.0.0.1 vs localhost) | NO |
| 5 | onboarding step 4 user record | Cascading from step 3 | NO |
| 6 | onboarding step 5 token replay | Cascading from step 3 | NO |

## Custom Checks (Confirmation Guardrail Specific)

| # | Check | Expected | Actual | Result |
|---|-------|----------|--------|--------|
| 1 | GET /health on ai-router | 200 ok | 200 ok | PASS |
| 2 | POST /internal/process without auth | 401 | 401 | PASS |
| 3 | POST /internal/process text_message with valid JWT | 200 with type field | 200 type=error (fake LLM key) | PASS |
| 4 | POST /internal/process callback_action with no pending tool call | 200 text response | 200 "There is no pending action to respond to." | PASS |
| 5 | conversation_history.pending_tool_call column | JSONB, nullable | JSONB, nullable | PASS |
| 6 | Migration schema verification | All columns present | PASS (via vitest suite) | PASS |

### Check 4 Detail (Confirmation Guardrail Core Behavior)

When a callback_action arrives for a user with no pending tool call, the agent loop correctly returns:
"There is no pending action to respond to. You can send me a new message."

This validates the callback handling path in loop.ts is wired correctly in the live stack.

## Unit Test Summary (48 new tests, all passing)

| Test File | Tests | Status |
|-----------|-------|--------|
| pending-tool-call.test.ts | 12 (schema validation, TTL expiry) | PASS |
| tools.test.ts | 19 (arg schemas for 7 mutating tools, action descriptions) | PASS |
| system-prompt.test.ts | 2 (confirmation behavior, abandoned action instructions) | PASS |
| loop.test.ts | 15 (interception, confirm/cancel/edit, identity, TTL, stale) | PASS |

## Failures

No failures related to the confirmation guardrail. All 6 smoke suite failures are pre-existing:

1. voice-transcription container timeout: Docker Desktop Windows tsx compilation > 120s.
2. Onboarding origin mismatch: .env EXPECTED_ORIGIN=http://127.0.0.1 vs test origin http://localhost.

Both exist on main branch before the confirmation guardrail changes.

## Teardown

All services stopped cleanly. All 11 containers and both networks removed. No orphaned resources.

## Verdict Rationale

PASS -- The confirmation guardrail implementation is verified:

1. CI Pipeline: All 4 steps pass (confirmed on CI Linux via GitHub Actions).
2. Unit Tests: 48 new tests pass covering all confirmation guardrail behaviors.
3. Smoke Tests: 104/110 pass. 6 failures are pre-existing and unrelated.
4. Custom Checks: All 6 confirmation guardrail-specific checks pass.
5. Database: pending_tool_call JSONB column correctly created via auto-migration.
