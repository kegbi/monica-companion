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

- [x] **Operational Review**
  - [x] Measure queue latency, retry amplification, OpenAI spend, and reminder reliability under load.
  - [x] Validate that keeping `delivery` and `voice-transcription` as separate deployables in V1 continues to be justified by operational needs and connector roadmap.
  - [x] Verify that read-only interactions continue to bypass the queued execution path and still meet latency targets.

- [x] **Connector-Ready Contracts**
  - [x] Keep connector-neutral contracts clean without leaking Telegram-specific assumptions.
  - [x] Add future-connector work only after the Telegram workflow meets the acceptance criteria.

---

### Phase 6: LangGraph AI Orchestration & Conversation Intelligence

_Wire the LLM brain into the existing infrastructure. The plumbing (pending commands, contact resolution, scheduler, delivery) is complete — this phase adds intent parsing, multi-turn conversation, and the GPT integration that makes the system actually understand user messages._

- [x] **LangGraph Pipeline Foundation**
  - [x] Install `@langchain/langgraph`, `@langchain/openai` in `ai-router`.
  - [x] Define the LangGraph `StateGraph` with a typed conversation state schema: current turn, recent turn summaries, active pending command reference, resolved contact context, and user preferences.
  - [x] Add a `conversation_turns` PostgreSQL table in `ai-router` to persist per-user turn summaries (role, summary text, timestamp, correlation ID) with a configurable retention window (default 30 days).
  - [x] Wire `POST /internal/process` to invoke the LangGraph graph instead of returning the current stub `{ received: true }`.
  - [x] Ensure the graph runner respects the existing guardrail middleware (rate limits, concurrency caps, budget tracking, kill switch).

- [x] **Intent Classification & Command Parsing**
  - [x] Integrate OpenAI GPT `gpt-5.4-mini` (model ID: `gpt-5.4-mini`, 400K context, structured outputs, reasoning tokens) as the LLM provider for intent parsing.
  - [x] Configure medium reasoning effort for balanced accuracy vs. latency on command parsing.
  - [x] Build a system prompt scoped to Monica Companion's V1 command domain: contact create, note create, activity create, field updates (birthday, phone, email, address), and read queries (birthday, phone, last note).
  - [x] Use GPT structured outputs with Zod schemas to extract typed command payloads directly — no regex or manual JSON parsing.
  - [x] Implement intent routing: classify each utterance as `mutating_command`, `read_query`, `clarification_response`, `greeting`, or `out_of_scope`.
  - [x] Detect user language from the utterance and generate all user-facing copy (confirmations, clarifications, errors) in the same language.

- [x] **Multi-Turn Conversation & Context Preservation**
  - [x] Load the most recent N turn summaries (configurable, default 10) from `conversation_turns` into the LangGraph state before each invocation.
  - [x] Support follow-up references ("add a note to him too", "what about her birthday?") by resolving pronouns and implicit references against the conversation context and last resolved contact.
  - [x] When the LLM needs clarification (ambiguous contact, missing fields, unclear intent), generate a clarification question via `delivery` and keep the pending command in `draft` status for the next user turn.
  - [x] Attach follow-up messages to the active pending command instead of creating unrelated new commands.
  - [x] Support multi-step disambiguation: user selects a contact from buttons → system re-evaluates the command with the resolved contact → prompts for confirmation.
  - [x] Persist a compressed turn summary after each interaction (not the raw utterance or full LLM response) to satisfy data-governance minimization requirements.

- [x] **Voice Transcription Model Upgrade**
  - [x] Upgrade the default transcription model from `whisper-1` to `gpt-4o-transcribe` (model ID: `gpt-4o-transcribe`). Same endpoint `/v1/audio/transcriptions`, improved word-error rate and language recognition.
  - [x] Update `response_format` from `verbose_json` to `json` — `gpt-4o-transcribe` does not support `verbose_json` or `srt`/`vtt` formats.
  - [x] Update the default `WHISPER_COST_PER_MINUTE_USD` config to reflect `gpt-4o-transcribe` token-based pricing ($6.00/1M audio input tokens).
  - [x] Keep `whisper-1` as a supported fallback via the `WHISPER_MODEL` env var for operators who prefer lower cost.
  - [x] Verify language detection still works under the `json` response format and adjust `TranscriptionResult` mapping if needed.

