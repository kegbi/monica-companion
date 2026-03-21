# Product Definition: Monica Companion

- **Version:** 1.0
- **Status:** Proposed

---

## 1. The Big Picture (The "Why")

### 1.1. Project Vision & Purpose

Enable MonicaHQ (v4) users to capture and retrieve relationship information effortlessly through voice and text messages in their favorite messaging apps. After a phone call or meeting, users should be able to talk into their phone, send a quick voice note, and have the AI handle the rest — transcribing, identifying the right contact, and saving the information to MonicaHQ. No more forgetting details or dreading manual data entry. The system supports multiple languages from day one — users can speak and type in any language supported by OpenAI `gpt-4o-transcribe` and `gpt-5.4-mini`.

### 1.2. Target Audience

Individuals who use MonicaHQ v4 (self-hosted or the hosted instance at app.monicahq.com) as a personal CRM to manage relationships with friends, family, colleagues, and professional contacts. Each user connects to their own MonicaHQ instance or the official hosted service through a supported public HTTPS base URL. These users value maintaining meaningful relationships but find it tedious to manually log notes, activities, and contact details after every interaction.

### 1.3. User Personas

- **Persona 1: "Nadia the Networker"**
  - **Role:** Marketing consultant who meets dozens of people at conferences and events.
  - **Goal:** Quickly log conversation highlights and contact details right after a meeting, before she forgets.
  - **Frustration:** By the time she sits down to type notes into MonicaHQ, she's already forgotten half the details. She wants to just talk into her phone while walking to the next session.

- **Persona 2: "Carlos the Connector"**
  - **Role:** A family-oriented person who maintains close relationships with a wide circle of friends and extended family.
  - **Goal:** Remember birthdays, life events, and conversation topics so he can be a thoughtful friend and family member.
  - **Frustration:** He forgets to check MonicaHQ for upcoming birthdays and wishes he had a daily reminder. After calling his mom, he wants to quickly note what they talked about without opening a browser.

### 1.4. Release Metrics

- **Release-gate latency:** `context/product/acceptance-criteria.md` is authoritative. The release gate is p95 time to first actionable response of at most 5 seconds for text and 12 seconds for voice in the staging environment.
- **Evaluation corpus:** Release decisions use a labeled benchmark of at least 200 utterances (100 write intents, 60 read/query intents, 40 clarification/disambiguation turns), including at least 50 voice samples across supported languages.
- **Quality gate:** On that benchmark, read/query accuracy is at least 92%, write intent/action proposal accuracy is at least 90%, unambiguous contact-resolution precision is at least 95%, and false-positive mutating executions stay below 1%.

### 1.5. Product KPIs

- **End-to-end capture:** Users can complete a confirmed note capture in under 30 seconds end-to-end.
- **Adoption depth:** For beta cohorts, compare each user's `notes + activities created` in the 30 days after onboarding with the same user's previous 30-day baseline. The target is at least 3x growth, excluding users without activity in both windows.

---

## 2. The Product Experience (The "What")

### 2.1. Core Features

- **Voice & Text Message Processing:** Accept voice messages and text commands via Telegram in any language. Transcribe voice to text using OpenAI `gpt-4o-transcribe`, then parse intent using LangGraph TS plus `gpt-5.4-mini` with multi-turn conversation context awareness. Multi-language support is built-in from day one — the AI detects the user's language from the utterance and generates all responses in the same language.
- **Smart Contact Resolution:** AI identifies the target contact from a minimized internal contact projection rather than raw Monica records and supports multi-turn pronoun/reference resolution (e.g., "add note to John" followed by "also update his birthday") using stored conversation turn summaries. The projection includes display name, aliases/nicknames, relationship labels, and key dates needed for matching. Ambiguity is handled via Telegram inline keyboards (clickable buttons) — if there are multiple "Sherry"s, the system presents buttons to choose. Users can also reply via text or voice message (voice is always transcribed and handled as text throughout the entire flow, including disambiguations and confirmations). Skips confirmation when the match is unambiguous (full name, unique relationship like "my brother").
- **Basic Create/Update/Query Operations:** Create new contacts, add notes, log activities, update contact details (birthday, phone, email), and query information. V1 supports simple direct lookups only ("What's Sarah's birthday?", "What's Alex's phone number?"). Contact or activity deletion flows are not part of V1. Complex queries ("who haven't I talked to in 3 months") are deferred to a future version.
- **Configurable Confirmation Flow:** Users can configure whether actions require explicit approval or execute automatically. AI always asks for clarification when information is ambiguous, regardless of setting. Confirmations use Telegram inline keyboards (Yes/Edit/Cancel buttons). Users can also reply via text or voice message — the Telegram bridge always transcribes voice to text before processing.
- **Versioned Pending Action Lifecycle:** Every mutating command is tracked as a versioned pending action with the lifecycle `draft -> pending_confirmation -> confirmed -> executed -> expired/cancelled`. Clarifications and edits update the draft version, and stale confirmations are rejected instead of executing the wrong action.
- **Daily/Weekly Event Reminders:** A configurable cron job sends the user a summary of today's or this week's events (birthdays, reminders) at a user-chosen local wall-clock time in an IANA timezone. DST follows local wall-clock behavior, duplicate sends are prevented per schedule window, and missed runs send at most one catch-up digest if the scheduler recovers within 6 hours. When reminder delivery fails (e.g., MonicaHQ unreachable), retries automatically with backoff and notifies the user via Telegram if retries are exhausted.
- **Multi-User / Multi-Account Support:** Multiple users can connect their own MonicaHQ v4 instances (each with a different server URL and API key) and Telegram accounts independently. Each user's data and configuration is fully isolated.
- **Web-Based Onboarding:** Users set up their account via a secure Astro-based web page (linked from the Telegram bot) using a 15-minute, one-time, signed setup token bound to their Telegram user ID and onboarding step. Only one active setup token exists per Telegram user; reissuing a setup link invalidates the previous token and manual cancellation revokes it immediately. The page collects MonicaHQ instance URL, API key, language, confirmation mode, timezone, and reminder schedule. Credentials are never sent through Telegram chat. Form submission is protected with HTTPS, CSRF/origin checks, replay-safe token consumption, and audit logging. The web frontend is designed to be extended into a full management dashboard (per-user settings, activity logs, login) in future versions.
- **Modular Connector Architecture:** The system is designed with a pluggable connector layer so that new messaging platforms (Matrix, Discord, etc.) can be added without changing the core logic.

