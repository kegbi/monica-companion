# System Architecture Overview: Monica Companion

---

## 1. Application & Technology Stack

- **Language & Runtime:** TypeScript on Node.js
- **Package Manager:** pnpm with workspaces for the monorepo
- **Monorepo Structure:** Shared packages (`types`, `utils`, `monica-api-lib`, `auth`, `idempotency`, `redaction`) plus service packages (`ai-router`, `telegram-bridge`, `voice-transcription`, `monica-integration`, `scheduler`, `delivery`, `user-management`, `web-ui`). Each service runs as a separate Docker container (8 app containers total).
- **AI Framework:** LangGraph TS orchestrates LLM-powered command routing, disambiguation flows, and multi-turn conversation management.
- **LLM Provider:** OpenAI GPT models handle NLU and command parsing. V1 uses a shared operator-provided API key with per-user request-size limits, concurrency caps, budget alarms, and an operator kill switch.
- **Speech-to-Text:** OpenAI Whisper API transcribes voice messages in any supported language through a dedicated `voice-transcription` service. The contract is connector-neutral: binary upload or short-lived fetch URL plus media metadata.
- **Telegram Bot Framework:** grammY
- **Validation & Schemas:** Zod runtime validation for API contracts, command payloads, and configuration
- **Build Tooling:** `tsx` for development and `tsup` for production builds

---

## 2. Data & Persistence

- **Primary Database:** PostgreSQL stores user accounts, setup-token state, configurations, pending commands, conversation summaries, command logs, idempotency keys, and delivery audit records.
- **ORM:** Drizzle ORM
- **Job Queue & Caching:** Redis backs BullMQ queues and optional short-lived caches.
- **Job Scheduler:** BullMQ runs confirmed commands and scheduled reminder jobs. Scheduler owns job-level retries, backoff ceilings, dead-letter handling, and schedule-window dedupe. Edge clients own only quick transport retries.
- **Credential Storage:** MonicaHQ API keys are encrypted at rest with AES-256 in PostgreSQL. Only `monica-integration` may request decrypted credentials through an audited narrow port exposed by `user-management`.

### 2.1. Data Governance

- **Conversation state:** Store minimal turn summaries and pending-command metadata needed for multi-turn flows. Avoid storing raw Monica payloads in AI state.
- **Retention:** Conversation summaries and pending-command records are retained for 30 days after completion. Command logs and delivery audits are retained for 90 days. Traces, logs, and dead-letter payloads are retained for 14 days unless security investigation policy requires a shorter emergency purge.
- **Audio handling:** Voice audio is processed transiently for transcription and is not retained after transcription succeeds or fails, aside from minimal operational metadata.
- **Deletion:** Disconnecting an account revokes setup tokens immediately, deletes Monica credentials immediately, and schedules user-specific conversational/audit data for purge within 30 days, excluding minimal security audit entries required for abuse or incident response.
- **Redaction scope:** The same minimization and redaction policy applies to logs, traces, dead letters, queue payloads, and support tooling.

---

## 3. Infrastructure & Deployment

- **Containerization:** Docker Compose runs all services, PostgreSQL, Redis, and the observability stack.
- **Service Communication:** HTTP/REST over the Docker internal network with signed JWTs, user identity propagation, per-endpoint caller allowlists, and no anonymous access to internal APIs.
- **Secret Rotation:** JWT signing keys and encryption master keys follow a documented rotation schedule.
- **Reverse Proxy:** Caddy terminates TLS and exposes only the Telegram webhook and onboarding web UI. Internal service APIs and `/health` endpoints stay private to the internal network.
- **CI/CD:** GitHub Actions runs lint, test, build, and deploy workflows.
- **Environment Management:** `.env` files per environment plus Docker secrets for production credentials

### 3.1. Public Ingress Matrix

| Route | Public | Upstream | Required controls |
|---|---|---|---|
| Telegram webhook | Yes | `telegram-bridge` | TLS, Telegram secret-token verification, request body size limit, ingress rate limiting, private-chat-only enforcement |
| Onboarding UI (`/setup/...`) | Yes | `web-ui` | TLS, signed one-time setup token, CSRF/origin checks, form rate limiting, audit logging |
| Internal service APIs | No | Internal services only | Internal network only, signed JWT, per-endpoint caller allowlists |
| `/health` endpoints | No | Each application service | Docker/internal probes only; not routed publicly |

---

## 4. External Services & APIs

- **MonicaHQ v4 API:** Accessed only through `monica-integration`, which wraps `monica-api-lib`. The service normalizes Monica base URLs, requires canonical HTTPS by default, rejects loopback/RFC1918/link-local/blocked redirect targets after DNS resolution, and exposes a Monica-agnostic internal contract to other services. The detailed endpoint contract remains in `context/product/monica-api-scope.md`.
- **OpenAI API:** GPT handles intent parsing and Whisper handles transcription. If budget or quota is exhausted, the system raises alerts, stops new mutating AI work via operator kill switch, and returns a degraded user-facing failure message instead of silent timeouts.
- **Telegram Bot API:** grammY webhook mode receives text, voice, and inline-keyboard interactions. `telegram-bridge` verifies webhook authenticity, enforces request-size/rate limits, and converts connector-specific events into internal command or reply envelopes.
- **Delivery Service:** Receives connector-neutral message intents from `ai-router` and `scheduler`, resolves the target connector, and forwards the payload. Connector services own platform-specific formatting and transport calls.
- **Web UI:** Astro serves the onboarding page. Setup access uses short-lived one-time signed tokens bound to Telegram user identity and step. Form submissions go to `user-management` over HTTPS with CSRF/origin protection and replay-safe token consumption.

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
- **CI Test Strategy:** Unit tests per service, integration tests against real PostgreSQL and Redis, mocked Monica contract tests using fixtures aligned to `context/product/monica-api-scope.md`, and end-to-end tests for critical user journeys.
- **Controlled Real-Monica Verification:** Real Monica smoke tests run only in a gated environment outside normal CI, such as nightly or a release-candidate workflow. Production release requires the latest smoke run to pass.
- **Linter & Formatter:** Biome
- **Pre-commit Hooks:** Husky plus lint-staged
