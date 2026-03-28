# Product Roadmap: Monica Companion

_This roadmap is an execution plan for the selected V1 logical architecture and deployment profile documented in `context/product/adr-v1-deployment-profile.md`. It prioritizes security contracts and core behavior before future connector expansion or service refactoring._

> **Current status:** Phases 1-10 complete. Phase 11 adds a standalone MCP server package exposing MonicaHQ operations as tools for Claude Desktop, Claude Code, and other MCP-compatible AI clients.

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

- [x] **LLM Smoke Tests & Benchmark Activation**
  - [x] **Command parsing smoke tests:** Docker Compose smoke tests that send representative text messages through the live `ai-router /internal/process` endpoint and verify that correct command types and payloads are produced. Cover all V1 command types: contact create, note create, activity log, field updates, and read queries.
  - [x] **Multi-stage dialog smoke tests:** Smoke tests that simulate a full clarification round-trip: initial ambiguous message → system asks clarification → user replies → system produces correct command. Verify the pending command stays in `draft` through clarification and transitions to `pending_confirmation` only when resolved.
  - [x] **Context preservation smoke tests:** Smoke tests that send two consecutive messages where the second references the first ("add a note to John" → "also update his birthday to March 5th") and verify the second message resolves "his" to John without re-asking.
  - [x] **Out-of-scope rejection smoke tests:** Verify that messages outside the Monica domain ("what's the weather?") produce a polite decline and do NOT create pending commands or trigger mutations.
  - [x] **Activate pending intent benchmark cases** in `read-intents.ts`, `write-intents.ts`, and `clarification-turns.ts`. Implement the intent evaluation path in `evaluate.ts` that calls the LangGraph pipeline and compares structured output against expected labels.
  - [x] **Implement false-positive mutation rate tracking** in the benchmark evaluator — replace the hardcoded `0` with actual measurement of cases where a read/clarification input incorrectly produced a mutating command.
  - [x] Gate release on acceptance-criteria thresholds: read accuracy ≥ 92%, write accuracy ≥ 90%, contact-resolution precision ≥ 95%, false-positive mutation rate < 1%.

---

### Phase 7: Integration Completion & V1 Acceptance Closure

_Close remaining gaps between implemented infrastructure and V1 acceptance criteria. The AI core from Phase 6 enables full end-to-end validation._

- [x] **Data Governance Enforcement**
  - [x] Implement automated retention cleanup: purge `conversation_turns` records older than 30 days, `command_logs` and `delivery_audits` older than 90 days, and traces/logs/dead-letter payloads older than 14 days.
  - [x] Implement account disconnection flow: immediate credential deletion + schedule user-specific conversational and audit data for purge within 30 days.
  - [x] Verify voice audio is not retained after transcription completes (transient processing only).

- [x] **Benchmark Expansion to Release Threshold**
  - [x] Expand the labeled benchmark set to at least 200 utterances: 100 write intents, 60 read/query intents, and 40 clarification/disambiguation turns, including at least 50 voice samples as required by acceptance criteria.
  - [x] Include edge cases: multi-language utterances, ambiguous contacts with similar names, compound commands ("add a note and update his phone"), and out-of-scope requests that must not trigger mutations.

- [x] **Latency Validation**
  - [x] Measure p95 time-to-first-response under the staging environment: ≤ 5 seconds for text input, ≤ 12 seconds for voice input.
  - [x] Profile the LangGraph pipeline and optimize if thresholds are exceeded (context window trimming, prompt caching, parallel contact resolution).

- [x] **Full Acceptance Criteria Sweep**
  - [x] Run the complete acceptance-criteria checklist from `context/product/acceptance-criteria.md` against the live Docker Compose stack.
  - [x] Document any deferred items with rationale.
  - [x] Produce a V1 release readiness report with changed files, verification results, and residual risks.

---

### Phase 8: Onboarding & User Flow Completion

_Close the remaining gaps that block the end-to-end user journey: a new user must be able to start the bot, receive a setup link, fill in credentials, and have the AI resolve contacts against their real Monica data._

- [x] **Telegram /start Command Handler**
  - [x] Register a `/start` command handler in `telegram-bridge` bot setup.
  - [x] For unregistered users: call `user-management` `POST /internal/setup-tokens` with the Telegram user ID to issue a signed 15-minute setup link.
  - [x] Add an `issueSetupToken()` method to the `telegram-bridge` user-management client.
  - [x] Send the setup URL to the user in the Telegram chat with a clear onboarding prompt.
  - [x] For already-registered users: reply with a "you're already set up" message (or offer re-setup / settings link).
  - [x] Update tests: the bot setup test currently expects 1 command (`/disconnect`); update to expect 2 (`/start`, `/disconnect`).

- [x] **Web-UI Onboarding Form Completion**
  - [x] Add form fields to `[tokenId].astro`: Monica base URL, Monica API key, preferred language, confirmation mode, IANA timezone selector, reminder cadence, reminder time.
  - [x] Extend the `ConsumeSetupTokenRequest` Zod schema in `@monica-companion/types` to include all onboarding fields alongside `sig`.
  - [x] Update the `web-ui` form submission handler (`submit.ts`) to extract and validate all fields, then forward them to `user-management`.
  - [x] Update the `user-management` consume endpoint to accept the extended payload: create or update the `users` row with encrypted Monica credentials, populate the `user_preferences` row with timezone, language, confirmation mode, reminder cadence, and reminder time.
  - [x] Add client-side validation: Monica URL must be HTTPS and well-formed, timezone must be a valid IANA identifier, API key must be non-empty.
  - [x] Add a success page or redirect after consumption that instructs the user to return to Telegram.