- [x] **End-to-End Pipeline Wiring**
  - [x] Connect intent classification output → pending command creation (mutating) or direct delivery response (read-only/greeting/out-of-scope).
  - [x] Connect confirmed commands → `scheduler` via `POST /internal/execute` with the existing `ConfirmedCommandPayload` contract.
  - [x] Implement auto-confirmation logic: when user preferences allow it and LLM confidence exceeds threshold, skip the confirmation prompt and send directly to scheduler.
  - [x] Route read-only queries directly from `ai-router` → `delivery`, bypassing scheduler as required by service boundary rules.
  - [x] Handle stale/expired/version-mismatched confirmations with clear user-facing rejection messages.
  - [x] Wire callback actions (confirm/edit/cancel from Telegram buttons) through the LangGraph graph so edits re-enter the parsing pipeline with updated context.

- [ ] **LLM Smoke Tests & Benchmark Activation**
  - [ ] **Command parsing smoke tests:** Docker Compose smoke tests that send representative text messages through the live `telegram-bridge → ai-router` path and verify that correct command types and payloads are produced. Cover all V1 command types: contact create, note create, activity log, field updates, and read queries.
  - [ ] **Multi-stage dialog smoke tests:** Smoke tests that simulate a full clarification round-trip: initial ambiguous message → system asks clarification → user replies → system produces correct command. Verify the pending command stays in `draft` through clarification and transitions to `pending_confirmation` only when resolved.
  - [ ] **Context preservation smoke tests:** Smoke tests that send two consecutive messages where the second references the first ("add a note to John" → "also update his birthday to March 5th") and verify the second message resolves "his" to John without re-asking.
  - [ ] **Out-of-scope rejection smoke tests:** Verify that messages outside the Monica domain ("what's the weather?") produce a polite decline and do NOT create pending commands or trigger mutations.
  - [ ] **Activate pending intent benchmark cases** in `read-intents.ts`, `write-intents.ts`, and `clarification-turns.ts`. Implement the intent evaluation path in `evaluate.ts` that calls the LangGraph pipeline and compares structured output against expected labels.
  - [ ] **Implement false-positive mutation rate tracking** in the benchmark evaluator — replace the hardcoded `0` with actual measurement of cases where a read/clarification input incorrectly produced a mutating command.
  - [ ] Gate release on acceptance-criteria thresholds: read accuracy ≥ 92%, write accuracy ≥ 90%, contact-resolution precision ≥ 95%, false-positive mutation rate < 1%.

---

### Phase 7: Integration Completion & V1 Acceptance Closure

_Close remaining gaps between implemented infrastructure and V1 acceptance criteria. The AI core from Phase 6 enables full end-to-end validation._

- [ ] **Data Governance Enforcement**
  - [ ] Implement automated retention cleanup: purge `conversation_turns` records older than 30 days, `command_logs` and `delivery_audits` older than 90 days, and traces/logs/dead-letter payloads older than 14 days.
  - [ ] Implement account disconnection flow: immediate credential deletion + schedule user-specific conversational and audit data for purge within 30 days.
  - [ ] Verify voice audio is not retained after transcription completes (transient processing only).

- [ ] **Benchmark Expansion to Release Threshold**
  - [ ] Expand the labeled benchmark set to at least 200 utterances: 100 write intents, 60 read/query intents, and 40 clarification/disambiguation turns, including at least 50 voice samples as required by acceptance criteria.
  - [ ] Include edge cases: multi-language utterances, ambiguous contacts with similar names, compound commands ("add a note and update his phone"), and out-of-scope requests that must not trigger mutations.

- [ ] **Latency Validation**
  - [ ] Measure p95 time-to-first-response under the staging environment: ≤ 5 seconds for text input, ≤ 12 seconds for voice input.
  - [ ] Profile the LangGraph pipeline and optimize if thresholds are exceeded (context window trimming, prompt caching, parallel contact resolution).

- [ ] **Full Acceptance Criteria Sweep**
  - [ ] Run the complete acceptance-criteria checklist from `context/product/acceptance-criteria.md` against the live Docker Compose stack.
  - [ ] Document any deferred items with rationale.
  - [ ] Produce a V1 release readiness report with changed files, verification results, and residual risks.