### 2.2. Supported Monica-Backed Operations in V1

| Operation | Supported in V1 | Notes |
|---|---|---|
| Create contact | Yes | Creates a Monica contact when the user intentionally creates a new person. |
| Create note | Yes | Adds a note to an existing contact. |
| Create activity | Yes | Logs activities such as calls or meetings. |
| Update contact basic details | Yes | Limited to birthday, phone, email, and address. |
| Direct contact lookups | Yes | Limited to simple field lookups such as birthday, phone, or last note. |
| Delete contact, note, or activity flows | No | Out of scope for V1. |
| Aggregation or report-style queries | No | Examples such as "who haven't I talked to recently" remain deferred. |

### 2.3. User Journey

1. **Setup:** User starts the Monica Companion Telegram bot and receives a one-time setup link valid for 15 minutes. Only one setup token may be active for that Telegram user at a time; asking for a new link invalidates the previous token. The signed token is bound to that Telegram user, consumed on successful setup, and rejected if replayed, cancelled, or expired. The user opens the web setup page in their browser, enters their MonicaHQ instance URL and API key over HTTPS, chooses language, confirmation mode, timezone, and reminder schedule. Credentials never pass through Telegram chat.
2. **Capture:** User finishes a phone call with their mom. They open Telegram and send a voice message: *"Talked with Mom today, she mentioned she's starting a garden project and wants help picking tomato plants next weekend."*
3. **Processing:** The AI transcribes the voice message, identifies "Mom" as a unique contact in the user's MonicaHQ, and sends a message with inline keyboard buttons: *"Add note to **Maria (Mom)**: Talked today — she's starting a garden project, wants help picking tomato plants next weekend."* **[Yes] [Edit] [Cancel]**
4. **Confirmation:** User taps "Yes" (or the AI auto-confirms if configured). The pending action is checked by correlation ID and version before execution. If the confirmation arrives after expiry, the system rejects it as stale and asks the user to resubmit.
5. **Disambiguation:** User says *"Add a note to Sherry."* The AI finds two Sherrys and presents inline buttons: *"Which Sherry?"* **[Sherry Miller — friend] [Sherry Chen — colleague]**. The choice updates the existing draft action rather than creating a new unrelated command.
6. **Query:** Later, user texts: *"When is Uncle Jorge's birthday?"* — the AI looks it up and responds: *"Jorge's birthday is April 12th — that's in 28 days!"*
7. **Reminders:** Every morning at 8am in the user's selected timezone, the bot sends: *"Good morning! Today's events: Sarah's birthday. This week: dinner with Alex (Thursday)."* If MonicaHQ is unreachable, the bot retries and eventually notifies: *"Couldn't fetch your reminders — MonicaHQ appears to be down. I'll keep trying."* If the scheduler recovers later the same morning, it sends at most one catch-up digest for that schedule window.

---

## 3. Project Boundaries

### 3.1. What's In-Scope for V1

