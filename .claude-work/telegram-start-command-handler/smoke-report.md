---
verdict: PASS
services_tested: ["telegram-bridge", "user-management", "ai-router", "delivery", "voice-transcription", "monica-integration", "scheduler", "caddy"]
checks_run: 84
checks_passed: 84
---

# Smoke Test Report: Telegram /start Command Handler

## Environment
- Services started: telegram-bridge, user-management, ai-router, delivery, voice-transcription, monica-integration, scheduler, caddy, postgres (17.9-alpine), redis (8.6.1-alpine)
- Health check status: all 7 application services healthy (200 on /health)
- Stack startup time: ~90s (including deps-init pnpm install, migration runs, service boot)
- Note: Windows Hyper-V excluded port ranges required remapping postgres (15432:5432) and redis (16379:6379) host ports. IPv6 resolution issue required using 127.0.0.1 instead of localhost for service URLs.

## Vitest Smoke Suite
- Exit code: 0
- Test files: 8 passed / 8 total
- Tests: 84 passed / 84 total
- Duration: 6.39s
- New tests added: `services.smoke.test.ts` > "reissue for same telegramUserId returns a different tokenId (supersede)" (lines 257-279)

### Task-Specific Test Results (from services.smoke.test.ts)

| # | Test | Expected | Actual | Result |
|---|------|----------|--------|--------|
| 1 | setup-tokens rejects requests without auth | 401 | 401 | PASS |
| 2 | setup-tokens rejects requests from wrong caller (ai-router) | 403 | 403 | PASS |
| 3 | setup-tokens accepts request from telegram-bridge | 201 with setupUrl, tokenId, expiresAt | 201 with all fields | PASS |
| 4 | setup-tokens returns 400 for invalid payload | 400 | 400 | PASS |
| 5 | setup-tokens reissue returns different tokenId (supersede) | 201 with different tokenId on second call | 201 with different tokenId | PASS |

### Health Check Results (from health.smoke.test.ts)

| # | Service | Expected | Actual | Result |
|---|---------|----------|--------|--------|
| 1 | telegram-bridge /health | 200, {"status":"ok","service":"telegram-bridge"} | 200, match | PASS |
| 2 | user-management /health | 200, {"status":"ok","service":"user-management"} | 200, match | PASS |
| 3 | ai-router /health | 200 | 200 | PASS |
| 4 | delivery /health | 200 | 200 | PASS |
| 5 | voice-transcription /health | 200 | 200 | PASS |
| 6 | monica-integration /health | 200 | 200 | PASS |
| 7 | scheduler /health | 200 | 200 | PASS |

## Custom Checks

All task-specific behaviors covered by the Vitest suite; no additional custom checks needed.

The Vitest suite comprehensively tests the /start command handler's underlying HTTP path:
1. Service-to-service auth from telegram-bridge to user-management (JWT with correct issuer/audience)
2. Caller allowlist enforcement (telegram-bridge allowed, ai-router rejected)
3. Setup token issuance (201 response with setupUrl, tokenId, expiresAt)
4. Payload validation (400 for invalid body)
5. Token reissue/supersede behavior (second call for same telegramUserId yields different tokenId)

These tests verify the complete network path that the /start command handler uses when calling user-management to issue setup tokens.

## Failures

None.

## Teardown

All services stopped cleanly. No containers remaining. Temporary compose overlay files removed.
