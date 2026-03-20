---
verdict: PASS
services_tested: ["ai-router", "delivery", "scheduler", "user-management", "postgres", "redis", "monica-integration"]
checks_run: 18
checks_passed: 18
---

# Smoke Test Report: End-to-End Pipeline Wiring

## Environment
- Services started: ai-router, delivery, scheduler, user-management, monica-integration, postgres (17.9-alpine), redis (8.6.1-alpine)
- Node.js runtime: node:24.14.0-slim (shared across all services)
- Health check status: all healthy (ai-router :3002, delivery :3006, scheduler :3005, user-management :3007)
- Stack startup time: ~30 seconds (including deps-init, migrations, health polling)

## Smoke Test: `tests/smoke/e2e-pipeline-wiring.mjs`
- Exit code: 0
- Tests: 18 passed / 18 total
- Executed inside: `monica-project-ai-router-1` container (Docker internal network)

## Test Results

| # | Section | Check | Expected | Actual | Result |
|---|---------|-------|----------|--------|--------|
| 1 | Health Checks | ai-router /health | 200 ok | 200 ok | PASS |
| 2 | Health Checks | delivery /health | 200 ok | 200 ok | PASS |
| 3 | Health Checks | scheduler /health | 200 ok | 200 ok | PASS |
| 4 | Health Checks | user-management /health | 200 ok | 200 ok | PASS |
| 5 | Auth Enforcement | rejects missing token | 401 | 401 | PASS |
| 6 | Auth Enforcement | rejects invalid token | 401 | 401 | PASS |
| 7 | Payload Validation | rejects invalid payload (missing required fields) | 400 | 400 | PASS |
| 8 | Payload Validation | rejects non-uuid userId | 400 | 400 | PASS |
| 9 | Graph Invocation | accepts valid text_message and invokes graph | not 400/401 | 200 (type=text) | PASS |
| 10 | Service Connectivity | can reach delivery | 200 | 200 | PASS |
| 11 | Service Connectivity | can reach scheduler | 200 | 200 | PASS |
| 12 | Service Connectivity | can reach user-management | 200 | 200 | PASS |
| 13 | Delivery Routing | delivery-routing endpoint reachable | 200 or 404 | 404 (test user not in DB) | PASS |
| 14 | Delivery Routing | delivery-routing rejects unauthorized caller (web-ui) | 403 | 403 | PASS |
| 15 | Scheduler Execute | scheduler /internal/execute rejects invalid payload | 400 or 422 | 400 | PASS |
| 16 | Callback Action | accepts callback_action event type | not 400/401 | 200 (no active command found) | PASS |
| 17 | Delivery Contract | delivery /internal/deliver accepts valid OutboundMessageIntent | not 400/401/403 | 502 (telegram-bridge unavailable) | PASS |
| 18 | Scheduler Contract | scheduler /internal/execute accepts valid ConfirmedCommandPayload | 202 | 202 (command queued) | PASS |

## What the Tests Prove

### Infrastructure (Checks 1-4, 10-12)
All four application services start, run migrations, and respond to health checks over the Docker internal network. Service-to-service DNS resolution works (delivery, scheduler, user-management reachable from ai-router).

### Security (Checks 5-6, 14)
- JWT authentication is enforced on internal endpoints: missing and invalid tokens are rejected with 401.
- Per-endpoint caller allowlists are enforced: the delivery-routing endpoint on user-management correctly rejects calls from `web-ui` (403) while accepting calls from `ai-router` (check 13).

### Payload Validation (Checks 7-8, 15)
Zod schema validation is active on all inbound contracts:
- ai-router rejects payloads missing required fields (400) and non-UUID userId values (400).
- scheduler rejects invalid payloads (400).

### End-to-End Pipeline (Checks 9, 16-18)
- **Graph invocation**: A valid text message is processed through the full LangGraph pipeline and returns a typed response (type=text). The graph completes without errors even with a fake OpenAI key (the greeting classifier has a fallback path).
- **Callback handling**: Callback actions are dispatched through the graph and return a proper response ("No active command found" is expected since there is no pending command for the test user).
- **Delivery contract (Section 9)**: The delivery service accepts a valid `OutboundMessageIntent` with proper JWT auth (issuer: ai-router, audience: delivery). The 502 status is expected because telegram-bridge is not started; the key verification is that the payload was not rejected by auth (401/403) or validation (400).
- **Scheduler contract (Section 10)**: The scheduler service accepts a valid `ConfirmedCommandPayload` with proper JWT auth (issuer: ai-router, audience: scheduler) and returns 202, proving the command was queued to BullMQ for execution.

### Custom Checks
All task-specific behaviors are covered by the smoke test suite (Sections 1-10). The two new sections added for this task (Sections 9 and 10) specifically validate the delivery and scheduler contract acceptance that was not previously tested. No additional custom checks are needed.

## Failures
None.

## Teardown
All services stopped cleanly. Network `monica-project_internal` removed. No orphaned containers.
