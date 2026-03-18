---
verdict: PASS
services_tested: ["telegram-bridge", "user-management", "voice-transcription", "ai-router", "delivery", "caddy"]
checks_run: 13
checks_passed: 13
---

# Smoke Test Report: Telegram Bridge

## Environment
- Services started: caddy (2.11.2-alpine), telegram-bridge (node:24.14.0-slim), user-management (node:24.14.0-slim), voice-transcription (node:24.14.0-slim), ai-router (node:24.14.0-slim), delivery (node:24.14.0-slim), postgres (17.9-alpine), redis (8.6.1-alpine)
- Health check status: all healthy
- Stack startup time: ~80 seconds (including deps-init pnpm install)

## Infrastructure Notes

Two issues required workarounds during smoke testing:

1. **Cross-platform lockfile**: The pnpm lockfile was generated on Windows and contains `@rollup/rollup-win32-x64-msvc` which fails to install on Linux containers. A `docker-compose.override.yml` was used to pass `--force` to `pnpm install` in the `deps-init` container.

2. **Empty string env vars vs Zod optional**: Docker Compose `${VAR:-}` syntax sets environment variables to empty strings rather than leaving them undefined. The `ENCRYPTION_MASTER_KEY_PREVIOUS` config field uses `z.string().min(32).optional()`, which rejects empty strings (Zod `optional()` only permits `undefined`, not `""`). The user-management service crashed silently at startup due to this validation failure. Workaround: provide valid values for all `*_PREVIOUS` env vars. This is a pre-existing infra concern, not a Telegram Bridge issue.

## Checks

| # | Check | Expected | Actual | Result |
|---|-------|----------|--------|--------|
| 1 | telegram-bridge GET /health (internal, via node fetch inside container) | 200 `{"status":"ok","service":"telegram-bridge"}` | 200 `{"status":"ok","service":"telegram-bridge"}` | PASS |
| 2 | POST /webhook/telegram through Caddy with valid `X-Telegram-Bot-Api-Secret-Token` (private chat text message) | 200 | 200 `{"ok":true}` with rate limit headers | PASS |
| 3 | POST /webhook/telegram through Caddy without secret header | 401 | 401 `{"error":"Unauthorized"}` | PASS |
| 4 | POST /webhook/telegram through Caddy with valid secret but group chat message | 200 (accepted, silently dropped) | 200 `{"ok":true}` | PASS |
| 5 | POST /internal/send on telegram-bridge without Authorization header | 401 | 401 `{"error":"Missing or invalid Authorization header"}` | PASS |
| 6 | GET /internal/users/by-connector/telegram/nonexistent on user-management with valid telegram-bridge JWT | 200 `{"found":false}` | 200 `{"found":false}` | PASS |
| 7 | delivery GET /health (internal) | 200 `{"status":"ok","service":"delivery"}` | 200 `{"status":"ok","service":"delivery"}` | PASS |
| 8 | voice-transcription GET /health (internal) | 200 `{"status":"ok","service":"voice-transcription"}` | 200 `{"status":"ok","service":"voice-transcription"}` | PASS |
| 9 | GET /health through Caddy (not exposed) | 404 | 404 | PASS |
| 10 | GET /internal/send through Caddy (not exposed) | 404 | 404 | PASS |
| 11 | POST /webhook/telegram through Caddy with wrong secret | 401 | 401 | PASS |
| 12 | GET /internal/users/by-connector/telegram/12345 with JWT issued by `delivery` (not in allowedCallers) | 403 | 403 `{"error":"Caller not allowed"}` | PASS |
| 13 | Rate limit headers present on webhook response | X-Ratelimit-Limit, X-Ratelimit-Remaining, X-Ratelimit-Reset | All three headers present (Limit: 60, Remaining: 58, Reset: timestamp) | PASS |

## Failures

None.

## Teardown

All services stopped cleanly via `docker compose --profile app down`. Temporary `.env` and `docker-compose.override.yml` files were removed after testing.
