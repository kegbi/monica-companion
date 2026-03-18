# System Architecture Overview: Monica Companion

> Status: Planned target architecture. As of 2026-03-15 the repository contains documentation only; the pnpm workspace, service packages, Docker Compose stack, and GitHub Actions workflows described below are target-state artifacts, not committed implementation.

---

## 0. Repository State

### Current Repository State

- The repository currently contains product, review, and rules documentation.
- No pnpm workspace, service packages, Docker Compose file, or GitHub Actions workflows are committed yet.

### Target Repository State

- A pnpm monorepo with shared packages and the logical service boundaries described below.
- An initial Telegram-only V1 deployment profile with 8 application containers: `telegram-bridge`, `ai-router`, `voice-transcription`, `monica-integration`, `scheduler`, `delivery`, `user-management`, and `web-ui`.
- The service boundaries are deployed separately from the start in V1. See `context/spec/adr-v1-deployment-profile.md`.

---

## 1. Application & Technology Stack

- **Language & Runtime:** TypeScript on Node.js
- **Package Manager:** pnpm with workspaces for the monorepo
- **Target Monorepo Structure:** Shared packages (`types`, `utils`, `monica-api-lib`, `auth`, `idempotency`, `redaction`) plus logical service packages (`ai-router`, `telegram-bridge`, `voice-transcription`, `monica-integration`, `scheduler`, `delivery`, `user-management`, `web-ui`). The initial V1 deployment profile uses 8 application containers, one per service boundary.
- **AI Framework:** LangGraph TS orchestrates LLM-powered command routing, disambiguation flows, and multi-turn conversation management.
- **LLM Provider:** OpenAI `gpt-5.4-mini` (400K context, structured outputs, reasoning tokens) handles intent parsing and command extraction with medium reasoning effort. V1 uses a shared operator-provided API key with per-user request-size limits, concurrency caps, budget alarms, and an operator kill switch.
- **Speech-to-Text Boundary:** OpenAI `gpt-4o-transcribe` (default) or `whisper-1` (legacy fallback) transcribes voice messages in any supported language through a dedicated connector-neutral `voice-transcription` service using the `/v1/audio/transcriptions` endpoint with `json` response format. The contract is binary upload or short-lived fetch URL plus media metadata.
- **Outbound Delivery Boundary:** Connector-neutral `delivery` routes outbound message intents to the correct connector while keeping platform formatting in the connector.
- **Telegram Bot Framework:** grammY
- **Validation & Schemas:** Zod runtime validation for API contracts, command payloads, and configuration
- **Build Tooling:** `tsx` for development and `tsup` for production builds

---

## 2. Data & Persistence

- **Primary Database:** PostgreSQL stores user accounts, setup-token state, configurations, pending commands, conversation turn summaries (in `conversation_turns` table with 30-day retention), command logs, idempotency keys, and delivery audit records.
- **ORM:** Drizzle ORM
- **Job Queue & Caching:** Redis backs BullMQ queues and optional short-lived caches.
- **Job Scheduler:** BullMQ runs confirmed mutating commands and scheduled reminder jobs. Read-only queries stay synchronous in `ai-router`. Scheduler owns job-level retries, backoff ceilings, dead-letter handling, and schedule-window dedupe. Edge clients own only quick transport retries.
- **Credential Storage:** MonicaHQ API keys are encrypted at rest with AES-256 in PostgreSQL. Only `monica-integration` may request decrypted credentials through an audited narrow port exposed by `user-management`.

### 2.1. Data Governance

- **Conversation state:** Persist compressed turn summaries (not raw utterances or full LLM responses) in the `conversation_turns` PostgreSQL table, loaded into LangGraph state on each invocation (default: most recent 10 turns). Pending-command metadata is stored separately. Avoid storing raw Monica payloads or uncompressed LLM responses in persistent AI state.
- **Retention:** Conversation summaries and pending-command records are retained for 30 days after completion. Command logs and delivery audits are retained for 90 days. Traces, logs, and dead-letter payloads are retained for 14 days unless security investigation policy requires a shorter emergency purge.
- **Audio handling:** Voice audio is processed transiently for transcription and is not retained after transcription succeeds or fails, aside from minimal operational metadata.
- **Deletion:** Disconnecting an account revokes setup tokens immediately, deletes Monica credentials immediately, and schedules user-specific conversational/audit data for purge within 30 days, excluding minimal security audit entries required for abuse or incident response.
- **Redaction scope:** The same minimization and redaction policy applies to logs, traces, dead letters, queue payloads, and support tooling.

---

## 3. Infrastructure & Deployment