- MonicaHQ v4 (latest OSS) as the sole supported CRM backend.
- Each user connects to their own MonicaHQ instance (custom server URL + API key) at a canonical public HTTPS base URL. Loopback, RFC1918, link-local, and redirect targets into blocked networks are rejected by default. Trusted single-tenant deployments may opt into a narrowly scoped local-network override outside the hosted default.
- Telegram bot as the sole messaging connector.
- Web-based setup page for secure credential entry and preference configuration (never via Telegram chat), protected by 15-minute one-time setup links, one-active-token-per-user rules, invalidation on reissue/cancel, and CSRF/origin checks.
- Voice message transcription (via OpenAI `gpt-4o-transcribe`, with `whisper-1` as fallback) with multi-language support and language detection from day one.
- Natural language understanding via LangGraph TS plus OpenAI `gpt-5.4-mini` to parse user intent and extract contact references, with multi-turn conversation awareness and pronoun resolution, in any language.
- Smart contact disambiguation via Telegram inline keyboards (buttons). Voice and text replies accepted at every stage — voice is always transcribed first.
- Basic create/update/query operations: create contacts, add notes, log activities, update key fields (birthday, phone, email, address), and run simple field lookups.
- Simple direct queries only (field lookups like birthday, phone, last note). Complex/aggregation queries deferred.
- Configurable auto/manual action confirmation per user.
- Versioned pending-action handling with correlation IDs, optimistic version checks, TTLs, and stale-confirmation rejection.
- One configurable cron job per user: daily or weekly event summary (birthdays, reminders) at a user-selected time in an IANA timezone. DST follows local wall-clock behavior, duplicate sends are deduped per schedule window, and downtime triggers at most one catch-up run inside a 6-hour grace window.
- Multi-user support with isolated accounts and MonicaHQ credentials.
- Shared OpenAI API key (operator-provided) with V1 guardrails: per-user request size limits, per-user concurrency caps, soft budget alarms, and an operator kill switch/degraded-mode path when quota is exhausted.
- Private-chat-only policy — bot rejects group messages. Telegram-only in v1.
- Typing indicators shown while AI processes requests.
- A dedicated `voice-transcription` service (connector-agnostic, reusable by future connectors) with a normalized media contract: binary upload or short-lived fetch URL plus media metadata. Connector-specific file IDs stay inside the connector.
- A dedicated `delivery` service for outbound message routing (connector-agnostic — routes structured message intents to the right connector; the connector owns platform-specific formatting).
- Dedicated Monica Integration service as a clean gateway to MonicaHQ (handles timeouts, quick transport retries, pagination, payload validation, Monica URL normalization, and SSRF/redirect protections).
- AI contact resolution consumes a minimized internal contact projection exposed by Monica Integration rather than Monica-specific raw payloads.
- Confirmed mutating commands and scheduled reminders execute through `scheduler` with idempotency enforcement. Read-only queries, clarification prompts, and other non-mutating conversational responses stay synchronous on the `ai-router -> delivery` path. Scheduler owns business/job retries; transport-level quick retries stay in the edge client for the relevant external dependency.
- Delivery audit records — what was sent, when, to whom, success/failure.
- Caller allowlists — each service only accepts calls from expected callers.
- Secret rotation policy for JWT signing keys and encryption master keys.
- Graceful fallback messages to users when operations fail.
- Strict payload validation (Zod schemas) on all inbound/outbound requests.
- Alerting rules for repeated failures and high latency.
- Idempotency/dedupe to prevent duplicate command execution from Telegram retries.
- Log redaction to sanitize sensitive data (API keys, personal info) from logs, traces, queue payloads, dead letters, and support tooling.
- Conversation turn persistence: compressed turn summaries stored in PostgreSQL `conversation_turns` table (default 30-day retention) to enable multi-turn pronoun resolution and context awareness.
- Data retention and deletion rules for conversation history, command logs, delivery audits, traces, and dead letters.
- Per-service `/health` endpoints for Docker readiness/liveness probes on the internal network only.
- Public ingress limited to the Telegram webhook and onboarding web UI. Telegram webhook requests must present the configured `X-Telegram-Bot-Api-Secret-Token` and pass ingress rate/body-size controls.
- Modular architecture with a clear connector interface for future platforms.
- The logical architecture defines 8 application services, and the initial Telegram-only V1 deployment profile runs them as 8 separate application containers (16 total with infrastructure and observability). See `context/product/adr-v1-deployment-profile.md`.

### 3.2. What's Out-of-Scope (Non-Goals)

- **Native mobile app:** All interaction happens through Telegram — no separate iOS/Android app.
- **Calendar integration:** No syncing with Google Calendar, Outlook, or other calendar services.
- **Bulk operations:** No batch imports, CSV processing, or mass edits.
- **Advanced analytics/reports:** No relationship health dashboards or reporting features.
- **Complex queries:** No aggregation queries like "who haven't I talked to recently" — only simple direct lookups in v1.
- **Matrix / Discord / other connectors:** Architecture supports them, but only Telegram ships in v1.
- **Multiple cron jobs per user:** V1 supports a single daily-or-weekly reminder; more complex scheduling is deferred.
- **Private-network or insecure Monica targets in the hosted default:** Centrally hosted V1 does not support `http://`, localhost, RFC1918, link-local, or other non-public Monica endpoints unless the operator explicitly enables a trusted single-tenant override.
- **Full MonicaHQ feature parity:** Only core create/update/query operations are supported — advanced features like gift tracking, debt management, or journal entries are out of scope.
- **MonicaHQ versions other than v4:** Only v4 API is supported in v1. Multi-version support (different API payload types/available commands per version) may be added later.
- **Customer-configurable quotas or BYOK (bring your own key):** Deferred to a future version. V1 uses a shared operator-provided OpenAI key with operator-defined guardrails.
