# Service Architecture: Monica Companion

Total: **17 containers** — 9 application + 3 infrastructure + 5 observability.

---

## Application Services

### telegram-bridge

**Container:** `telegram-bridge`

**Purpose:** Connect to Telegram, accept user input, and return replies. All Telegram-specific behavior is isolated here.

**Why separate:** Telegram-specific concerns (API, message formats, inline keyboards) should not leak into business logic. Makes it easy to add other channels later without touching core services.

**Responsibilities:**
- Private-chat-only policy — reject or leave group chats.
- Receive text and voice messages via Telegram webhook (through Caddy).
- Detect content type — route voice to voice-transcription service, forward text directly to ai-router.
- Show typing indicators while AI processes.
- Own all Telegram-specific formatting — render inline keyboards for confirmations/disambiguation, markdown for responses, error messages.
- Receive structured outbound payloads from delivery service and format them for Telegram before sending.
- Return clear user guidance when input cannot be parsed.
- Forward voice audio references to voice-transcription service and await text result.

**Allowed callers:** Caddy (inbound webhook), delivery service (outbound messages).

---

### ai-router

**Container:** `ai-router`

**Purpose:** Handle natural language understanding, contact resolution, and command intent parsing. Central place for AI logic, conversation context, and disambiguation flows.

**Why separate:** Keeps AI/NLU behavior independent from Telegram APIs and Monica APIs. Can evolve AI capabilities without touching connectors or data layers.

**Responsibilities:**
- Parse free-form text (from voice transcription or direct text) into structured command intents using LangGraph TS + OpenAI GPT.
- Multi-language support from day one — detect language and process accordingly.
- Smart contact disambiguation — present options when ambiguous, skip when unambiguous.
- Manage conversation context — resolve references like "add a note to her" based on previous messages.
- Serialize parsed intents into structured command payloads (Zod-validated).
- Enqueue ALL command payloads to scheduler via BullMQ — ai-router does NOT execute commands directly.
- Build user-facing response text and disambiguation prompts.

**Allowed callers:** telegram-bridge (and future connectors).

---

### voice-transcription

**Container:** `voice-transcription`

**Purpose:** Convert audio messages into text that the AI router can process.

**Why separate:** Speech handling is a distinct concern with its own reliability and cost profile. Can be swapped between providers (Whisper, Deepgram, etc.) without touching any other service. Connector-agnostic — reusable by future Matrix/Discord connectors.

**Responsibilities:**
- Accept audio file reference from any connector.
- Transcribe via OpenAI Whisper API. Multi-language transcription supported natively.
- Return transcribed text.
- Return clear user-facing error messages if transcription fails (audio too short, unsupported format, API error).
- Timeout handling for Whisper API calls.

**Allowed callers:** telegram-bridge (and future connectors).

---

### monica-integration

**Container:** `monica-integration`

**Purpose:** Act as a clean gateway to Monica v4 API. All Monica-specific complexity is isolated here.

**Why separate:** External API complexity (retries, timeouts, pagination, payload validation, version differences) should be isolated. Easier to change Monica usage, swap versions, or adapt to API changes without affecting scheduler or ai-router.

**Responsibilities:**
- Perform contact, reminder, note, and activity operations against MonicaHQ v4 API.
- Handle reliability concerns: timeout handling on all Monica API calls, retry with exponential backoff for transient failures, safe pagination for large datasets.
- Standardize and validate inbound/outbound payloads (Zod schemas matching Monica v4 API contracts).
- Support multiple MonicaHQ instances — resolve the correct base URL and API key per user (via user-management service).
- Uses `monica-api-lib` shared package for typed API client, but owns the operational layer (retries, pagination, error mapping).
- Architecture accommodates future multi-version support (different API payload types per Monica version).

**Allowed callers:** scheduler only.

---

### scheduler

**Container:** `scheduler`

**Purpose:** Unified execution engine for ALL commands — both real-time interactive and scheduled cron jobs. Provides a single execution path with built-in retry, idempotency, and error handling.

**Why separate:** Scheduled work should be reliable even when bot traffic is low/high. Uniform execution path gives consistent retry, idempotency, and audit behavior regardless of whether the command came from a user message or a cron trigger.

**Responsibilities:**
- Receive structured command payloads from ai-router (real-time) and from cron triggers (scheduled).
- Execute commands against MonicaHQ via monica-integration service.
- Retry failed commands with exponential backoff.
- Enforce idempotency at ingress — prevent duplicate execution from Telegram retries or message replays.
- Run daily/weekly reminder digest cron jobs per user.
- Prevent duplicate sends for the same schedule window.
- Route results to delivery service for outbound formatting and sending.
- Track job status, timing, and failure reasons — expose job run history via observability.
- Dead-letter handling for permanently failed jobs.

**Allowed callers:** ai-router (enqueue commands), internal cron triggers.

---

### delivery

**Container:** `delivery`

**Purpose:** Route structured outbound message payloads to the correct connector. Connector-agnostic — knows nothing about Telegram-specific formatting.

**Why separate:** Keeps scheduler and ai-router simpler and easier to test. Isolates sending failures from command processing. Provides a single outbound routing layer that future connectors (Matrix, Discord) plug into.

**Responsibilities:**
- Receive structured result payloads from scheduler.
- Resolve which connector the message should be routed to (based on where the original request came from).
- Forward the structured payload to the correct connector (telegram-bridge in v1).
- The connector is responsible for platform-specific formatting (inline keyboards, markdown, etc.).
- Deliver error notification payloads when command retries are exhausted.
- Maintain delivery audit records (what was sent, when, to whom, which connector, success/failure).

