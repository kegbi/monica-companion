# Product Roadmap: Monica Companion

_This roadmap outlines our strategic direction based on customer needs and business goals. Each phase builds upon the previous one, ensuring a solid foundation before adding intelligence and delivery layers._

---

### Phase 1: Foundation & Infrastructure

_Establish the architectural backbone — modular service design, observability, and secure inter-service communication._

- [ ] **Multi-Service Architecture Design**
  - [ ] **Modular Service Blueprint:** Draft a multi-service architecture covering all planned functionality with clear boundaries and extension points, following DRY and SOLID principles.
  - [ ] **Technology & Language Selection:** Pick languages, frameworks, and runtimes for each service based on requirements (performance, ecosystem, team expertise).
  - [ ] **Test Framework & Auto-Verification:** Select test frameworks and set up automated verification pipelines (unit, integration, e2e) from day one.

- [ ] **Observability Layer**
  - [ ] **Logging, Metrics & Tracing:** Implement structured logging, metrics collection, and distributed tracing across services.
  - [ ] **Presentation & Dashboards:** Set up observability dashboards for monitoring service health, errors, and performance. Configure alerting rules for repeated failures and high latency.

- [ ] **Inter-Service Security & User Identification**
  - [ ] **Service-to-Service Communication Layer:** Implement secure communication between services (authentication, authorization, encryption in transit). Shared `@monica-companion/auth` package for JWT signing/verification.
  - [ ] **User Identity Propagation:** Ensure user identity is securely passed and verified across service boundaries so each service knows which user's data it's operating on.
  - [ ] **Caller Allowlists:** Each service explicitly allows only expected callers. Internal endpoints are closed to anonymous traffic. Security checks enforced per endpoint, not only at the edge.
  - [ ] **Idempotency & Dedupe:** Shared `@monica-companion/idempotency` package to prevent duplicate command execution from Telegram retries or message replays. Dedup keys stored in PostgreSQL/Redis.
  - [ ] **Log Redaction:** Shared `@monica-companion/redaction` package to sanitize sensitive data (API keys, personal contact info, credentials) from structured logs before they reach the observability stack.
  - [ ] **Secret Rotation Policy:** Define and document a rotation schedule for JWT signing keys and encryption master keys.
  - [ ] **Health Check Endpoints:** Every application service exposes a `/health` endpoint for Docker Compose readiness/liveness probes and dependency ordering.

---

### Phase 2: MonicaHQ Integration

_Build a robust, typed interface to MonicaHQ and the multi-user management layer that sits on top of it._

- [ ] **Monica API Library & Integration Service**
  - [ ] **Typed API Client:** Build a MonicaHQ v4 API client library (`monica-api-lib` shared package) with properly typed request/response contracts for all needed endpoints (contacts, notes, activities, reminders). API scope documented in `context/product/monica-api-scope.md`.
  - [ ] **Monica Integration Service:** Dedicated service wrapping `monica-api-lib` as a clean gateway to Monica. Handles timeout handling on all Monica API calls, retry with exponential backoff for transient failures, safe pagination for large datasets, and payload standardization/validation.
  - [ ] **Multi-Instance Support:** Support multiple API keys and base URLs so different users can authenticate against different MonicaHQ v4 instances (self-hosted or app.monicahq.com).
  - [ ] **Integration Testing:** Test the library and service against a real MonicaHQ v4 test account to verify typed contracts match actual API behavior.

- [ ] **Multi-User Management Service**
  - [ ] **User Registration & Configuration:** Allow multiple users to register, each with their own MonicaHQ v4 instance URL and API key.
  - [ ] **Isolated User Contexts:** Ensure each user's MonicaHQ connection, data, and configuration are fully isolated from other users.
  - [ ] **Credential Management:** Securely store and manage MonicaHQ API keys per user (AES-256 encrypted at rest).

- [ ] **Web UI (Astro)**
  - [ ] **Onboarding Web Page:** An Astro-based frontend service serving a secure web page where users enter their MonicaHQ instance URL, API key, preferred language, confirmation mode, and reminder schedule. Designed to be extensible into a full management dashboard (per-user settings, activity logs, login) in future versions.
  - [ ] **Telegram Deep Link Integration:** Telegram bot generates a unique setup link per user. User opens link in browser, completes setup, and is redirected back to Telegram.
  - [ ] **Credential Security:** Credentials are submitted over HTTPS directly to the user-management service API — never sent through Telegram chat.