- [x] **Contact Resolution Integration into LangGraph Pipeline**
  - [x] Wire the existing contact resolver (`ai-router/src/contact-resolution/`) into the LangGraph `executeAction` node so that `contactRef` strings from the LLM are resolved against real Monica contact data via `monica-integration`.
  - [x] When the LLM produces a `contactRef` for a mutating command, call `monica-integration` `/internal/contacts/resolution-summaries` and run the deterministic matcher before creating the pending command.
  - [x] Use real contact resolution results to populate disambiguation options instead of relying on LLM-generated options.
  - [x] When resolution returns `resolved` (single high-confidence match), auto-fill `contactId` in the command payload.
  - [x] When resolution returns `ambiguous`, generate a disambiguation prompt with real contact data (names, relationship labels) as inline keyboard buttons.
  - [x] When resolution returns `no_match`, prompt the user to clarify or offer to create a new contact.
  - [x] Ensure the contact summary is loaded once per graph invocation and cached in state to avoid redundant calls.

---

### Phase 9: Contact Resolution & Conversation Flow Improvements

_Fix fundamental issues with kinship matching and disambiguation UX discovered during live testing. Monica's relationship model stores bidirectional links between contacts in the address book — not "my relationship to this person" — so the current kinship resolution produces wrong or noisy results. The conversation flow also needs restructuring: confirm the action first, then resolve the contact._

