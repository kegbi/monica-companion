# Service Architecture: Monica Companion

Logical architecture and initial Telegram-only V1 deployment profile: **16 containers** — 8 application + 3 infrastructure + 5 observability.

---

## Application Services

### telegram-bridge

**Container:** `telegram-bridge`

**Purpose:** Connect to Telegram, accept user input, and return replies. All Telegram-specific behavior is isolated here.

**Why separate:** Telegram API details, inline keyboards, webhook handling, and file retrieval should not leak into business logic.

**Responsibilities:**
- Enforce private-chat-only policy and reject group messages.
- Receive Telegram webhook traffic through Caddy and require the configured `X-Telegram-Bot-Api-Secret-Token` before business logic runs.
- Enforce ingress request-size limits and connector-level rate limiting.
- Detect content type and normalize inbound text, callback, and voice interactions into internal envelopes with correlation metadata.
- Resolve Telegram file IDs, fetch the actual media, and send a connector-neutral transcription request to `voice-transcription`.
- Render Telegram-specific outbound formatting (inline keyboards, markdown, typing indicators, error phrasing).
- Accept connector-neutral outbound intents from `delivery` and send them via the Telegram Bot API.

**Allowed callers:** Caddy (public webhook only), `delivery`.

---

### ai-router

**Container:** `ai-router`

**Purpose:** Handle natural language understanding, contact resolution, conversation context, and pending-command orchestration.

**Why separate:** AI prompting, conversation state, and command synthesis evolve independently from connector and Monica integration concerns.

**Responsibilities:**
- Parse free-form text into structured command drafts using LangGraph TS plus OpenAI `gpt-5.4-mini` (with Zod structured outputs, medium reasoning effort).
- Detect language and generate user-facing copy in the same language.
- Resolve contacts against the minimized `ContactResolutionSummary` projection exposed by `monica-integration`.
- Own pending-command state in PostgreSQL, including correlation IDs, version numbers, source message references, TTL, and the lifecycle `draft -> pending_confirmation -> confirmed -> executed -> expired/cancelled`.
- Handle clarifications, edits, and disambiguation by updating the existing draft version instead of creating unrelated commands.
- Auto-confirm drafts only when user preferences and confidence thresholds allow it.
- Emit connector-neutral outbound message intents to `delivery` for clarification prompts, confirmation prompts, query responses, and stale-action rejections.
- Enqueue only confirmed execution payloads to `scheduler`.

**Allowed callers:** `telegram-bridge` and future connectors.

---

### voice-transcription

**Container:** `voice-transcription`

**Purpose:** Convert audio input into text that the AI router can process.

**Why separate:** Speech handling has its own cost, latency, and provider lifecycle.

**Responsibilities:**
- Accept a connector-neutral transcription request consisting of either binary audio upload or a short-lived fetch URL plus media metadata.
- Never accept Telegram-specific file IDs or connector-native handles directly.
- Transcribe through OpenAI `gpt-4o-transcribe` (default) or `whisper-1` (legacy fallback) using the `/v1/audio/transcriptions` endpoint with `json` response format, including timeout handling and language detection.
- Return normalized text plus confidence/error metadata.
- Return clear user-safe failures when transcription cannot complete.

**Allowed callers:** `telegram-bridge` and future connectors.

---

### monica-integration

**Container:** `monica-integration`

**Purpose:** Act as the anti-corruption layer for MonicaHQ v4. All Monica-specific behavior and outbound egress risk is isolated here.

**Why separate:** Monica API contracts, retries, pagination, and user-supplied base URLs are all high-risk external integration concerns.

**Responsibilities:**
- Perform contact, note, activity, reminder, and lookup operations against MonicaHQ v4.
- Resolve Monica credentials only through the audited credential port exposed by `user-management`.
- Normalize and persist canonical Monica base URLs.
- Require HTTPS by default and reject loopback, RFC1918, link-local, and blocked redirect targets after DNS resolution. Trusted single-tenant deployments may opt into a documented override outside the hosted default.
- Own transport-level retries, timeout handling, pagination, and Monica-specific error mapping. Quick retries are capped here; scheduler does not duplicate them.
- Expose a minimized Monica-agnostic contact projection to `ai-router` for contact matching and disambiguation.
- Validate all Monica-facing payloads against typed contracts from `@monica-companion/monica-api-lib`.

**Allowed callers:** `scheduler` for execution endpoints, `ai-router` for read-only contact-resolution endpoints.

---

### scheduler

**Container:** `scheduler`

**Purpose:** Execute confirmed commands and scheduled reminder jobs through one reliable path.

**Why separate:** Job execution, retries, and schedule handling should be isolated from live conversational traffic.

