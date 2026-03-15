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
  - [ ] **Presentation & Dashboards:** Set up observability dashboards for monitoring service health, errors, and performance.

- [ ] **Inter-Service Security & User Identification**
  - [ ] **Service-to-Service Communication Layer:** Implement secure communication between services (authentication, authorization, encryption in transit).
  - [ ] **User Identity Propagation:** Ensure user identity is securely passed and verified across service boundaries so each service knows which user's data it's operating on.

---

### Phase 2: MonicaHQ Integration

_Build a robust, typed interface to MonicaHQ and the multi-user management layer that sits on top of it._

- [ ] **Monica API Library**
  - [ ] **Typed API Client:** Build a MonicaHQ v4 API client library with properly typed request/response contracts for all needed endpoints (contacts, notes, activities, reminders).
  - [ ] **Multi-Instance Support:** Support multiple API keys and base URLs so different users can authenticate against different MonicaHQ v4 instances.
  - [ ] **Integration Testing:** Test the library against a real MonicaHQ v4 test account to verify typed contracts match actual API behavior.

- [ ] **Multi-User Management Service**
  - [ ] **User Registration & Configuration:** Allow multiple users to register, each with their own MonicaHQ v4 instance URL and API key.
  - [ ] **Isolated User Contexts:** Ensure each user's MonicaHQ connection, data, and configuration are fully isolated from other users.
  - [ ] **Credential Management:** Securely store and manage MonicaHQ API keys per user (AES-256 encrypted at rest).

- [ ] **Web-Based Setup Frontend (Astro)**
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
  - [ ] **Command Execution Engine:** Implement command dispatching that routes structured payloads to the appropriate service (MonicaHQ API, user management, etc.).
  - [ ] **Retry & Error Handling:** Add retry logic with exponential backoff for transient failures. When retries are exhausted, send user-facing error notification via Telegram (e.g., "MonicaHQ appears to be down, I'll keep trying").
  - [ ] **Cron Job Support:** Enable per-user configurable cron jobs (daily/weekly event summaries) with delivery routed to the user's connected messaging platform.
  - [ ] **Per-Connector Routing:** Route messages back to the connector they originated from, supporting future multi-connector scenarios.

- [ ] **Telegram Bridge**
  - [ ] **Bot Setup & User Identification:** Implement the Telegram bot with user registration, linking Telegram accounts to Monica Companion user accounts.
  - [ ] **Message Send/Receive Pipeline:** Wire up end-to-end message handling — receive user text/voice, process through AI router, return responses and confirmations.
  - [ ] **Error Handling & Edge Cases:** Handle Telegram API errors, rate limits, message format edge cases, and user-facing error messages gracefully.

- [ ] **Voice Transcription**
  - [ ] **Speech-to-Text Integration:** Integrate OpenAI Whisper API to convert Telegram voice messages to text. Multi-language transcription supported natively.
  - [ ] **Telegram Voice Wiring:** Wire voice message handling into the Telegram bridge so voice notes flow through the same AI router pipeline as text.
  - [ ] **Multi-Connector Abstraction:** Ensure the voice processing layer is connector-agnostic, so future platforms (Matrix, Discord) can reuse the same transcription pipeline.
