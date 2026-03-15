# Acceptance Criteria: Monica Companion V1

The first release is successful when all of the following are met.

---

## Core Functionality

- [ ] A user in a private Telegram chat can send a voice message describing a contact action, and the system transcribes, parses, and executes it against MonicaHQ after confirmation.
- [ ] A user can send a text message with the same result as voice.
- [ ] Voice and text input works in any language supported by OpenAI Whisper/GPT.
- [ ] The AI correctly identifies the intended contact and proposes the right action at least 90% of the time.
- [ ] When contact resolution is ambiguous (e.g., multiple "Sherry"s), the bot presents inline keyboard buttons for disambiguation.
- [ ] Users can create contacts, add notes, log activities, update key fields (birthday, phone, email, address), and query contact info (simple direct lookups).
- [ ] Typing indicators are shown while the AI processes a request.

## Onboarding & Multi-User

- [ ] A new user can start the Telegram bot, receive a setup link, and complete onboarding via the Astro web UI (entering MonicaHQ instance URL + API key + preferences).
- [ ] Credentials are never sent through Telegram chat.
- [ ] Multiple users can operate independently, each connected to their own MonicaHQ v4 instance (self-hosted or app.monicahq.com).
- [ ] Each user's data, credentials, and configuration are fully isolated.

## Scheduled Reminders

- [ ] A user can configure a daily or weekly event summary (birthdays, reminders) at a chosen time.
- [ ] Reminder digests are generated and delivered on schedule via Telegram.
- [ ] Duplicate sends for the same schedule window are prevented (idempotency).
- [ ] Failed reminder deliveries are retried with exponential backoff.
- [ ] When retries are exhausted, the user receives a Telegram error notification.
- [ ] Job run history and failure reasons are visible in the observability stack.

## Security

- [ ] Service-to-service authentication is active on all internal endpoints (signed JWT).
- [ ] Each service enforces caller allowlists — only expected callers are accepted.
- [ ] MonicaHQ API keys are encrypted at rest (AES-256) in PostgreSQL.
- [ ] Sensitive data (API keys, personal contact info) is redacted from all logs.
- [ ] Duplicate request protection (idempotency) prevents repeated side effects from Telegram retries.
- [ ] The bot operates in private chats only — group messages are rejected.
- [ ] A secret rotation policy is defined and documented.

## Reliability

- [ ] All external API calls (MonicaHQ, OpenAI, Telegram) have timeout handling.
- [ ] Transient failures on external calls are retried with exponential backoff.
- [ ] Large Monica datasets are handled with safe pagination.
- [ ] Users receive graceful fallback messages when operations fail.
- [ ] Strict payload validation is enforced on all inbound/outbound requests (Zod schemas).

## Observability

- [ ] Every user request is traceable end-to-end (distributed tracing via OpenTelemetry).
- [ ] Every scheduled job has status, timing, and error visibility.
- [ ] Every inter-service call is traceable.
- [ ] Logs are structured, searchable, and free of sensitive data.
- [ ] Every application service exposes a `/health` endpoint.
- [ ] Grafana dashboards exist for service health, error rates, API latency, and job queue status.
- [ ] Alerting is possible for repeated failures and high latency.

## Delivery

- [ ] All outbound messages (interactive responses, scheduled digests, error notifications) flow through the delivery service.
- [ ] Delivery audit records are kept (what was sent, when, to whom, success/failure).
