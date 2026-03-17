# Product Roadmap: Monica Companion

_This roadmap is an execution plan for the selected V1 logical architecture and deployment profile documented in `context/spec/adr-v1-deployment-profile.md`. It prioritizes security contracts and core behavior before future connector expansion or service refactoring._

---

### Phase 1: Security Baseline & Platform Skeleton

_Lock down ingress, identity, and operational safety before building the Monica workflow._

- [x] **Monorepo & Runtime Baseline**
  - [x] Bootstrap the pnpm workspace layout for shared packages and the 8 logical service packages.
  - [x] Start with the initial V1 deployment profile: 8 application containers, one per documented service boundary.
  - [x] Wire Biome, Vitest, `tsx`, and `tsup` into a repeatable local and CI workflow.
  - [x] Stand up Docker Compose for app services, PostgreSQL, Redis, and observability.

- [x] **Public Ingress Hardening**
  - [x] Expose only the Telegram webhook and onboarding web UI through Caddy.
  - [x] Keep internal APIs and `/health` endpoints private to the internal network.
  - [x] Require `X-Telegram-Bot-Api-Secret-Token` on Telegram webhook ingress and enforce request-size limits plus ingress rate limiting.

- [x] **Inter-Service Security**
  - [x] Implement signed JWT-based service auth with per-endpoint caller allowlists.
  - [x] Propagate user identity and correlation IDs across all service boundaries.
  - [x] Define secret-rotation procedures for JWT signing keys and encryption master keys.

- [x] **Setup-Link Authentication**
  - [x] Implement one-time setup tokens bound to Telegram user identity and onboarding step.
  - [x] Implement a 15-minute TTL, one-active-token-per-user, consume-on-success, replay rejection, cancellation, and reissue-invalidates-previous-token semantics.
  - [x] Add CSRF/origin protections and audit logging to onboarding submission.

- [x] **Observability & Governance Baseline**
  - [x] Instrument all services with OpenTelemetry.
  - [x] Define redaction, retention, and deletion rules for logs, traces, queue payloads, dead letters, and conversation state.
  - [x] Create dashboards and alerts for failures, latency, quota exhaustion, and scheduler misfires.

---

### Phase 2: Monica Integration & Account Linking

_Finish the Monica boundary and credential model before broader AI behavior depends on it._

- [x] **Monica Contract Completion**
  - [x] Finish `context/product/monica-api-scope.md` so fixtures, schemas, and tests stop depending on guesswork.
  - [x] Document the Monica fields and endpoints needed to build the internal contact-resolution projection.

- [x] **Typed Monica Integration**
  - [x] Build `@monica-companion/monica-api-lib` with typed contracts and validation for all V1 operations.
  - [x] Implement `monica-integration` as the only Monica-facing service.
  - [x] Add transport-level timeouts, capped quick retries, pagination handling, and Monica-specific error mapping.

- [x] **Safe Multi-Instance Support**
  - [x] Normalize and persist canonical Monica base URLs.
  - [x] Reject insecure or blocked Monica targets (`http://`, loopback, RFC1918, link-local, blocked redirects) in the hosted default.
  - [x] Support a documented operator override only for trusted single-tenant deployments that intentionally allow local-network Monica targets.

- [x] **Least-Privilege User Management**
  - [x] Keep Monica credentials encrypted at rest in `user-management`.
  - [x] Expose audited credential access only to `monica-integration`.
  - [x] Expose separate non-secret preference and schedule endpoints to `telegram-bridge`, `ai-router`, and `scheduler`.

- [x] **Testing Strategy Split**
  - [x] Use mocked Monica contract tests in CI.
  - [x] Stand up a controlled real-Monica smoke suite outside normal CI.
  - [x] Make the smoke suite a release gate for production.

---

### Phase 3: Command Intelligence & Safe Interaction Flow

_Define the user-facing AI contract and make interactive mutations safe before scaling connector or scheduling behavior._

- [x] **Command Contract & Lifecycle**
  - [x] Define structured command schemas for all supported create/update/query actions.
  - [x] Implement pending-command storage with `pendingCommandId`, versioning, source-message references, and TTL.
  - [x] Enforce lifecycle transitions `draft -> pending_confirmation -> confirmed -> executed -> expired/cancelled`.

- [x] **Contact Resolution Boundary**
  - [x] Implement the Monica-agnostic `ContactResolutionSummary` projection.
  - [x] Ensure `ai-router` consumes only the projection, not raw Monica payloads or credentials.
  - [x] Define deterministic ranking and ambiguity thresholds for kinship, nickname, and duplicate-name scenarios.

- [x] **Benchmark & Quality Gates**
  - [x] Build the labeled benchmark set for read intents, write intents, and clarification turns.
  - [x] Track read accuracy, write accuracy, contact-resolution precision, false-positive mutation rate, and latency.
  - [x] Block release if the benchmark thresholds in `acceptance-criteria.md` are not met.

- [x] **Shared-Model Guardrails**
  - [x] Enforce per-user request-size limits and concurrency caps for GPT/Whisper usage.
  - [x] Add budget alarms and an operator kill switch/degraded-mode path.
  - [x] Define user-facing behavior when OpenAI quota or budget is exhausted.

---

### Phase 4: Scheduling, Delivery, and Telegram Workflow

_Finish the end-to-end runtime behavior for confirmations, reminders, and message delivery._

- [x] **Telegram Bridge**
  - [x] Implement webhook ingestion, private-chat-only enforcement, connector event normalization, and Telegram file retrieval.
  - [x] Route voice input through `voice-transcription` using the connector-neutral transcription contract.
  - [x] Support buttons, text replies, and voice replies for confirmation and clarification flows.

- [x] **Voice Transcription**
  - [x] Implement `voice-transcription` as a standalone service package and deployable in the initial Telegram-only profile.
  - [x] Accept binary upload or short-lived fetch URL plus media metadata.
  - [x] Return normalized transcript output and user-safe failure states.
  - [x] Keep connector-specific file handles inside the connector.

- [x] **Scheduler**
  - [x] Accept only confirmed commands for execution.
  - [x] Own idempotency, job-level retries, dead-letter handling, and execution observability.
  - [x] Implement daily/weekly reminder scheduling using IANA timezones, DST-aware local wall-clock semantics, and a bounded catch-up window.

- [x] **Delivery**
  - [x] Implement `delivery` as a standalone service package and deployable in the initial Telegram-only profile.
  - [x] Route all outbound connector-neutral message intents through `delivery`.
  - [x] Keep formatting in the connector, not in `delivery` or `scheduler`.
  - [x] Persist delivery audits and expose failure visibility in observability.

---

### Phase 5: Hardening & Scope Review

_Use real usage data to validate that the separate service split remains justified and to identify where contracts or scaling boundaries need adjustment after V1._

- [ ] **Operational Review**
  - [ ] Measure queue latency, retry amplification, OpenAI spend, and reminder reliability under load.
  - [ ] Validate that keeping `delivery` and `voice-transcription` as separate deployables in V1 continues to be justified by operational needs and connector roadmap.
  - [ ] Verify that read-only interactions continue to bypass the queued execution path and still meet latency targets.

- [ ] **Connector-Ready Contracts**
  - [ ] Keep connector-neutral contracts clean without leaking Telegram-specific assumptions.
  - [ ] Add future-connector work only after the Telegram workflow meets the acceptance criteria.
