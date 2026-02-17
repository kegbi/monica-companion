# Plain-English PRD: Telegram-First Personal Assistant (Monica-Backed)

Date: 2026-02-15

## 1) Product Goal

Build a personal assistant system that starts with Telegram as the only user channel, uses Monica as the relationship data source, and is organized as separate services so each part can evolve independently.

The first version should be command-first (no free-form AI dependency), while leaving room to add AI guidance later.

## 2) What This First Version Includes

- Telegram bot for private chats only.
- Command-based interaction.
- Monica-backed contact, note, and reminder operations.
- Scheduled reminder digests sent to Telegram.
- Streaming responses for better user experience.
- Voice-to-text support so voice messages can become text commands.
- Strong security and observability foundations.

## 3) What This First Version Does Not Include

- Group chat support.
- Multiple chat bridges (only Telegram for now).
- Full autonomous AI agent behavior by default.

## 4) Monica API Routes to Support

These are the Monica routes we should support in the first product scope, grouped by feature purpose.
Route-level request/response contracts and examples are documented in `docs/monica-api-contracts.md`.

### Contacts

- List contacts.
- Search contacts by name.
- Get one contact by ID.
- Update contact basic details.
- Update contact work/career details.

Why:
- The bot needs to find and update real people quickly.
- Search is essential for command flows that start from a name.

### Reminders

- List reminders (including upcoming dates).

Why:
- Reminder digest is a core user value.
- Daily and near-term event views depend on this data.

### Notes

- List notes.
- List notes for a specific contact.
- Get one note by ID.
- Create a note.
- Update a note.
- Delete a note.

Why:
- Notes are a natural extension of personal relationship management.
- Useful for both direct commands and future AI-assisted memory summaries.

## 5) Services and Why They Exist

### 1. Telegram Bot Service

Purpose:
- Connect to Telegram, accept user input, and return replies.

Why separate:
- Telegram-specific behavior should not be mixed with business logic.
- Makes it easy to add other channels later without touching core logic.

Responsibilities:
- Private chats only.
- Command parsing.
- Voice message intake.
- Streaming reply rendering.
- Forwarding outbound notifications to Delivery service.

### 2. Assistant Core Service

Purpose:
- Handle command meaning and business workflows.

Why separate:
- Keeps assistant behavior independent from Telegram APIs.
- Central place for rules, workflows, and response formatting.

Responsibilities:
- Execute command flows.
- Decide which Monica-backed action to run.
- Build user-facing response text.
- Optionally host future AI assistant layer.

### 3. Monica Integration Service

Purpose:
- Act as a clean gateway to Monica.

Why separate:
- External API complexity should be isolated.
- Easier to change Monica usage without changing bot/core behavior.

Responsibilities:
- Perform contact/reminder/note operations.
- Handle reliability concerns (timeouts, retries, pagination).
- Standardize and validate incoming/outgoing payloads.

### 4. Voice Transcription Service

Purpose:
- Convert Telegram voice messages into text that command flows can understand.

Why separate:
- Speech handling is a distinct concern with its own reliability and cost profile.
- Can be swapped between providers later.

Responsibilities:
- Accept audio reference.
- Return transcribed text.
- Return clear user-facing errors if transcription fails.

### 5. Scheduler Service (Cron Jobs)

Purpose:
- Run scheduled tasks independently from live chat requests.

Why separate:
- Scheduled work should be reliable even when bot traffic is low/high.
- Better operational control and failure handling.

Responsibilities:
- Run daily reminder digest jobs.
- Retry failed jobs safely.
- Track job status and delivery results.

### 6. Delivery Service

Purpose:
- Send system-generated outputs (like digests) to Telegram.

Why separate:
- Keeps scheduler and core logic simpler and easier to test.
- Isolates sending failures from command processing.
- Reusable for future channels later.

Responsibilities:
- Message formatting for outbound delivery.
- Outbound message sending to Telegram.
- Delivery audit records.

### 7. Security and Access Control Layer

Purpose:
- Enforce identity, authorization, abuse protection, and data safety across all services.

Why this is a shared layer, not a standalone app:
- Security rules must be applied at every boundary.
- Keeping it as shared policy and middleware avoids a fragile central bottleneck.
- It stays consistent while each service still validates requests it receives.

Responsibilities:
- Service-to-service authentication.
- Client-facing authentication and verification.
- Duplicate request protection.
- Per-user/chat rate limiting.
- Secret management policy.
- Sensitive data redaction.

### 8. Observability Layer

Purpose:
- Provide logs, traces, and metrics to operate safely.

Why this is a shared layer:
- Operations and troubleshooting need consistent telemetry in every service.

Responsibilities:
- Structured logging.
- Request/job tracing.
- Health checks.
- Error and latency dashboards.

Suggested stack:
- Logging: `structlog` (or Python stdlib JSON logging).
- Tracing: OpenTelemetry.
- Metrics: Prometheus + Grafana.

## 6) Service-to-Service Security and Network Model

### Network model

