# Product Roadmap: Monica Companion

_This roadmap is an execution plan for the already-selected V1 architecture. It prioritizes security contracts and core behavior before optimization or future connector expansion._

---

### Phase 1: Security Baseline & Platform Skeleton

_Lock down ingress, identity, and operational safety before building the Monica workflow._

- [ ] **Monorepo & Runtime Baseline**
  - [ ] Bootstrap the pnpm workspace layout for shared packages and the 8 service packages.
  - [ ] Wire Biome, Vitest, `tsx`, and `tsup` into a repeatable local and CI workflow.
  - [ ] Stand up Docker Compose for app services, PostgreSQL, Redis, and observability.

- [ ] **Public Ingress Hardening**
  - [ ] Expose only the Telegram webhook and onboarding web UI through Caddy.
  - [ ] Keep internal APIs and `/health` endpoints private to the internal network.
  - [ ] Enforce Telegram webhook authenticity checks, request-size limits, and ingress rate limiting.

- [ ] **Inter-Service Security**
  - [ ] Implement signed JWT-based service auth with per-endpoint caller allowlists.
  - [ ] Propagate user identity and correlation IDs across all service boundaries.
  - [ ] Define secret-rotation procedures for JWT signing keys and encryption master keys.

- [ ] **Setup-Link Authentication**
  - [ ] Implement one-time setup tokens bound to Telegram user identity and onboarding step.
  - [ ] Define token TTL, consume-on-use semantics, replay rejection, cancellation, and reissue flow.
  - [ ] Add CSRF/origin protections and audit logging to onboarding submission.

- [ ] **Observability & Governance Baseline**
  - [ ] Instrument all services with OpenTelemetry.
  - [ ] Define redaction, retention, and deletion rules for logs, traces, queue payloads, dead letters, and conversation state.
  - [ ] Create dashboards and alerts for failures, latency, quota exhaustion, and scheduler misfires.

---

### Phase 2: Monica Integration & Account Linking

_Finish the Monica boundary and credential model before broader AI behavior depends on it._

- [ ] **Monica Contract Completion**
  - [ ] Finish `context/product/monica-api-scope.md` so fixtures, schemas, and tests stop depending on guesswork.
  - [ ] Document the Monica fields and endpoints needed to build the internal contact-resolution projection.

- [ ] **Typed Monica Integration**
  - [ ] Build `@monica-companion/monica-api-lib` with typed contracts and validation for all V1 operations.
  - [ ] Implement `monica-integration` as the only Monica-facing service.
  - [ ] Add transport-level timeouts, capped quick retries, pagination handling, and Monica-specific error mapping.

- [ ] **Safe Multi-Instance Support**
  - [ ] Normalize and persist canonical Monica base URLs.
  - [ ] Reject insecure or blocked Monica targets (`http://`, loopback, RFC1918, link-local, blocked redirects) in the hosted default.
  - [ ] Support a documented operator override only for trusted single-tenant deployments that intentionally allow local-network Monica targets.

- [ ] **Least-Privilege User Management**
  - [ ] Keep Monica credentials encrypted at rest in `user-management`.
  - [ ] Expose audited credential access only to `monica-integration`.
  - [ ] Expose separate non-secret preference and schedule endpoints to `telegram-bridge`, `ai-router`, and `scheduler`.

- [ ] **Testing Strategy Split**
  - [ ] Use mocked Monica contract tests in CI.
  - [ ] Stand up a controlled real-Monica smoke suite outside normal CI.
  - [ ] Make the smoke suite a release gate for production.

---

### Phase 3: Command Intelligence & Safe Interaction Flow

_Define the user-facing AI contract and make interactive mutations safe before scaling connector or scheduling behavior._

- [ ] **Command Contract & Lifecycle**
  - [ ] Define structured command schemas for all supported create/update/query actions.
  - [ ] Implement pending-command storage with `pendingCommandId`, versioning, source-message references, and TTL.
  - [ ] Enforce lifecycle transitions `draft -> pending_confirmation -> confirmed -> executed -> expired/cancelled`.

- [ ] **Contact Resolution Boundary**
  - [ ] Implement the Monica-agnostic `ContactResolutionSummary` projection.
  - [ ] Ensure `ai-router` consumes only the projection, not raw Monica payloads or credentials.
  - [ ] Define deterministic ranking and ambiguity thresholds for kinship, nickname, and duplicate-name scenarios.

- [ ] **Benchmark & Quality Gates**
  - [ ] Build the labeled benchmark set for read intents, write intents, and clarification turns.
  - [ ] Track read accuracy, write accuracy, contact-resolution precision, false-positive mutation rate, and latency.
  - [ ] Block release if the benchmark thresholds in `acceptance-criteria.md` are not met.

- [ ] **Shared-Model Guardrails**
  - [ ] Enforce per-user request-size limits and concurrency caps for GPT/Whisper usage.
  - [ ] Add budget alarms and an operator kill switch/degraded-mode path.
  - [ ] Define user-facing behavior when OpenAI quota or budget is exhausted.

---

### Phase 4: Scheduling, Delivery, and Telegram Workflow

_Finish the end-to-end runtime behavior for confirmations, reminders, and message delivery._

- [ ] **Telegram Bridge**
  - [ ] Implement webhook ingestion, private-chat-only enforcement, connector event normalization, and Telegram file retrieval.
  - [ ] Route voice input through `voice-transcription` using the connector-neutral transcription contract.
  - [ ] Support buttons, text replies, and voice replies for confirmation and clarification flows.

- [ ] **Voice Transcription**
  - [ ] Accept binary upload or short-lived fetch URL plus media metadata.
  - [ ] Return normalized transcript output and user-safe failure states.
  - [ ] Keep connector-specific file handles inside the connector.

- [ ] **Scheduler**
  - [ ] Accept only confirmed commands for execution.
  - [ ] Own idempotency, job-level retries, dead-letter handling, and execution observability.
  - [ ] Implement daily/weekly reminder scheduling using IANA timezones, DST-aware local wall-clock semantics, and a bounded catch-up window.

- [ ] **Delivery**
  - [ ] Route all outbound connector-neutral message intents through `delivery`.
  - [ ] Keep formatting in the connector, not in `delivery` or `scheduler`.
  - [ ] Persist delivery audits and expose failure visibility in observability.

---

### Phase 5: Hardening & Scope Review

_Use real usage data to decide whether the documented service split is justified for V1 or should stay modular-but-collapsed in deployment._

- [ ] **Operational Review**
  - [ ] Measure queue latency, retry amplification, OpenAI spend, and reminder reliability under load.
  - [ ] Revisit whether `delivery` and `voice-transcription` need to remain separate deployables for the Telegram-only release.
  - [ ] Revisit whether all read-only interactions need the full queued execution path.

- [ ] **Connector-Ready Contracts**
  - [ ] Keep connector-neutral contracts clean without leaking Telegram-specific assumptions.
  - [ ] Add future-connector work only after the Telegram workflow meets the acceptance criteria.