**Allowed callers:** scheduler only.

---

### user-management

**Container:** `user-management`

**Purpose:** Manage user accounts, credentials, and per-user configuration. Central source of truth for who the users are and how they connect to MonicaHQ.

**Why separate:** Credential management and user config are a distinct security boundary. Other services query user-management to resolve user context.

**Responsibilities:**
- User registration and account creation.
- Store MonicaHQ instance URL + API key per user (AES-256 encrypted at rest).
- Store per-user preferences: language, confirmation mode, reminder schedule.
- Link Telegram accounts to Monica Companion user accounts.
- Expose API for web-ui (onboarding form submission).
- Expose API for other services to resolve user context (credentials, config).

**Allowed callers:** web-ui, telegram-bridge, scheduler, monica-integration, ai-router.

---

### web-ui

**Container:** `web-ui`

**Purpose:** Serve the web-based onboarding page and (in future versions) a full management dashboard.

**Why separate:** Web frontend concerns should be isolated from backend services. Astro app with its own build/deploy lifecycle.

**Responsibilities:**
- V1: Serve secure onboarding page where users enter MonicaHQ instance URL, API key, preferred language, confirmation mode, and reminder schedule.
- Communicate with user-management service API over HTTPS.
- Telegram bot generates unique deep links to this page per user.
- Future: full management dashboard with per-user settings, activity logs, login/authentication.

**Allowed callers:** End users via browser (through Caddy).

---

## Shared Concerns (cross-cutting, implemented as shared packages)

| Concern | Package | Scope |
|---|---|---|
| **Monica API Client** | `@monica-companion/monica-api-lib` | Typed MonicaHQ v4 API client with Zod-validated request/response contracts. Used by monica-integration service. |
| **Idempotency / Dedupe** | `@monica-companion/idempotency` | Prevents duplicate command execution from Telegram retries or message replays. Dedup keys stored in PostgreSQL or Redis. Applied at scheduler ingress. |
| **Log Redaction** | `@monica-companion/redaction` | Sanitizes sensitive data (API keys, personal contact info, credentials) from all structured logs before they reach the observability stack. Applied at the Pino/OTel logging layer. |
| **Security / Auth** | `@monica-companion/auth` | JWT signing/verification for inter-service communication. User identity propagation across service boundaries. Caller allowlist enforcement — each service only accepts calls from expected callers. |
| **Secret Rotation** | `@monica-companion/auth` | Secret rotation policy for JWT signing keys and encryption master keys. Rotation schedule defined and documented. |

---

## Infrastructure Services

| Service | Container Name | Role |
|---|---|---|
| **PostgreSQL** | `postgres` | Primary database — user accounts, configurations, conversation history, command logs, idempotency keys, delivery audit records. Credentials encrypted at rest (AES-256). |
| **Redis** | `redis` | BullMQ backing store for job queues and cron scheduling. Optional caching for MonicaHQ API responses. |
| **Caddy** | `caddy` | Reverse proxy — automatic HTTPS via Let's Encrypt, TLS termination. Routes to Telegram webhook endpoint, web-ui, and service health endpoints. Only truly client-facing entry points are exposed externally. |

## Observability Stack

| Service | Container Name | Role |
|---|---|---|
| **OTel Collector** | `otel-collector` | Receives logs, metrics, and traces from all application services via OpenTelemetry SDK. Routes telemetry to Loki, Prometheus, and Tempo. |
| **Grafana** | `grafana` | Unified dashboards for logs, metrics, and traces. Pre-built dashboards for service health, error rates, API latency, and job queue status. Alerting rules for repeated failures and high latency. |
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
                                               │ (via BullMQ)
                                               ▼
                                        ┌──────────────┐
                                        │  scheduler   │
                                        └──────┬───────┘
                                               │
                                               ▼
                                     ┌────────────────────┐
                                     │ monica-integration  │
                                     └────────┬───────────┘
                                              │
                                              ▼
                                     ┌─────────────────┐
                                     │  MonicaHQ API   │
                                     └─────────────────┘
                                              │ result
                                              ▼
                                        ┌──────────────┐
                                        │  delivery    │
                                        └──────┬───────┘
                                               │
                                               ▼
                                      Telegram / future connectors
```

### Communication Rules

- **Inter-service:** HTTP/REST with signed JWT tokens for user context propagation. Services communicate over Docker Compose internal network only.
- **Caller allowlists:** Each service explicitly allows only expected callers. Internal endpoints are closed to anonymous traffic. Security checks enforced per endpoint, not only at the edge.
- **Command execution:** ALL commands (real-time and scheduled) flow through `scheduler` → `monica-integration` → MonicaHQ API. Uniform path with retry, idempotency, and audit.
- **Outbound delivery:** `scheduler` sends results to `delivery`, which formats and routes to the originating connector. Delivery keeps audit records.
- **External ingress:** Caddy terminates TLS and routes to `telegram-bridge` (webhook) and `web-ui` (HTTPS). Only these two entry points are exposed externally.
- **Telemetry:** All application services export to `otel-collector` via OTLP protocol. Logs are redacted before export.
- **Health checks:** Every application service exposes a `/health` endpoint for readiness/liveness probes. Docker Compose health checks use these for dependency ordering and restart policies.
- **Secret rotation:** JWT signing keys and encryption master keys follow a defined rotation schedule.

### Reliability

- All external API calls (MonicaHQ, OpenAI, Telegram) have timeout handling.
- Transient failures are retried with exponential backoff.
- Large Monica datasets are handled with safe pagination.
- Users receive graceful fallback messages when operations fail.
- Strict payload validation (Zod schemas) on all inbound/outbound requests.
