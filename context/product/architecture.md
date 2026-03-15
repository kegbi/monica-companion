# System Architecture Overview: Monica Companion

---

## 1. Application & Technology Stack

- **Language & Runtime:** TypeScript on Node.js
- **Package Manager:** pnpm (with workspaces for monorepo)
- **Monorepo Structure:** pnpm workspaces — shared packages (`types`, `utils`, `monica-api-lib`) + service packages (`ai-router`, `telegram-bridge`, `user-management`, `scheduler`, `setup-frontend`). Each service runs as a separate Docker container.
- **AI Framework:** LangGraph TS — orchestrates LLM-powered command routing, disambiguation flows, and multi-turn conversation management
- **LLM Provider:** OpenAI — GPT models for natural language understanding and command parsing. Shared operator-provided API key (no per-user keys in v1). Multi-language support from day one.
- **Speech-to-Text:** OpenAI Whisper API — transcribes voice messages to text in any language
- **Telegram Bot Framework:** grammY — TypeScript-first, modern middleware architecture, excellent plugin ecosystem
- **Validation & Schemas:** Zod — runtime schema validation for API contracts, command payloads, and configuration. Shared Zod schemas across services for type-safe communication
- **Build Tool:** tsx for development (fast TS execution, no build step), tsup (esbuild-based bundler) for production Docker builds

---

## 2. Data & Persistence

- **Primary Database:** PostgreSQL (self-hosted via Docker Compose) — stores user accounts, configurations, conversation history, command logs
- **ORM:** Drizzle ORM — TypeScript-first, SQL-like query syntax, built-in migration system. Schemas defined in shared package for cross-service consistency
- **Job Queue & Caching:** Redis (Docker Compose) — backing store for BullMQ job queues, optional caching for MonicaHQ API responses
- **Job Scheduler:** BullMQ — production-grade job queue with cron scheduling (daily/weekly reminders), automatic retries with exponential backoff, priority queues, dead-letter handling
- **Credential Storage:** AES-256 encryption at rest in PostgreSQL — MonicaHQ API keys encrypted using a master key sourced from environment variables

---

## 3. Infrastructure & Deployment

- **Containerization:** Docker Compose — all services, PostgreSQL, Redis, and observability stack run as containers
- **Service Communication:** HTTP/REST with internal APIs — user context propagated via signed JWT tokens between services
- **Reverse Proxy:** Caddy — automatic HTTPS with Let's Encrypt, zero-config TLS termination. Routes to Telegram webhook endpoint, setup frontend, and internal service APIs
- **CI/CD:** GitHub Actions — lint, test, build, and deploy on push. Automated verification pipeline from day one
- **Environment Management:** `.env` files per environment, Docker secrets for production credentials

---

## 4. External Services & APIs

- **MonicaHQ v4 API:** REST API — typed client library built in-house (`monica-api-lib` shared package) with support for multiple API keys and base URLs per user (self-hosted instances or app.monicahq.com). Architecture should accommodate future multi-version support (different API payload types/commands per version)
- **OpenAI API:** Chat completions (GPT) for NLU/command routing + Whisper API for speech-to-text
- **Telegram Bot API:** Via grammY framework — webhook or long-polling mode, handles text messages, voice messages, and inline keyboards for confirmations and disambiguation. The bridge detects content type and always transcribes voice to text before processing — voice is a first-class input at every stage (commands, clarifications, confirmations)
- **Setup Frontend:** Astro framework — serves the web-based onboarding page where users enter MonicaHQ credentials and configure preferences over HTTPS. Communicates with user-management service API. Telegram bot generates unique deep links to this page. Extensible to a full management dashboard (per-user settings, logs, login) in future versions.

---

## 5. Observability & Monitoring

- **Instrumentation:** OpenTelemetry SDK — unified collection of logs, metrics, and traces from all services using `@opentelemetry/sdk-node`
- **Log Backend:** Grafana Loki — receives structured JSON logs from OTel Collector
- **Metrics Backend:** Prometheus — scrapes metrics exported by OTel Collector
- **Trace Backend:** Grafana Tempo — receives distributed traces from OTel Collector
- **Dashboards:** Grafana — unified dashboards for logs, metrics, and traces. Pre-built dashboards for service health, error rates, API latency, and job queue status
- **OTel Collector:** Runs as a Docker Compose service, receives telemetry from all services and routes to Loki/Prometheus/Tempo

---

## 6. Testing & Code Quality

- **Test Framework:** Vitest — fast, native TypeScript/ESM support, Jest-compatible API, built-in coverage reporting
- **Test Strategy:** Unit tests per service, integration tests against real PostgreSQL and Redis (via Docker Compose test profile), e2e tests for critical user journeys (voice → transcribe → command → MonicaHQ)
- **Monica API Integration Tests:** Run against a dedicated MonicaHQ test account to verify typed contracts match real API behavior
- **Linter & Formatter:** Biome — all-in-one Rust-based linter and formatter replacing ESLint + Prettier. Fast, opinionated, minimal config
- **Pre-commit Hooks:** Husky + lint-staged — run Biome and Vitest on staged files before commit