**Responsibilities:**
- Accept confirmed execution payloads from `ai-router`.
- Do not handle read-only queries, clarification prompts, or other non-mutating conversational traffic.
- Execute Monica-backed actions through `monica-integration`.
- Own business/job retries, exponential backoff ceilings, dead-letter handling, and idempotency enforcement.
- Run daily and weekly reminder jobs using the user's stored IANA timezone and configured local wall-clock time.
- Compute schedule-window dedupe keys and prevent duplicate sends for the same user/window.
- Apply downtime catch-up rules: if recovery happens within 6 hours of the scheduled local time, send one catch-up digest; otherwise skip that window.
- Emit connector-neutral outbound result intents and failure notifications to `delivery`.
- Track execution status, timing, retry count, and terminal outcome for observability.

**Allowed callers:** `ai-router` (confirmed commands), internal cron triggers.

---

### delivery

**Container:** `delivery`

**Purpose:** Route connector-neutral outbound message intents to the correct connector.

**Why separate:** Outbound delivery routing, auditing, and connector selection should be isolated from both AI logic and job execution.

**Responsibilities:**
- Receive connector-neutral outbound message intents from `ai-router` and `scheduler`.
- Resolve the destination connector and account routing metadata.
- Forward the payload to the correct connector service (`telegram-bridge` in V1).
- Never own platform-specific formatting.
- Persist delivery audit records with correlation ID, connector, recipient routing metadata, status, and failure reason.

**Allowed callers:** `ai-router`, `scheduler`.

---

### user-management

**Container:** `user-management`

**Purpose:** Act as the security boundary for user identity, setup flow, credential custody, and non-secret configuration.

**Why separate:** Monica credentials, Telegram linkage, onboarding authentication, and per-user preferences need narrow, auditable access patterns.

**Responsibilities:**
- Create and manage user accounts plus Telegram account linkage.
- Store MonicaHQ base URL and API key per user with AES-256 encryption at rest.
- Store non-secret preferences: language, confirmation mode, reminder cadence, IANA timezone, and connector routing metadata.
- Issue, validate, consume, reissue, and cancel 15-minute one-time setup tokens bound to Telegram user identity and onboarding step. At most one active setup token may exist per Telegram user.
- Expose onboarding APIs for `web-ui`.
- Expose non-secret preference/schedule APIs to `telegram-bridge`, `ai-router`, and `scheduler`.
- Expose a narrow audited credential-resolution API only to `monica-integration`.

**Allowed callers:** `web-ui` (setup submit/validate), `telegram-bridge` (setup-link issue/cancel and Telegram linkage), `ai-router` (non-secret preferences only), `scheduler` (schedule and routing metadata only), `monica-integration` (credential-resolution only).

---

### web-ui

**Container:** `web-ui`

**Purpose:** Serve the onboarding page and future account-management UI.

**Why separate:** Frontend concerns, session handling, and browser protections differ from backend service concerns.

**Responsibilities:**
- Serve the onboarding page behind a signed 15-minute one-time setup token.
- Collect MonicaHQ base URL, API key, language, confirmation mode, reminder cadence, and IANA timezone.
- Enforce CSRF/origin protections and submit onboarding data to `user-management` over HTTPS.
- Present replay/expiry failures clearly and direct the user back to Telegram to reissue a setup link.

**Allowed callers:** End users via browser through Caddy.

---

## Shared Concerns

| Concern | Package | Scope |
|---|---|---|
| Monica API client | `@monica-companion/monica-api-lib` | Typed MonicaHQ v4 client and validation schemas used by `monica-integration`. |
| Idempotency / dedupe | `@monica-companion/idempotency` | Prevents duplicate confirmed-command execution and duplicate reminder sends. |
| Log redaction | `@monica-companion/redaction` | Sanitizes secrets and personal data in logs, traces, dead letters, and support tooling. |
| Security / auth | `@monica-companion/auth` | Signed JWTs, user identity propagation, and per-endpoint caller-allowlist enforcement. |
| Shared types | `@monica-companion/types` | Connector-neutral command, delivery, and contact-projection contracts. |

---

## Infrastructure Services

| Service | Container Name | Role |
|---|---|---|
| PostgreSQL | `postgres` | Primary store for accounts, preferences, setup tokens, pending commands, command logs, idempotency keys, and delivery audits. |
| Redis | `redis` | BullMQ backing store and optional short-lived cache. |
| Caddy | `caddy` | Reverse proxy with automatic HTTPS. Public exposure is limited to the Telegram webhook and onboarding UI. |

## Observability Stack

| Service | Container Name | Role |
|---|---|---|
| OTel Collector | `otel-collector` | Receives telemetry from all services and routes it downstream. |
| Grafana | `grafana` | Dashboards and alerts. |
| Loki | `loki` | Log backend. |
| Prometheus | `prometheus` | Metrics backend. |
| Tempo | `tempo` | Trace backend. |

---

## Service Communication