---

### Phase 3: Intelligence Layer

_Define the command vocabulary, build the AI-powered command router, and implement conversation context for multi-turn interactions._

- [ ] **Structured Command Payloads**
  - [ ] **Command Schema Definition:** Define structured payloads for every supported command (create contact, add note, update field, query info, set reminder, etc.).
  - [ ] **Supported Commands Catalog:** Document the concrete list of supported commands with their parameters, validation rules, and expected outcomes.

- [ ] **AI Command Router**
  - [ ] **Natural Language Parsing:** Parse free-form text/voice transcriptions into structured command intents using AI. Multi-language support from day one — detect language and process accordingly.
  - [ ] **Smart Disambiguation & Clarification:** When the AI can't confidently resolve a contact or action, present Telegram inline keyboard buttons for selection (e.g., [Sherry Miller — friend] [Sherry Chen — colleague]). Users can reply via buttons, text, or voice message — voice is always transcribed and handled as text at every stage.
  - [ ] **Standard Format Serialization:** Serialize parsed intents into the structured command payloads defined above for downstream execution.

- [ ] **Conversation History & Context**
  - [ ] **History State Preservation:** Implement strategies to persist conversation history so the AI can reference previous messages.
  - [ ] **Context-Based Execution:** Enable the AI to resolve references like "add a note to her" based on the contact mentioned in the previous message.

---

### Phase 4: Connectors & Delivery

_Wire everything together — scheduling, Telegram integration, and voice transcription — with a modular connector design for future platforms._

- [ ] **Scheduler & Command Dispatch**
  - [ ] **Unified Command Execution:** ALL commands (real-time interactive and scheduled cron jobs) flow through the scheduler via BullMQ. ai-router enqueues structured payloads; scheduler executes them against MonicaHQ via the monica-integration service.
  - [ ] **Retry & Error Handling:** Add retry logic with exponential backoff for transient failures. When retries are exhausted, route error notification to delivery service for user-facing message via Telegram.
  - [ ] **Idempotency Enforcement:** Apply idempotency checks at scheduler ingress to prevent duplicate command execution.
  - [ ] **Cron Job Support:** Enable per-user configurable cron jobs (daily/weekly event summaries) with results routed through delivery service.

- [ ] **Delivery Service**
  - [ ] **Outbound Message Routing:** Receive formatted results from scheduler and route to the originating connector (Telegram in v1). Decouples message generation from delivery.
  - [ ] **Connector-Agnostic Routing:** Route structured payloads to the correct connector based on message origin. The connector (telegram-bridge) owns platform-specific formatting (inline keyboards, markdown). Designed for future multi-connector support (Matrix, Discord).
  - [ ] **Error Notification Delivery:** Deliver user-facing error messages (e.g., "MonicaHQ appears to be down") when command retries are exhausted.
  - [ ] **Delivery Audit Records:** Log what was sent, when, to whom, and whether delivery succeeded or failed. Visible in observability stack.

- [ ] **Telegram Bridge**
  - [ ] **Bot Setup & User Identification:** Implement the Telegram bot with user registration, linking Telegram accounts to Monica Companion user accounts. Private-chat-only policy enforced (group messages rejected).
  - [ ] **Message Ingress Pipeline:** Receive user text/voice messages, detect content type, route voice to voice-transcription service, forward transcribed/text to ai-router. Show typing indicators while AI processes.
  - [ ] **Error Handling & Edge Cases:** Handle Telegram API errors, rate limits, message format edge cases, and user-facing error messages gracefully.

- [ ] **Voice Transcription Service**
  - [ ] **Dedicated Transcription Service:** Standalone service wrapping OpenAI Whisper API. Receives audio from any connector, returns transcribed text. Connector-agnostic from day one.
  - [ ] **Multi-Language Transcription:** Support transcription in any language natively via Whisper.
  - [ ] **Telegram Integration:** Wire telegram-bridge to route voice messages to voice-transcription service and receive text back before forwarding to ai-router.