- [x] **Bidirectional Kinship Matching**
  - [x] For asymmetric relationship types (parent/child, grandparent/grandchild, uncle/nephew, godparent/godchild, stepparent/stepchild, boss/subordinate, mentor/protege), match both the direct label AND its inverse. Example: "mom" currently maps to "parent" only — contacts that HAVE a parent listed. It must also match "child" — contacts that ARE parents (have children listed). Both directions are signal; neither is conclusive alone.
  - [x] Update the KINSHIP_MAP in `ai-router/src/contact-resolution/matcher.ts` to carry both the direct and inverse Monica label for each kinship term. Symmetric relationships (spouse, sibling, friend, colleague) stay unchanged.
  - [x] Adjust scoring: both directions produce the same score (0.9) since either is a valid but uncertain signal. The disambiguation flow handles narrowing.
  - [x] Add unit tests with real-world relationship topologies (parent on contact A pointing to contact B does NOT mean A is a parent — it means B is A's parent).

- [x] **Progressive Contact Narrowing**
  - [x] When contact resolution produces more than 5 ambiguous candidates, do NOT render them all as inline keyboard buttons. Instead, generate a clarifying question asking for the contact's name, surname, or other identifying detail ("What's your mom's name?").
  - [x] When the user responds with additional info, re-run the matcher against the same cached contact summaries using the combined original query + clarification as a compound query (e.g., kinship "mom" + name "Elena" narrows the pool).
  - [x] Repeat clarification rounds until the candidate pool is ≤ 5, then present buttons.
  - [x] If the pool reaches 0 after clarification, fall back to a "no match" flow (offer to create a new contact or re-phrase).
  - [x] Cap clarification rounds at 3 to prevent infinite loops — after 3 rounds, present whatever candidates remain (even if > 5) or give up gracefully.

- [x] **Confirm-Then-Resolve Conversation Flow**
  - [x] Restructure the graph so that for mutating commands with an unresolved contact reference, the system first confirms the ACTION (command type + payload, e.g., "Add note: 'Went to park today'?") with Yes/Edit/Cancel buttons.
  - [x] Only after the user confirms the action, proceed to contact resolution. This prevents wasted disambiguation effort when the user wants to edit or cancel the action itself.
  - [x] When the contact resolves unambiguously (single high-confidence match), execute immediately after action confirmation — no extra "which contact?" step.
  - [x] When the contact is ambiguous, enter the progressive narrowing flow (clarification or buttons depending on candidate count).

- [x] **Disambiguation Label & Callback Fixes (done)**
  - [x] Fix select callback re-triggering contact resolution — skip `resolveContactRef` for `callback_action` events.
  - [x] Fix double-parenthetical labels — strip Monica's built-in nickname parenthetical from `complete_name` before appending suffix.
  - [x] Remove confusing relationship labels from disambiguation buttons. Show: full name, nickname (if informative), and birthdate (if available). Format: `Elena Yuryevna (Mama), b. 15 Mar 1965`.

- [x] **Migrate LLM Evaluation to promptfoo**
  - [x] Install `promptfoo` as a dev dependency in `ai-router`. Pin exact version.
  - [x] Create a custom promptfoo provider that wraps `createIntentClassifier()` — accepts utterance text, returns the `IntentClassificationResult` JSON.
  - [x] Convert the 100 write-intent fixtures from `write-intents.ts` to a `write-intents.yaml` promptfoo dataset with `javascript`/`is-json` assertions on intent, commandType, and contactRef fields.
  - [x] Convert the 60 read-intent fixtures from `read-intents.ts` to a `read-intents.yaml` dataset.
  - [x] Convert the 25 clarification fixtures from `clarification-turns.ts` to a `clarification.yaml` dataset.
  - [x] Convert out-of-scope and greeting fixtures to a `guardrails.yaml` dataset. Include a custom `isMutating` scorer that flags false-positive mutations (replacing the manual `falsePositiveMutationRate` calculation in `evaluate.ts`).
  - [x] Create `promptfooconfig.yaml` with pass-rate thresholds matching acceptance criteria: read accuracy ≥ 92%, write accuracy ≥ 90%, false-positive mutation rate < 1%. Wire into CI via `pnpm bench:ai`.
  - [x] Delete `evaluateIntentCase()` and the intent aggregation path from `evaluate.ts`. Slim `benchmark.test.ts` down to the contact-resolution quality gate only (deterministic, stays in Vitest).
  - [x] Migrate applicable tests from `llm-integration.test.ts` (intent classification, payload extraction, language detection, out-of-scope rejection) into the promptfoo datasets. Keep multi-turn context tests and prompt injection tests as Vitest integration tests.
  - [x] Verify CI runs both: `promptfoo eval` for LLM quality gates and `vitest` for contact-resolution precision + graph integration tests.

- [x] **Graph-Level Integration Tests for Multi-Turn Contact Flow**
  - [x] Add graph-level test: full round-trip for kinship disambiguation — initial message → action confirmation → clarification question ("What's your mom's name?") → user answers → buttons presented → user selects → command executed.
  - [x] Add graph-level test: confirm-then-resolve flow where user cancels at action confirmation step (contact resolution never runs).
  - [x] Add graph-level test: unambiguous contact with kinship term (only one "parent" candidate) → action confirmation → auto-resolve → execute.

---

### Phase 10: Architecture Migration — Tool-Calling Agent

_Replace the custom LangGraph intent-classification pipeline with an LLM tool-calling agent loop. The current architecture uses the LLM as a structured data extractor feeding a hand-built state machine (~5,200 lines across execute-action, resolve-contact-ref, pending-command lifecycle, intent schemas, and format-response). This inverts the LLM's strengths: it's great at conversational reasoning and context threading, bad at consistently reproducing rigid JSON schemas across multi-turn flows. The state machine compensates for what the LLM is bad at while blocking what it's good at._

_The tool-calling pattern (validated by OpenAI function calling, Claude tool use, Botpress Autonomous Nodes, and the Conversation Routines research paper) lets the LLM orchestrate via tool calls while thin guardrails handle confirmation and validation. Context preservation is automatic because the full conversation history stays in the LLM's context window — no narrowingContext, no unresolvedContactRef, no updateDraftPayload._

- [x] **Stage 1: Agent Loop Foundation**

  _Replace the LangGraph StateGraph in `ai-router/src/graph/` with a single async agent loop function. The current pipeline (loadContext → classifyIntent → resolveContactRef → executeAction → formatResponse → deliverResponse → persistTurn) becomes: load history → LLM call with tools → execute or intercept → persist history._

  - [x] **LLM client**: Replace `@langchain/openai` `ChatOpenAI` (currently hardcoded to `gpt-5.4-mini` in `ai-router/src/graph/llm.ts:135`) with the OpenAI SDK pointed at a configurable base URL. New env vars in `ai-router/src/config.ts`: `LLM_BASE_URL` (default `https://openrouter.ai/api/v1`), `LLM_API_KEY` (replaces `OPENAI_API_KEY`), `LLM_MODEL_ID` (default `qwen/qwen3-235b-a22b`). Any provider exposing OpenAI-compatible `/v1/chat/completions` with tool calling works (OpenRouter, OpenAI, local vLLM, Ollama).
  - [x] **Agent loop** (`ai-router/src/agent/loop.ts`): single async function `runAgentLoop(userId, inboundText, correlationId)` that: (1) loads conversation history from DB, (2) appends the new user message, (3) calls `openai.chat.completions.create({ model, messages, tools })` in a while-loop, (4) if response has `tool_calls` — execute read-only tools immediately or intercept mutating tools for confirmation, appending tool results to history, (5) if response has `content` only — return it as the final text response, (6) persist the updated history. Cap the loop at 5 iterations to prevent runaway tool-call chains.
  - [x] **Tool definitions** (`ai-router/src/agent/tools.ts`): define ~11 tools as OpenAI-format function schemas with Zod-derived JSON schemas. Mutating: `search_contacts`, `create_note`, `create_contact`, `create_activity`, `update_contact_birthday`, `update_contact_phone`, `update_contact_email`, `update_contact_address`. Read-only: `query_birthday`, `query_phone`, `query_last_note`. Each tool definition includes `name`, `description`, `parameters` (JSON Schema from Zod `.toJsonSchema()`).
  - [x] **System prompt** (`ai-router/src/agent/system-prompt.ts`): define agent identity, supported operations, tool usage rules ("always call search_contacts before any tool that needs a contactId"), language mirroring ("detect the user's language and respond in the same language"), confirmation behavior ("mutating tools will be intercepted for user confirmation — describe what you intend to do clearly"), security rules (carry over from current `graph/system-prompt.ts`). Include today's date for relative date resolution.
  - [x] **Conversation history DB** (`ai-router/src/db/schema.ts`): replace the `conversationTurns` table (compressed summaries) with a `conversationHistory` table: `id` (uuid PK), `userId` (text, indexed), `messages` (jsonb — the full OpenAI message array), `pendingToolCall` (jsonb, nullable — serialized intercepted tool call awaiting confirmation), `updatedAt` (timestamptz). One row per user. Sliding window: before persisting, truncate `messages` to the most recent 40 entries. Oldest messages evicted first. No summarization.
  - [x] **History repository** (`ai-router/src/agent/history-repository.ts`): `getHistory(db, userId) → { messages, pendingToolCall }`, `saveHistory(db, userId, messages, pendingToolCall)`, `clearHistory(db, userId)` — clears both messages and pendingToolCall, `clearStaleHistories(db, cutoffDate)` — for 24h inactivity sweep.
  - [x] **`/clear` command** (`telegram-bridge/src/bot/handlers/clear.ts`): register `/clear` in `telegram-bridge/src/bot/setup.ts` alongside `/start` and `/disconnect`. Handler calls `ai-router` `POST /internal/clear-history` (new endpoint, serviceAuth-protected, caller allowlist: telegram-bridge). Responds to user with a confirmation that context has been reset.
  - [x] **24h inactivity hard-clear**: add a daily BullMQ job in `ai-router` (or a Drizzle cron-like cleanup query run on service startup + interval) that calls `clearStaleHistories(db, now - 24h)`. The existing 30-day `conversation_turns` retention cleanup in data-governance becomes the outer bound.
  - [x] **Wire into process route** (`ai-router/src/app.ts`): replace the current `createApp()` graph invocation (lines 134-192 — builds LangGraph config, calls `graph.invoke()`, extracts `GraphResponse`) with a call to `runAgentLoop()`. The existing `serviceAuth` + `guardrailMiddleware` on the route stays unchanged. Response shape: keep the current `GraphResponse` schema (`type: "text" | "confirmation_prompt" | "disambiguation_prompt" | "error"`, `text`, optional `pendingCommandId`/`version`/`options`) so `delivery` and `telegram-bridge` need zero changes.
  - [x] **Remove LangGraph deps**: uninstall `@langchain/core` (1.1.33), `@langchain/langgraph` (1.2.3), `@langchain/openai` (1.3.0) from `ai-router/package.json`. Add `openai` SDK (pin exact version). Update pnpm catalog if the LangChain entries are defined there.

- [x] **Stage 2: Confirmation Guardrail**

  _Replace the 6-status pending command state machine (draft → pending_confirmation → confirmed → executed → expired → cancelled) with a thin interception layer. When the LLM emits a mutating tool call, the loop pauses, serializes it, and waits for the user's response._

  - [x] **Mutating tool set**: define `MUTATING_TOOLS = new Set(["create_note", "create_contact", "create_activity", "update_contact_birthday", "update_contact_phone", "update_contact_email", "update_contact_address"])` in `ai-router/src/agent/tools.ts`. `search_contacts` and `query_*` tools are NOT mutating.
  - [x] **Interception in agent loop**: when the LLM response contains a `tool_call` where `tool_call.function.name` is in `MUTATING_TOOLS`, do NOT execute it. Instead: (1) validate the tool call arguments against the corresponding Zod schema — if invalid, append a `tool` result message with the validation error and continue the loop so the LLM can self-correct, (2) if valid, serialize the tool call (`{ name, arguments, tool_call_id }`) into `pendingToolCall` on the conversation history row, (3) generate a human-readable description of the action (e.g., "Add note to Elena Yuryevna: 'Today we went to Artillery Park'") from the tool call params, (4) return a `confirmation_prompt` GraphResponse with Confirm/Cancel/Edit buttons. The `pendingCommandId` field in the response can be a hash or UUID derived from the serialized tool call.
  - [x] **Confirm callback handler**: when `POST /internal/process` receives a `callback_action` with `action: "confirm"` and a `pendingToolCall` exists in the user's history: (1) deserialize the pending tool call, (2) execute the tool handler (which calls `scheduler` via the existing `SchedulerClient.execute()` for mutating commands, or `monica-integration` directly for search/query), (3) append the assistant's original tool-call message + the tool result to conversation history, (4) clear `pendingToolCall` from the row, (5) call the LLM one more time with the updated history so it generates a success message ("Done! Note added to Elena."), (6) persist and return. On `action: "cancel"`: clear `pendingToolCall`, append a system-level note ("User cancelled the action") to history, call LLM to generate a cancellation response. On `action: "edit"`: clear `pendingToolCall`, append the user's edit text as a user message, re-enter the agent loop.
  - [x] **Stale pending tool call handling**: if a new user message arrives while `pendingToolCall` is non-null, the LLM sees the pending tool call in its context (as an unresolved assistant message). System prompt instructs: "If you previously proposed an action and the user's new message is unrelated, abandon the pending action and handle the new request." Implementation: clear `pendingToolCall` on any non-callback inbound event, append the abandoned tool call as a cancelled tool result to history.
  - [x] **TTL**: pending tool calls expire after 30 minutes (same as current pending command TTL). If a confirm callback arrives and `pendingToolCall.createdAt` is >30min old, reject with a stale error and clear it.

- [x] **Stage 3: Contact Resolution via Tools**

  _Replace the standalone resolve-contact-ref graph node (797 lines), narrowingContext, unresolvedContactRef, and progressive narrowing with a single `search_contacts` tool the LLM calls when it needs a contactId._

  - [x] **`search_contacts` tool handler** (`ai-router/src/agent/tool-handlers/search-contacts.ts`): accepts `{ query: string }`, calls `monica-integration` `GET /internal/contacts/resolution-summaries` via the existing `ServiceClient` (same as `fetchContactSummaries` in `contact-resolution/client.ts`), runs `matchContacts(query, summaries)` from the existing `contact-resolution/matcher.ts`, returns top 10 results as `Array<{ contactId, displayName, aliases, relationshipLabels, birthdate }>`. The deterministic matcher (with kinship mapping, bidirectional relationship labels, alias scoring, RESOLVED_THRESHOLD, AMBIGUITY_GAP_THRESHOLD) is reused as-is — only the orchestration changes.
  - [x] **System prompt instruction**: "Before calling any tool that requires a `contactId` parameter, call `search_contacts` with the user's contact reference (name, nickname, relationship term like 'mom'). If search returns exactly one result, use that contactId. If multiple results, present them to the user and ask which one they meant. If zero results, ask the user to clarify or offer to create a new contact. Never guess a contactId."
  - [x] **Disambiguation is now conversational**: when `search_contacts` returns multiple results, the LLM generates text like "I found 3 contacts matching 'Elena': Elena Yuryevna (parent), Elena Petrova (colleague), Elena Kim (friend). Which one?". The user replies "Yuryevna" or "the parent one", and the LLM — with full conversation history including the original "add note about Artillery Park" message — calls `create_note(contactId=682023, body="Today we went to Artillery Park")`. The note body is **never lost** because it's in the message history.
  - [x] **What gets removed**: `ai-router/src/graph/nodes/resolve-contact-ref.ts` (797 lines + 1,408-line test), the `narrowingContext` jsonb column and `NarrowingContextSchema` from state, the `unresolvedContactRef` column, the `confirm-then-resolve` flow in execute-action, all progressive narrowing logic (`handleNarrowingRound`, `extractClarificationText`, `buildDisambiguationOptions`, `buildDisambiguationLabel`), the `contactSummariesCache` graph state field, the `contactResolution` graph state field.
  - [x] **What stays**: `ai-router/src/contact-resolution/matcher.ts` (deterministic scoring + kinship map), `ai-router/src/contact-resolution/client.ts` (fetchContactSummaries), `ai-router/src/contact-resolution/resolver.ts` (thresholds). These become the implementation behind the `search_contacts` tool handler.

- [x] **Stage 4: Read-Only Query & Write Tool Handlers**

  _Implement the tool handler functions that the agent loop calls when the LLM emits tool calls._

  - [x] **Read-only handlers** (`ai-router/src/agent/tool-handlers/`): `queryBirthday({ contactId })`, `queryPhone({ contactId })`, `queryLastNote({ contactId })`. Each calls `monica-integration` internal endpoints via `ServiceClient`, returns structured data. These execute immediately in the agent loop (no confirmation gate). The LLM formats the result into natural language.
  - [x] **Mutating handlers** (`ai-router/src/agent/tool-handlers/`): `createNote({ contactId, body })`, `createContact({ firstName, lastName? })`, `createActivity({ contactIds, summary, date? })`, `updateContactBirthday({ contactId, date })`, `updateContactPhone({ contactId, phone })`, `updateContactEmail({ contactId, email })`, `updateContactAddress({ contactId, address })`. Each builds a `ConfirmedCommandPayload` and calls `SchedulerClient.execute()` (existing interface at `ai-router/src/lib/scheduler-client.ts`). The scheduler → monica-integration → MonicaHQ API chain is unchanged.
  - [x] **Zod schemas per tool**: define input validation schemas (e.g., `CreateNoteArgsSchema = z.object({ contactId: z.number().int().positive(), body: z.string().min(1).max(100000) })`). Validation runs before execution in the confirmation flow. On validation failure, the error is returned as a tool result so the LLM can self-correct.
  - [x] **Service boundary enforcement**: read-only tools call `monica-integration` directly (bypassing scheduler). Mutating tools go through `scheduler` via `SchedulerClient.execute()`. This matches the existing service boundary rule: "Read-only queries, clarification prompts, and other non-mutating conversational responses bypass scheduler."

- [x] **Stage 5: Testing & Acceptance Parity**

  _Three testing layers: Vitest unit/integration tests, promptfoo LLM evals, Docker Compose smoke tests._

  - [x] **Vitest unit tests** (`ai-router/src/agent/__tests__/`):
    - Tool handler tests: each handler tested with mocked `ServiceClient`/`SchedulerClient`. Assert correct endpoints called, correct payloads, correct error handling. ~10-15 tests per handler.
    - Confirmation guardrail tests: test interception (mutating tool call → serialized pendingToolCall → confirmation_prompt response), Zod validation rejection (invalid args → tool error result), confirm callback (deserialize → execute → LLM success message), cancel callback (clear → cancellation response), edit callback (clear → re-enter loop), stale TTL rejection.
    - History repository tests: 40-message sliding window (insert 50, verify only last 40 survive), clearHistory, clearStaleHistories with cutoff date.
    - Agent loop tests with mocked LLM: mock `openai.chat.completions.create` to return scripted responses. Test single-turn (user → tool call → result → text), multi-turn (search → disambiguate → create), loop cap (5 iterations), read-only bypass (no confirmation gate).
  - [x] **Vitest integration tests**: multi-turn disambiguation end-to-end with mocked LLM: "Add a note to mum about Artillery Park" → LLM calls search_contacts("mum") → 8 results → LLM asks "which one?" → user says "Elena" → LLM calls search_contacts("Elena mum") → 1 result → LLM calls create_note(contactId=682023, body="Today we went to Artillery Park") → confirmation gate intercepts → confirm callback → scheduler called → LLM generates success. Assert the note body "Artillery Park" is preserved across all turns (the exact bug that motivated this migration).
  - [x] **Promptfoo evals** (`ai-router/promptfoo/`):
    - New provider (`promptfoo/provider.ts`): wraps one turn of the agent loop — calls `openai.chat.completions.create` with the system prompt + tools + utterance, returns `{ text, tool_calls }` as JSON.
    - Adapt the 200-case dataset: write-intents assertions change from `JSON.parse(output).intent === 'mutating_command'` to `JSON.parse(output).tool_calls?.[0]?.function?.name === 'create_note'`. Read-intents assertions check for `query_birthday`/`query_phone`/`query_last_note` tool calls. Clarification cases check that the LLM generates text (no tool call) when it needs more info. Guardrails cases check that out-of-scope messages produce NO tool calls.
    - New multi-turn eval cases: context preservation across search → disambiguate → mutate. Verify the `arguments` field of the final mutating tool call contains the original payload data (note body, date, etc.) from the first user message.
    - New false-positive eval cases: verify mutating tools are NEVER called for read-only queries or greetings.
  - [x] **Smoke tests** (`tests/smoke/`): unchanged. POST /internal/process still returns `GraphResponse` shape. Same HTTP assertions. The response contract does not change.
  - [x] **Acceptance criteria parity**: run the full benchmark. Thresholds: read accuracy ≥ 92%, write accuracy ≥ 90%, contact-resolution precision ≥ 95%, false-positive mutation rate < 1%, p95 latency ≤ 5s text / ≤ 12s voice. Compare against Phase 9 baselines.

- [x] **Stage 6: Dead Code Removal & Cleanup**

  _Remove the LangGraph pipeline, intent classification, pending command state machine, and all supporting code. Update acceptance criteria._

  - [x] Remove `ai-router/src/graph/nodes/execute-action.ts` (~980 lines) and `__tests__/execute-action.test.ts` (2,265 lines).
  - [x] Remove `ai-router/src/graph/nodes/resolve-contact-ref.ts` (~797 lines) and `__tests__/resolve-contact-ref.test.ts` (1,408 lines).
  - [x] Remove `ai-router/src/graph/nodes/format-response.ts` (~141 lines) and `__tests__/format-response.test.ts`.
  - [x] Remove `ai-router/src/graph/nodes/classify-intent.ts` and `__tests__/classify-intent.test.ts`.
  - [x] Remove `ai-router/src/graph/nodes/deliver-response.ts` and `__tests__/deliver-response.test.ts`.
  - [x] Remove `ai-router/src/graph/nodes/persist-turn.ts` and `__tests__/persist-turn.test.ts`.
  - [x] Remove `ai-router/src/graph/nodes/load-context.ts` and `__tests__/load-context.test.ts`.
  - [x] Remove `ai-router/src/graph/intent-schemas.ts` (77 lines) — tool definitions replace structured output schemas.
  - [x] Remove `ai-router/src/graph/system-prompt.ts` — replaced by `agent/system-prompt.ts`.
  - [x] Remove `ai-router/src/graph/llm.ts` — replaced by OpenAI SDK client.
  - [x] Remove `ai-router/src/graph/graph.ts` (StateGraph wiring) and `ai-router/src/graph/state.ts` (ConversationAnnotation, ConversationStateSchema, NarrowingContextSchema).
  - [x] Remove `ai-router/src/pending-command/repository.ts` (321 lines), state machine, confirm helpers, and all tests.
  - [x] Drop the `pendingCommands` table via a Drizzle migration. Drop `narrowingContext` and `unresolvedContactRef` columns. Replace the `conversationTurns` table with the new `conversationHistory` table (if not already done in Stage 1 migration).
  - [x] Remove `@langchain/core`, `@langchain/langgraph`, `@langchain/openai` from `ai-router/package.json` and pnpm catalog. Remove vitest resolve aliases for `@langchain/*` from `ai-router/vitest.config.ts`.
  - [x] Update `context/product/acceptance-criteria.md`: replace "pending commands follow the lifecycle draft → pending_confirmation → confirmed → executed → expired/cancelled" with "mutating tool calls are intercepted for user confirmation before execution; confirmed calls are sent to scheduler". Remove references to narrowingContext, unresolvedContactRef, and the 6-status lifecycle.
  - [x] Verify all remaining tests pass. Run Docker Compose smoke tests against the live stack. Run the full promptfoo benchmark and confirm acceptance thresholds are met.

---

### Phase 11: MCP Server — Monica CRM Tools for AI Clients

_Expose MonicaHQ operations as a standalone MCP (Model Context Protocol) server package. This gives Claude Desktop, Claude Code, and other MCP-compatible AI clients direct access to a user's Monica CRM — independent of the Telegram bot stack. The MCP server is a thin adapter over `@monica-companion/monica-api-lib`, not a gateway into the internal service mesh._

_**Architectural rationale:** The MCP server and `ai-router` serve different audiences with different safety models. `ai-router` orchestrates an unattended Telegram bot flow with multi-service confirmation, idempotency, and scheduler dispatch. The MCP server serves an interactive AI client where the human operator is the confirmation layer. Both reuse `monica-api-lib` for typed Monica access, but the MCP server calls the Monica API directly — it does not route through `monica-integration`, `scheduler`, or `delivery`._

- [ ] **Stage 1: Package Scaffold & Transport**

  _Create the package, wire stdio transport, and verify the server starts and advertises capabilities._

  - [ ] Create `packages/monica-mcp-server` as a new pnpm workspace package. Dependencies: `@modelcontextprotocol/sdk` (pin exact version), `@monica-companion/monica-api-lib` (workspace dependency), `zod`. Dev dependencies: `vitest`, `tsup`, `tsx`.
  - [ ] Add a `src/index.ts` entry point that creates an MCP `Server` instance with stdio transport. Register server metadata: name `monica-crm`, version from `package.json`, capabilities `{ tools: {} }`.
  - [ ] Add configuration via environment variables: `MONICA_BASE_URL` (required), `MONICA_API_TOKEN` (required), `MONICA_TIMEOUT_MS` (optional, default 15000), `MONICA_ALLOW_HTTP` (optional, default false — controls whether non-HTTPS Monica URLs are accepted for self-hosted instances on trusted networks). Validate with Zod on startup; exit with a clear error if required vars are missing.
  - [ ] Add `bin` field in `package.json` pointing to the compiled entry point so the package can be invoked directly as `npx @monica-companion/monica-mcp-server` or via Claude Desktop/Code config.
  - [ ] Add `tsup` build config producing a single CJS bundle with shebang for the bin entry.
  - [ ] Verify the server starts, completes MCP handshake over stdio, and responds to `tools/list` with an empty tool list.

- [ ] **Stage 2: Read-Only Tools**

  _Implement tools that query Monica data without mutations. These are safe to call without confirmation._

  - [ ] **`search_contacts`**: Search contacts by name, nickname, or query string. Params: `query` (string, required). Calls `MonicaApiClient.listContacts({ query })`. Returns top results with id, name, nickname, birthday, last activity date.
  - [ ] **`get_contact`**: Get full contact details by ID. Params: `contact_id` (number, required). Calls `MonicaApiClient.getContactWithFields(id)`. Returns contact with career, dates, addresses, contact fields, recent notes, relationships, tags.
  - [ ] **`list_contacts`**: List all contacts with optional pagination. Params: `page` (number, optional), `limit` (number, optional, max 100). Calls `MonicaApiClient.listContacts()`. Returns paginated contact list with total count.
  - [ ] **`list_contact_notes`**: List notes for a contact. Params: `contact_id` (number, required), `page` (number, optional). Calls `MonicaApiClient.listContactNotes(contactId)`. Returns paginated notes.
  - [ ] **`get_upcoming_reminders`**: Get reminders for a given month offset. Params: `month_offset` (number, optional, default 0 = current month). Calls `MonicaApiClient.getUpcomingReminders(monthOffset)`. Returns reminder list with planned dates and contact info.
  - [ ] **`list_contact_addresses`**: List addresses for a contact. Params: `contact_id` (number, required). Calls `MonicaApiClient.listContactAddresses(contactId)`. Returns address list.
  - [ ] **`list_genders`**: List available genders (needed for contact creation). No params. Calls `MonicaApiClient.listGenders()`. Returns gender list with IDs.
  - [ ] **`list_contact_field_types`**: List available contact field types (email, phone, etc.). No params. Calls `MonicaApiClient.listContactFieldTypes()`. Returns field type list with IDs.
  - [ ] Add Vitest unit tests for each tool handler with mocked `MonicaApiClient`. Assert correct client method called, correct params passed, correct MCP tool result shape returned. Test error handling: Monica API errors mapped to MCP tool errors with clear messages.

- [ ] **Stage 3: Mutating Tools**

  _Implement tools that create or update Monica data. These call the Monica API directly — the human operating the AI client is the confirmation layer._

  - [ ] **`create_contact`**: Create a new contact. Params: `first_name` (string, required), `last_name` (string, optional), `nickname` (string, optional), `gender_id` (number, required). Calls `MonicaApiClient.createContact()`. Returns created contact.
  - [ ] **`update_contact`**: Update an existing contact. Params: `contact_id` (number, required), plus same fields as create. Calls `MonicaApiClient.updateContact()`. Returns updated contact.
  - [ ] **`delete_contact`**: Delete a contact. Params: `contact_id` (number, required). Calls `MonicaApiClient.deleteContact()`. Returns deletion confirmation.
  - [ ] **`create_note`**: Add a note to a contact. Params: `contact_id` (number, required), `body` (string, required), `is_favorited` (boolean, optional). Calls `MonicaApiClient.createNote()`. Returns created note.
  - [ ] **`create_activity`**: Log an activity with contacts. Params: `contact_ids` (number[], required), `summary` (string, required), `description` (string, optional), `happened_at` (string YYYY-MM-DD, required), `activity_type_id` (number, optional). Calls `MonicaApiClient.createActivity()`. Returns created activity.
  - [ ] **`create_reminder`**: Create a reminder for a contact. Params: `contact_id` (number, required), `title` (string, required), `description` (string, optional), `initial_date` (string YYYY-MM-DD, required), `frequency_type` (enum: one_time/week/month/year, required), `frequency_number` (number, required). Calls `MonicaApiClient.createReminder()`. Returns created reminder.
  - [ ] **`update_contact_career`**: Update job and company. Params: `contact_id` (number, required), `job` (string, optional), `company` (string, optional). Calls `MonicaApiClient.updateContactCareer()`. Returns updated contact.
  - [ ] **`create_contact_field`**: Add a phone, email, or other contact field. Params: `contact_id` (number, required), `contact_field_type_id` (number, required), `data` (string, required — the value). Calls `MonicaApiClient.createContactField()`. Returns created field.
  - [ ] **`create_address`**: Add an address to a contact. Params: `contact_id` (number, required), `name` (string, optional — label like "home"), `street` (string, optional), `city` (string, optional), `province` (string, optional), `postal_code` (string, optional), `country` (string, required — ISO 3166-1 alpha-2). Calls `MonicaApiClient.createAddress()`. Returns created address.
  - [ ] Add Vitest unit tests for each mutating tool handler. Assert correct client method called with correct payload shape. Test Zod validation: invalid params (missing required fields, wrong types) return MCP error before calling the client.

- [ ] **Stage 4: MCP Resources (Optional)**

  _Expose Monica data as browsable MCP resources for clients that support resource browsing._

  - [ ] **`monica://contacts`** resource: lists all contacts as a resource collection. Each entry has URI `monica://contacts/{id}`, name = display name, description = nickname + relationship summary. Uses `MonicaApiClient.getAllContacts()` with pagination.
  - [ ] **`monica://contacts/{id}`** resource template: returns a single contact's full details as structured text (name, dates, career, addresses, recent notes, relationships). Uses `MonicaApiClient.getContactWithFields(id)`.
  - [ ] Add resource capability to server metadata: `{ tools: {}, resources: {} }`.
  - [ ] Add unit tests for resource handlers.

- [ ] **Stage 5: Error Handling, Logging & Polish**

  _Harden the server for real-world use: structured error responses, connection validation, and documentation._

  - [ ] Map `MonicaApiError` (4xx/5xx from Monica), `MonicaNetworkError` (timeouts, DNS), and `MonicaPaginationCapError` to MCP tool error responses with actionable messages (e.g., "Monica returned 401 — check your API token", "Connection timed out after 15s — verify your Monica URL is reachable").
  - [ ] Add a startup connection check: on first tool call (lazy), call `MonicaApiClient.listGenders()` as a lightweight connectivity probe. Cache the result. Log success/failure. Do not block server startup — fail on first actual tool call with a clear message if Monica is unreachable.
  - [ ] Add a `README.md` to the package with: what it does, prerequisites (Monica instance + API token), configuration (env vars), usage with Claude Desktop (JSON config snippet), usage with Claude Code (`claude mcp add` command), available tools list.
  - [ ] Add an example Claude Desktop config snippet in the README:
    ```json
    {
      "mcpServers": {
        "monica-crm": {
          "command": "npx",
          "args": ["@monica-companion/monica-mcp-server"],
          "env": {
            "MONICA_BASE_URL": "https://app.monicahq.com",
            "MONICA_API_TOKEN": "your-token-here"
          }
        }
      }
    }
    ```
  - [ ] Verify full tool set works end-to-end against a real Monica instance (manual verification, not CI).

- [ ] **Stage 6: Testing & Release**

  - [ ] Vitest unit tests for all tool handlers (mocked `MonicaApiClient`) — already added per-stage above.
  - [ ] Vitest integration test: spin up the MCP server as a child process over stdio, send `initialize` → `tools/list` → `tools/call` (search_contacts with a mocked client) → verify correct MCP protocol responses.
  - [ ] Verify `tsup` build produces a working standalone bundle. Test `npx` invocation from a clean directory.
  - [ ] Add the package to the pnpm workspace `pnpm-workspace.yaml`.
  - [ ] Run Biome lint and format checks on the new package.

---

### Future Improvements: MCP Server Hardening for Public Deployment

_The Phase 11 MCP server uses stdio transport with env-var credentials — suitable for personal/local use. The following improvements enable multi-user remote deployment, auditability, and enterprise readiness. These are not part of the V1 scope._

#### Auth Tier 1: HTTP Transport with Static Bearer Token

_Minimum viable remote deployment. One user, one token, no browser flow._

- [ ] Add Streamable HTTP transport (alongside stdio) behind a `--transport http --port 8080` CLI flag.
- [ ] Accept a pre-shared `Authorization: Bearer <token>` header on all HTTP requests. Token configured via `MCP_AUTH_TOKEN` env var.
- [ ] Reject requests without a valid Bearer token with HTTP 401.
- [ ] Support Claude Code `--header` flag: `claude mcp add --transport http monica https://host:8080/mcp --header "Authorization: Bearer ${TOKEN}"`.

#### Auth Tier 2: OAuth 2.1 (MCP Spec-Compliant)

_Multi-user remote deployment. Each user authenticates with their own Monica credentials. Follows the MCP authorization specification (2025-11-25)._

- [ ] Implement the MCP server as an OAuth 2.1 Resource Server per the MCP spec.
- [ ] Implement Protected Resource Metadata (RFC 9728) discovery at `/.well-known/oauth-protected-resource`.
- [ ] Support a pluggable Authorization Server: the MCP server delegates authentication to an external OAuth provider (e.g., the Monica instance itself if it supports OAuth, or a standalone IdP like Keycloak/Authentik).
- [ ] Support Dynamic Client Registration (RFC 7591) as a fallback and Client ID Metadata Documents (CIMD) as the primary client registration method per the 2025-11-25 spec.
- [ ] Require PKCE (S256) for all authorization code grants.
- [ ] Bind tokens to the MCP server resource via Resource Indicators (RFC 8707) to prevent token misuse.
- [ ] Map the authenticated user identity to their Monica base URL + API token (stored in a server-side credential store or derived from the OAuth token claims).
- [ ] Support token refresh and step-up authorization for mutating operations if the OAuth provider supports scopes (e.g., `monica:read` vs `monica:write`).

#### Auth Tier 3: Enterprise Authorization Extensions

_Corporate governance: IdP-mediated access control, audit trails, centralized policy._

- [ ] Support the Client Credentials grant (SEP-1046) for machine-to-machine access: automated agents, CI pipelines, or cron jobs that need Monica access without a human in the loop.
- [ ] Support Enterprise-Managed Authorization / Cross App Access (SEP-990): an enterprise IdP (Okta, Entra ID, etc.) interposes policy controls on MCP OAuth flows, enabling centralized approval, audit logging, and scope restriction.
- [ ] Add audit logging: log all tool calls with caller identity, tool name, params (redacted), timestamp, and result status. Route audit events through the observability stack (OpenTelemetry).

#### Operational Improvements

- [ ] **Rate limiting**: Per-user rate limiting on HTTP transport to prevent abuse. Configurable limits via env vars.
- [ ] **Request validation**: Enforce request-size limits on HTTP transport to prevent oversized payloads.
- [ ] **Health endpoint**: Add an internal `/health` endpoint for Docker/Kubernetes liveness probes (HTTP transport only).
- [ ] **Containerized deployment**: Add a `Dockerfile` for the MCP server. Publish to the project's container registry. Add a Docker Compose profile for running the MCP server alongside the existing stack.
- [ ] **npm publishing**: Publish `@monica-companion/monica-mcp-server` to npm so users can run it via `npx` without cloning the monorepo.
- [ ] **MCP resource subscriptions**: Implement `resources/subscribe` so AI clients get notified when contact data changes (requires polling Monica on an interval).
