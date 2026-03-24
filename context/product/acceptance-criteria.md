# Acceptance Criteria: Monica Companion V1

The first release is successful when all of the following are met.

---

## Core Functionality

- [ ] A user in a private Telegram chat can send a voice message describing a contact action, and the system transcribes, parses, and executes it against MonicaHQ after confirmation or safe auto-confirmation.
- [ ] A user can send a text message with the same result as voice.
- [ ] Voice and text input works in any language supported by OpenAI `gpt-4o-transcribe` (transcription) and `gpt-5.4-mini` (intent parsing and NLU).
- [ ] A labeled benchmark of at least 200 utterances exists before release: 100 write intents, 60 read/query intents, and 40 clarification/disambiguation turns, including at least 50 voice samples.
- [ ] Read/query accuracy on that benchmark is at least 92%.
- [ ] Write intent and action-proposal accuracy on that benchmark is at least 90%.
- [ ] Unambiguous contact-resolution precision on that benchmark is at least 95%.
- [ ] False-positive mutating executions remain below 1% on that benchmark. Low-confidence or ambiguous writes must clarify or require confirmation instead of executing.
- [ ] p95 time to first actionable response is at most 5 seconds for text and 12 seconds for voice in the staging environment.
- [ ] When contact resolution is ambiguous, the bot presents inline keyboard buttons for disambiguation.
- [ ] Users can create contacts, add notes, log activities, update key fields (birthday, phone, email, address), and query contact info using simple direct lookups.
- [ ] Supported Monica-backed operations in V1 are limited to contact create, note create, activity create, contact basic-detail updates (birthday, phone, email, address), and simple direct lookups such as birthday, phone, or last note.
- [ ] Typing indicators are shown while the AI processes a request.

## Command Lifecycle

- [ ] Every mutating tool call is intercepted by the agent loop and stored as a pending tool call in conversation history, with a `pendingCommandId`, version, and TTL.
- [ ] The user receives a confirmation prompt with confirm/cancel/edit inline buttons before any mutation executes.
- [ ] Stale, expired, or identity-mismatched confirmations are rejected with a clear user-facing message.
- [ ] Confirmed mutations are dispatched to the scheduler for execution via the Monica API.
- [ ] Read-only queries, clarification prompts, and other non-mutating conversational responses bypass `scheduler` and go directly from `ai-router` to outbound delivery.

## Onboarding & Multi-User

- [ ] A new user can start the Telegram bot, receive a 15-minute one-time setup link, and complete onboarding via the Astro web UI.
- [ ] At most one active setup link exists per Telegram user. Setup links are signed, bound to the Telegram user identity and onboarding step, consumed on successful use, invalidated on reissue or cancellation, and rejected if replayed or expired.
- [ ] Onboarding submission is protected by HTTPS plus CSRF/origin checks.
- [ ] Credentials are never sent through Telegram chat.
- [ ] Monica base URLs are normalized and stored canonically.
- [ ] Hosted defaults reject `http://`, localhost, RFC1918, link-local, and blocked redirect targets for Monica base URLs.
- [ ] Multiple users can operate independently, each connected to their own MonicaHQ v4 instance.
- [ ] Each user's data, credentials, and configuration are fully isolated.
- [ ] Each user explicitly selects or confirms an IANA timezone during onboarding.

## Scheduled Reminders

- [ ] A user can configure a daily or weekly event summary at a chosen local time in an IANA timezone.
- [ ] Reminder digests are generated and delivered on schedule via Telegram.
- [ ] Duplicate sends for the same schedule window are prevented with a deterministic dedupe key.
- [ ] If a scheduled local time is skipped by DST, the reminder fires once at the next valid local minute.
- [ ] If a scheduled local time repeats during DST fall-back, the reminder still sends only once for that window.
- [ ] If the scheduler recovers within 6 hours of a missed reminder window, it sends at most one catch-up digest; otherwise that window is skipped.
- [ ] Failed reminder deliveries are retried with exponential backoff.
- [ ] When retries are exhausted, the user receives a Telegram error notification.
- [ ] Job run history and failure reasons are visible in the observability stack.

## Security

- [ ] Service-to-service authentication is active on all internal endpoints using signed JWTs.
- [ ] Each service enforces per-endpoint caller allowlists.
- [ ] Only the Telegram webhook and onboarding web UI are publicly exposed in V1.
- [ ] Internal APIs and `/health` endpoints are not publicly routed.
- [ ] Telegram webhook ingress requires the configured `X-Telegram-Bot-Api-Secret-Token`, enforces request-size limits, and applies rate limiting.
- [ ] MonicaHQ API keys are encrypted at rest in PostgreSQL.
- [ ] Only `monica-integration` can obtain decrypted Monica credentials, through an audited narrow endpoint.
- [ ] Sensitive data is redacted from logs, traces, queue payloads, dead letters, and support tooling.
- [ ] Duplicate request protection prevents repeated side effects from Telegram retries.
- [ ] The bot operates in private chats only.
- [ ] A secret rotation policy is defined and documented.
- [ ] Shared OpenAI-key usage is protected with per-user request-size limits, concurrency caps, budget alarms, and an operator kill switch/degraded mode.

## Reliability

- [ ] All external API calls (MonicaHQ, OpenAI, Telegram) have timeout handling.
- [ ] Transport-level quick retries are implemented only in the edge client for that dependency; scheduler owns job-level retries only.
- [ ] Large Monica datasets are handled with safe pagination.
- [ ] Monica redirects to blocked networks are rejected.
- [ ] Users receive graceful fallback messages when operations fail.
- [ ] Strict payload validation is enforced on all inbound and outbound service contracts.

## Data Governance

- [ ] Conversation state is minimized to what is needed for active workflows and recent context.
- [ ] Voice audio is not retained after transcription completes, aside from minimal operational metadata.
- [ ] Conversation history records have a documented retention limit of 30 days after last activity.
- [ ] Command logs and delivery audits have a documented retention limit of 90 days.
- [ ] Traces, logs, and dead-letter payloads have a documented retention limit of 14 days.
- [ ] Disconnecting an account deletes Monica credentials immediately and schedules user-specific conversational/audit data for purge within 30 days, excluding minimal security audit entries.

## Observability

- [ ] Every user request is traceable end-to-end with a correlation ID.
- [ ] Every scheduled job has status, timing, retry, and error visibility.
- [ ] Every inter-service call is traceable.
- [ ] Logs are structured, searchable, and free of sensitive data.
- [ ] Every application service exposes an internal-only `/health` endpoint.
- [ ] Grafana dashboards exist for service health, error rates, API latency, OpenAI budget burn, and job queue status.
- [ ] Alerting is configured for repeated failures, quota exhaustion, and high latency.

## Delivery

- [ ] All outbound messages flow through the delivery service as connector-neutral message intents.
- [ ] Connectors own platform-specific formatting and sending.
- [ ] Delivery audit records are kept with what was sent, when, to whom, through which connector, and whether delivery succeeded or failed.

## Testing & Release Gates

- [ ] CI uses mocked Monica contract tests and does not call a real Monica instance.
- [ ] A controlled real-Monica smoke test suite exists outside normal CI, such as nightly or release-candidate execution.
- [ ] LLM smoke tests cover command parsing (all V1 command types), multi-stage dialog (clarification round-trips), context preservation (pronoun/reference resolution across turns), and out-of-scope rejection scenarios.
- [ ] Production release requires the latest controlled real-Monica smoke suite and LLM smoke suite to pass, with all acceptance-criteria thresholds met.