```text
User (Telegram)
    |
    v
  Caddy
    |
    v
telegram-bridge --voice--> voice-transcription
    |                          |
    |<------ transcript -------|
    |
    v
 ai-router ----contact lookup----> monica-integration
    |                                 |
    |<----- contact projection -------|
    |
    +---- clarification/query/result intents ----> delivery ----> telegram-bridge ----> Telegram Bot API
    |
    +---- confirmed commands ---------------------> scheduler ----> monica-integration ----> MonicaHQ API
                                                     |
                                                     +---- execution result intents -----> delivery
```

### Communication Rules

- **Inter-service transport:** HTTP/REST over the internal Docker network with signed JWTs and per-endpoint caller allowlists.
- **Public ingress:** Only the Telegram webhook and onboarding UI are publicly reachable. Internal APIs and `/health` endpoints are not exposed through Caddy.
- **Webhook protection:** Telegram webhook requests must present the configured `X-Telegram-Bot-Api-Secret-Token`, then pass rate limiting and request-size limits before entering business logic.
- **Credential access:** Only `monica-integration` may obtain decrypted Monica credentials, and only through a narrow audited endpoint in `user-management`.
- **Outbound delivery:** `delivery` routes outbound intents; connectors format and send. Neither `ai-router` nor `scheduler` perform Telegram-specific formatting.
- **Scheduler scope:** Only confirmed mutating commands and scheduled reminder jobs flow through `scheduler`. Read-only queries and clarification prompts stay on the live `ai-router -> delivery` path.
- **Monica access:** `ai-router` may only call Monica through the read-only contact-projection endpoints on `monica-integration`; raw Monica payloads and API details stay behind the anti-corruption layer.

---

## Command Lifecycle

1. **Draft**
   `ai-router` creates or updates a pending command with `pendingCommandId`, `version`, source-message references, proposed action, and a 30-minute inactivity TTL.
2. **Pending confirmation**
   When the draft is precise enough to execute but user approval is required, `ai-router` sends a confirmation prompt through `delivery`. Callback payloads and reply metadata carry the same `pendingCommandId` and `version`.
3. **Confirmed**
   When the user confirms, or when auto-confirmation rules allow it, `ai-router` freezes the command payload, derives an idempotency key, and sends the confirmed execution request to `scheduler`.
4. **Executed**
   `scheduler` executes the command through `monica-integration`, records the terminal outcome, and emits a success/failure delivery intent.
5. **Expired or cancelled**
   If the TTL expires, the user cancels, or the version in a reply no longer matches the current draft, the pending command becomes terminal and later replies are rejected as stale.

**Additional rules:**
- Edits and disambiguation choices update the same draft and increment `version`.
- Voice confirmations and voice clarifications are treated exactly like text after transcription; they must still attach to an active `pendingCommandId`.
- `scheduler` never executes a command that is not already in the `confirmed` state.

---

## Contact Resolution Contract

`monica-integration` exposes a Monica-agnostic `ContactResolutionSummary` projection to `ai-router`. The projection contains only the fields required for matching and safe disambiguation:

| Field | Purpose |
|---|---|
| `contactId` | Stable Monica contact identifier for downstream execution |
| `displayName` | Primary user-facing label |
| `aliases[]` | Nicknames, alternate names, family labels, user-defined aliases |
| `relationshipLabels[]` | Deterministic relationship hints such as `mother`, `brother`, `colleague` |
| `importantDates[]` | Birthday and reminder-relevant dates used for lookup/disambiguation |
| `lastInteractionAt` | Optional recency hint for deterministic ranking |

Rules:
- `ai-router` does not receive Monica API keys, raw Monica payloads, or unrestricted note history.
- Exact Monica field retrieval and mutation remain deterministic operations in `monica-integration` plus `scheduler`.
- The detailed Monica endpoint mapping that produces this projection will be finished in `context/product/monica-api-scope.md`.

---

## Reliability & Scheduling

- All external API calls (MonicaHQ, OpenAI, Telegram) have explicit timeout handling.
- Transport-level quick retries belong to the edge client talking to the dependency (`monica-integration` for Monica, connector client for Telegram, `voice-transcription` service for audio transcription). Scheduler owns only job-level retries.
- Reminder schedules are stored with an IANA timezone and executed against local wall-clock time.
- If a configured local time does not exist because of DST spring-forward, the reminder fires at the next valid local minute.
- If a local time repeats because of DST fall-back, dedupe keys ensure the reminder is sent only once for that schedule window.
- Schedule-window dedupe keys are computed from user, schedule, cadence, and local date or ISO week.
- Failed jobs are dead-lettered with redacted payloads after retry budget is exhausted.
- Users receive graceful fallback messages instead of raw errors.
- Strict schema validation applies to all inbound and outbound service contracts.

---

## Data Governance

- Conversation storage is minimized to the state required for active workflows and recent context.
- Delivery audits store routing metadata and outcome, not full raw Monica responses.
- Trace attributes, logs, dead letters, and queue payloads follow the same redaction policy as application logs.
- Support tooling must read the same redacted/audited records rather than raw secrets.
