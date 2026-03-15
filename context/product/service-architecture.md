# Service Architecture: Monica Companion

Total: **16 containers** — 8 application + 3 infrastructure + 5 observability.

---

## Application Services

| Service | Container Name | Role |
|---|---|---|
| **telegram-bridge** | `telegram-bridge` | grammY bot — receives text/voice messages via webhook, detects content type, routes voice to voice-transcription service, forwards transcribed/text messages to ai-router. Sends responses and inline keyboards back to users. Private-chat-only policy enforced here (rejects group messages). Shows typing indicators while AI is processing. |
| **ai-router** | `ai-router` | LangGraph TS — parses natural language intents, disambiguates contacts, serializes structured command payloads, manages conversation context. Multi-language from day one. Does NOT execute commands — all structured payloads are enqueued to scheduler for execution. |
| **voice-transcription** | `voice-transcription` | Dedicated service wrapping OpenAI Whisper API. Receives audio from any connector, returns transcribed text. Connector-agnostic — reusable by future Matrix/Discord connectors. Multi-language transcription. |
| **scheduler** | `scheduler` | BullMQ workers — the single execution path for ALL commands (both real-time interactive and scheduled cron jobs). Receives structured command payloads from ai-router, executes them against MonicaHQ via monica-api-lib, routes results to delivery service. Retry with exponential backoff, idempotency enforcement, dead-letter handling. |
| **delivery** | `delivery` | Outbound message delivery service. Receives formatted responses/results from scheduler and routes them to the correct connector (Telegram in v1, future Matrix/Discord). Decouples message generation from delivery. Handles connector-specific formatting (inline keyboards, markdown, etc.). |
| **user-management** | `user-management` | User registration, MonicaHQ credential storage (AES-256), per-user config (instance URL, API key, language, confirmation mode). Exposes API for web-ui. |
| **web-ui** | `web-ui` | Astro app — v1: onboarding page for MonicaHQ credential entry and preference configuration (linked via Telegram deep link). Future: full management dashboard with per-user settings, activity logs, login. |

### Shared Concerns (cross-cutting, implemented as shared packages)

| Concern | Package | Scope |
|---|---|---|
| **Idempotency / Dedupe** | `@monica-companion/idempotency` | Prevents duplicate command execution from Telegram retries or message replays. Dedup keys stored in PostgreSQL or Redis. Applied at scheduler ingress. |
| **Log Redaction** | `@monica-companion/redaction` | Sanitizes sensitive data (API keys, personal contact info, credentials) from all structured logs before they reach the observability stack. Applied at the Pino/OTel logging layer. |
| **Security / Auth** | `@monica-companion/auth` | JWT signing/verification for inter-service communication. User identity propagation across service boundaries. |

---

## Infrastructure Services

| Service | Container Name | Role |
|---|---|---|
| **PostgreSQL** | `postgres` | Primary database — user accounts, configurations, conversation history, command logs, idempotency keys. Credentials encrypted at rest (AES-256). |
| **Redis** | `redis` | BullMQ backing store for job queues and cron scheduling. Optional caching for MonicaHQ API responses. |
| **Caddy** | `caddy` | Reverse proxy — automatic HTTPS via Let's Encrypt, TLS termination. Routes to Telegram webhook endpoint, web-ui, and service health endpoints. |

## Observability Stack

| Service | Container Name | Role |
|---|---|---|
| **OTel Collector** | `otel-collector` | Receives logs, metrics, and traces from all application services via OpenTelemetry SDK. Routes telemetry to Loki, Prometheus, and Tempo. |
| **Grafana** | `grafana` | Unified dashboards for logs, metrics, and traces. Pre-built dashboards for service health, error rates, API latency, and job queue status. |
| **Loki** | `loki` | Log backend — receives structured JSON logs (with sensitive data redacted) from OTel Collector. |
| **Prometheus** | `prometheus` | Metrics backend — scrapes metrics exported by OTel Collector. |
| **Tempo** | `tempo` | Trace backend — receives distributed traces from OTel Collector. |

---

## Service Communication

```
User (Telegram)
    │
    ▼
┌──────────┐   webhook    ┌──────────────────┐
│  Caddy   │─────────────▶│  telegram-bridge  │
└──────────┘              └────────┬─────────┘
                                   │
                      ┌────────────┼────────────┐
                      │ voice      │ text       │
                      ▼            ▼            │
            ┌───────────────┐                   │
            │ voice-        │                   │
            │ transcription │──── text ─────────┤
            └───────────────┘                   │
                                                ▼
                                        ┌──────────────┐
                                        │  ai-router   │
                                        └──────┬───────┘
                                               │ structured
                                               │ command payload
                                               ▼
                                        ┌──────────────┐     ┌─────────────────┐
                                        │  scheduler   │────▶│  MonicaHQ API   │
                                        └──────┬───────┘     └─────────────────┘
                                               │ result
                                               ▼
                                        ┌──────────────┐
                                        │  delivery    │
                                        └──────┬───────┘
                                               │
                                               ▼
                                      Telegram / future connectors
```

- **Inter-service:** HTTP/REST with signed JWT tokens for user context propagation.
- **Command execution:** ALL commands (real-time and scheduled) flow through `scheduler` via BullMQ. This provides a uniform execution path with built-in retry, idempotency, and error handling.
- **Outbound delivery:** `scheduler` sends results to `delivery`, which formats and routes to the originating connector.
- **External ingress:** Caddy terminates TLS and routes to `telegram-bridge` (webhook), `web-ui` (HTTPS).
- **Telemetry:** All application services export to `otel-collector` via OTLP protocol.
- **Health checks:** Every application service exposes a `/health` endpoint for readiness/liveness probes. Docker Compose health checks and Caddy can use these.