- Yes, Docker Compose private networking is a valid approach for this setup.
- Services should communicate over internal network addresses only.
- Only truly client-facing entry points should be exposed externally.
- With Telegram polling mode, no public inbound endpoint is required for Telegram itself.

### Authentication model

- Do not rely only on client-facing verification.
- Use two layers of trust:
  - Client-facing verification for end-user channels (Telegram now, web app later).
  - Service-to-service authentication for every internal call.

### Practical service flow

- Telegram Bot to Assistant Core:
  - Bot authenticates itself when calling Core.
  - Core verifies caller identity and permissions.
- Scheduler to Assistant Core:
  - Scheduler authenticates as a machine caller.
  - Core enforces job-level authorization and idempotency.
- Assistant Core to Delivery:
  - Core authenticates when requesting outbound sends.
  - Delivery only accepts trusted internal callers.
- Delivery to Telegram:
  - Delivery owns outbound sending and bot token usage.

### Authorization policy

- Each service should explicitly allow only expected callers.
- Internal endpoints should be closed to anonymous traffic.
- Security checks should be enforced per endpoint, not only at one edge.

## 7) Telegram Bot Product Requirements

- Must work in private chats only.
- Must reject or leave group chats.
- Must operate through commands first.
- Must support streamed replies for long operations.
- Must support voice-to-text so voice input can map to commands.
- Must return clear user guidance when command syntax is wrong.

## 8) Command-First Functional Scope

Initial command families:

- Help and onboarding commands.
- Contact lookup and update commands.
- Birthday update commands.
- Reminder digest commands.
- Notes read/write commands.

Future expansion:
- Optional AI layer that can interpret natural language and map it to these command flows.

## 9) Scheduler (Cron) Product Requirements

- Must run at defined times (for example, daily morning digest).
- Must support per-user or per-chat schedule settings.
- Must avoid duplicate sends for the same schedule window.
- Must retry failed sends with sensible limits.
- Must expose job run history and failure reasons.

## 10) Reliability Requirements

- Timeout handling for all external calls.
- Controlled retry behavior for temporary failures.
- Safe pagination handling for large Monica datasets.
- Strict payload validation for inbound/outbound requests.
- Graceful fallback messages to users on failures.

## 11) Security Requirements

- Use service authentication between bot, scheduler, core, and delivery.
- Keep internal endpoint authorization strict (allow only known callers).
- Enforce request deduplication to prevent repeated side effects.
- Enforce rate limiting per chat/user.
- Keep secrets out of logs and responses.
- Restrict bot behavior to allowed chat contexts.
- Rotate secrets/credentials on a defined schedule.

## 12) Observability Requirements

- Every user request should be traceable end-to-end.
- Every scheduled job should have status, timing, and error visibility.
- Every inter-service call should be traceable.
- Logs should be structured and searchable.
- Health endpoints should exist for bot, core, scheduler, and delivery.
- Alerting should be possible for repeated failures and high latency.

## 13) Acceptance Criteria

The first release is successful when:

- A user in a private Telegram chat can run command-based contact/reminder/note actions.
- Reminder digests can be generated and delivered on schedule.
- Voice input can be transcribed and processed as text commands.
- Streaming replies work for long-running operations.
- Security controls (auth, dedupe, rate limiting, internal authorization) are active.
- Logs/traces/metrics make incidents diagnosable.

## 14) Rollout Strategy

- Phase 1: command-only Telegram bot + Monica contacts/reminders.
- Phase 2: notes + transcription improvements + scheduler + separate delivery service.
- Phase 3: optional AI interpretation layer on top of existing command flows.

## 15) Implementation Stack and Deployment Baseline

### Runtime and language

- Primary language: Python (3.12+).
- Service style: independently deployable Python services.

### Recommended Python libraries

- API services (Bot/Core/Delivery/Monica Integration): FastAPI + Uvicorn.
- Data contracts and validation: Pydantic v2.
- HTTP clients (Telegram/Monica/internal services): `httpx` (async).
- Retries/backoff for external calls: `tenacity`.
- Telegram Bot service: `aiogram` (polling mode for v1).
- Scheduler service: `APScheduler` (separate scheduler container/service).
- Caching/rate-limit/idempotency primitives: `redis` (`redis-py`).
- Structured logging: `structlog` (or stdlib JSON logging if preferred).
- Tracing/metrics: `opentelemetry-sdk` + `prometheus-client`.
- Testing: `pytest`, `pytest-asyncio`, `respx` (mocked HTTP), and `httpx` test clients.

### Deployment model

- Deploy with Docker Compose.
- One container per service (Bot, Core, Monica Integration, Voice, Scheduler, Delivery).
- Keep service-to-service traffic on a private Compose network.
- Expose only required entry points to the host.
- Prefer Telegram polling mode for v1 (no public webhook endpoint required).

### Testing policy (Monica integration)

- Use mock/stub Monica responses in unit/integration tests.
- Do not call a real Monica instance from automated tests.
- Keep representative fixtures aligned with `docs/monica-api-contracts.md`.
