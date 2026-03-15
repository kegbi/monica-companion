# Service Architecture: Monica Companion

Total: **13 containers** — 5 application + 3 infrastructure + 5 observability.

---

## Application Services

| Service | Container Name | Role |
|---|---|---|
| **telegram-bridge** | `telegram-bridge` | grammY bot — receives text/voice messages, transcribes voice via Whisper, routes to ai-router, sends responses/inline keyboards back. Voice is always transcribed and handled as text at every stage. |
| **ai-router** | `ai-router` | LangGraph TS — parses natural language intents, disambiguates contacts, serializes structured command payloads, manages conversation context. Multi-language from day one. |
| **user-management** | `user-management` | User registration, MonicaHQ credential storage (AES-256), per-user config (instance URL, API key, language, confirmation mode). Exposes API for web-ui. |
| **scheduler** | `scheduler` | BullMQ workers — cron job execution (daily/weekly reminders), command dispatch, retry with exponential backoff, Telegram error notification on exhausted retries. |
| **web-ui** | `web-ui` | Astro app — v1: onboarding page for MonicaHQ credential entry and preference configuration (linked via Telegram deep link). Future: full management dashboard with per-user settings, activity logs, login. |

## Infrastructure Services

| Service | Container Name | Role |
|---|---|---|
| **PostgreSQL** | `postgres` | Primary database — user accounts, configurations, conversation history, command logs. Credentials encrypted at rest (AES-256). |
| **Redis** | `redis` | BullMQ backing store for job queues and cron scheduling. Optional caching for MonicaHQ API responses. |
| **Caddy** | `caddy` | Reverse proxy — automatic HTTPS via Let's Encrypt, TLS termination. Routes to Telegram webhook endpoint, web-ui, and internal service APIs. |

## Observability Stack

| Service | Container Name | Role |
|---|---|---|
| **OTel Collector** | `otel-collector` | Receives logs, metrics, and traces from all application services via OpenTelemetry SDK. Routes telemetry to Loki, Prometheus, and Tempo. |
| **Grafana** | `grafana` | Unified dashboards for logs, metrics, and traces. Pre-built dashboards for service health, error rates, API latency, and job queue status. |
| **Loki** | `loki` | Log backend — receives structured JSON logs from OTel Collector. |
| **Prometheus** | `prometheus` | Metrics backend — scrapes metrics exported by OTel Collector. |
| **Tempo** | `tempo` | Trace backend — receives distributed traces from OTel Collector. |

---

## Service Communication

- **Inter-service:** HTTP/REST with signed JWT tokens for user context propagation.
- **External ingress:** Caddy terminates TLS and routes to `telegram-bridge` (webhook), `web-ui` (HTTPS), and internal APIs.
- **Job queue:** `scheduler` consumes jobs from Redis (BullMQ). Other services enqueue jobs (e.g., `ai-router` enqueues a command for execution).
- **Telemetry:** All application services export to `otel-collector` via OTLP protocol.