- **Target Local Runtime:** Docker Compose runs application containers, PostgreSQL, Redis, and the observability stack.
- **Initial V1 Deployment Profile:** 8 application containers plus 3 infrastructure and 5 observability containers. `voice-transcription` and `delivery` remain separate deployables in V1 as documented in `context/spec/adr-v1-deployment-profile.md`.
- **Service Communication:** HTTP/REST over the Docker internal network with signed JWTs, user identity propagation, per-endpoint caller allowlists, and no anonymous access to internal APIs.
- **Secret Rotation:** JWT signing keys and encryption master keys follow a documented rotation schedule.
- **Reverse Proxy:** Caddy terminates TLS and exposes only the Telegram webhook and onboarding web UI. Internal service APIs and `/health` endpoints stay private to the internal network.
- **Target CI/CD:** GitHub Actions runs lint, test, build, and deploy workflows once the code workspace exists.
- **Environment Management:** `.env` files per environment plus Docker secrets for production credentials

### 3.1. Public Ingress Matrix

| Route | Public | Upstream | Required controls |
|---|---|---|---|
| Telegram webhook | Yes | `telegram-bridge` | TLS, required `X-Telegram-Bot-Api-Secret-Token`, request body size limit, ingress rate limiting, private-chat-only enforcement |
| Onboarding UI (`/setup/...`) | Yes | `web-ui` | TLS, signed 15-minute one-time setup token, one-active-token-per-user invalidation rules, CSRF/origin checks, form rate limiting, audit logging |
| Internal service APIs | No | Internal services only | Internal network only, signed JWT, per-endpoint caller allowlists |
| `/health` endpoints | No | Each application service | Docker/internal probes only; not routed publicly |

---

## 4. External Services & APIs

- **MonicaHQ v4 API:** Accessed only through `monica-integration`, which wraps `monica-api-lib`. The service normalizes Monica base URLs, requires canonical HTTPS by default, rejects loopback/RFC1918/link-local/blocked redirect targets after DNS resolution, and exposes a Monica-agnostic internal contract to other services. The detailed endpoint contract remains in `context/product/monica-api-scope.md`.
- **OpenAI API:** `gpt-5.4-mini` (structured outputs, medium reasoning) handles intent parsing and command extraction; `gpt-4o-transcribe` (default) or `whisper-1` (fallback) handles voice transcription. If budget or quota is exhausted, the system raises alerts, stops new mutating AI work via operator kill switch, and returns a degraded user-facing failure message instead of silent timeouts.
- **Telegram Bot API:** grammY webhook mode receives text, voice, and inline-keyboard interactions. `telegram-bridge` requires the configured `X-Telegram-Bot-Api-Secret-Token`, enforces request-size/rate limits, and converts connector-specific events into internal command or reply envelopes.
- **Delivery Boundary:** Receives connector-neutral message intents from `ai-router` and `scheduler`, resolves the target connector, and forwards the payload. Connector services own platform-specific formatting and transport calls.
- **Web UI:** Astro serves the onboarding page. Setup access uses 15-minute one-time signed tokens bound to Telegram user identity and step. Only one active setup token exists per Telegram user; reissuing invalidates the previous token. Form submissions go to `user-management` over HTTPS with CSRF/origin protection and replay-safe token consumption.

---

## 5. Observability & Monitoring

- **Instrumentation:** OpenTelemetry SDK across all services
- **Log Backend:** Grafana Loki
- **Metrics Backend:** Prometheus
- **Trace Backend:** Grafana Tempo
- **Dashboards:** Grafana dashboards cover service health, error rates, API latency, queue status, OpenAI budget burn, and reminder misfires.
- **OTel Collector:** Receives telemetry from all services and routes it to Loki, Prometheus, and Tempo.
- **Health Checks:** Every application service exposes an internal-only `/health` endpoint used by Docker readiness/liveness probes.
- **Auditability:** Every user-facing command and delivery event carries a correlation ID spanning ingress, AI routing, scheduler execution, Monica calls, and outbound delivery.
- **Redaction:** Sensitive data is sanitized before export to the observability stack.

---

## 6. Testing & Code Quality

- **Test Framework:** Vitest
- **CI Test Strategy:** Unit tests per service, integration tests against real PostgreSQL and Redis, mocked Monica contract tests using fixtures aligned to `context/product/monica-api-scope.md`, end-to-end tests for critical user journeys, and LLM smoke tests covering command parsing, multi-stage dialog flows, context preservation, and out-of-scope rejection scenarios.
- **Controlled Real-Monica Verification:** Real Monica smoke tests run only in a gated environment outside normal CI, such as nightly or a release-candidate workflow. Production release requires the latest smoke run to pass.
- **Linter & Formatter:** Biome
- **Pre-commit Hooks:** Husky plus lint-staged
