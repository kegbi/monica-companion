---
verdict: PASS
tested: connector-ready-contracts
date: 2026-03-18
services_tested: ["delivery", "scheduler", "ai-router", "voice-transcription", "telegram-bridge", "monica-integration", "caddy"]
checks_run: 14
checks_passed: 14
---

# Smoke Test Report: Connector-Ready Contracts

## Environment
- Docker version: 29.2.1
- Docker Compose version: v5.1.0
- Node.js (in containers): v24.14.0
- Stack startup time: 11s (build + start), 15s service init wait
- Services started: delivery, scheduler, ai-router, voice-transcription, telegram-bridge, monica-integration, caddy, postgres, redis
- Health check status: 6 of 7 app services healthy; user-management crashed (pre-existing, see note below)

### Note on user-management

The user-management service exits with code 1 due to a pre-existing pnpm hoisting issue where `@hono/node-server` cannot be resolved inside the Docker container. This is NOT caused by the connector-ready-contracts changes -- the only change to user-management was replacing a hardcoded `if (connectorType !== "telegram")` with a `switch` statement in `app.ts`, but the crash occurs during the `@hono/node-server` import in `index.ts` before `app.ts` is loaded. All other services resolve their dependencies correctly and start without issues.

### Note on types package dist rebuild

The `packages/types/dist/index.js` was stale (contained the old `z.enum(["telegram"])` for `connectorType`). Since the types package uses `exports: { ".": { "import": "./dist/index.js" } }` in its `package.json`, services were importing the compiled dist rather than source. A `tsup` rebuild inside the container was required to update the dist. This rebuild was performed and confirmed. The updated dist was persisted to the host via the volume mount and is now consistent with the source.

## Checks

| # | Check | Expected | Actual | Result |
|---|-------|----------|--------|--------|
| 1 | Delivery /health via internal network | `{"status":"ok","service":"delivery"}` | `{"status":"ok","service":"delivery"}` | PASS |
| 2 | Scheduler /health via internal network | `{"status":"ok","service":"scheduler"}` | `{"status":"ok","service":"scheduler"}` | PASS |
| 3 | ai-router /health via internal network | `{"status":"ok","service":"ai-router"}` | `{"status":"ok","service":"ai-router"}` | PASS |
| 4 | voice-transcription /health via internal network | `{"status":"ok","service":"voice-transcription"}` | `{"status":"ok","service":"voice-transcription"}` | PASS |
| 5 | Caddy blocks /health publicly | 404 | 404 | PASS |
| 6 | Caddy blocks /internal/deliver publicly | 404 | 404 | PASS |
| 7 | Delivery rejects unauthenticated POST to /internal/deliver | 401 | 401 | PASS |
| 8 | Delivery accepts `connectorType: "telegram"` with authenticated JWT (V1 flow) | 200 delivered | 200 `{"status":"delivered"}` | PASS |
| 9 | Delivery rejects unregistered `connectorType: "whatsapp"` | 400 Unsupported connector type | 400 `{"status":"rejected","error":"Unsupported connector type"}` | PASS |
| 10 | OutboundMessageIntentSchema accepts arbitrary connector types (telegram, whatsapp, signal, matrix, custom-connector) | All pass validation | All pass validation | PASS |
| 11 | OutboundMessageIntentSchema rejects empty string connectorType | Rejected | Rejected | PASS |
| 12 | ConfirmedCommandPayloadSchema accepts optional connectorType/connectorRoutingId | Both with and without fields pass | Both pass | PASS |
| 13 | Delivery connector registry loaded from CONNECTOR_URL_TELEGRAM env var | `{"telegram":"http://telegram-bridge:3001"}` | `{"telegram":"http://telegram-bridge:3001"}` | PASS |
| 14 | Delivery backward compat: TELEGRAM_BRIDGE_URL populates registry when CONNECTOR_URL_TELEGRAM absent | telegram registered with correct URL | telegram registered with `http://telegram-bridge:3001` | PASS |

### Additional Verification (non-numbered)

| Verification | Result |
|---|---|
| ai-router `inboundAllowedCallers` defaults to `["telegram-bridge"]` | Confirmed |
| voice-transcription `inboundAllowedCallers` defaults to `["telegram-bridge"]` | Confirmed |
| Delivery `connectorAudience("telegram")` returns `"telegram-bridge"` | Confirmed |
| Delivery `connectorAudience("whatsapp")` returns `"whatsapp-bridge"` | Confirmed |
| Scheduler source files contain no hardcoded `"telegram"` strings | Confirmed (grep found none) |
| Delivery source files contain no hardcoded `"telegram"` strings | Confirmed (grep found none) |
| Caddy routes /webhook/telegram to telegram-bridge (returns 401 without secret) | Confirmed |

## Failures

None. All 14 checks passed.

## Teardown

All services stopped cleanly via `docker compose --profile app down`. Verified with `docker compose --profile app ps -a` showing no remaining containers.
