# Product Definition: Monica Companion

- **Version:** 1.0
- **Status:** Proposed

---

## 1. The Big Picture (The "Why")

### 1.1. Project Vision & Purpose

Enable MonicaHQ (v4) users to capture and retrieve relationship information effortlessly through voice and text messages in their favorite messaging apps. After a phone call or meeting, users should be able to talk into their phone, send a quick voice note, and have the AI handle the rest — transcribing, identifying the right contact, and saving the information to MonicaHQ. No more forgetting details or dreading manual data entry. The system supports multiple languages from day one — users can speak and type in any language supported by OpenAI Whisper and GPT.

### 1.2. Target Audience

Individuals who use MonicaHQ v4 (self-hosted or the hosted instance at app.monicahq.com) as a personal CRM to manage relationships with friends, family, colleagues, and professional contacts. Each user connects to their own MonicaHQ instance or the official hosted service (different server URLs supported). These users value maintaining meaningful relationships but find it tedious to manually log notes, activities, and contact details after every interaction.

### 1.3. User Personas

- **Persona 1: "Nadia the Networker"**
  - **Role:** Marketing consultant who meets dozens of people at conferences and events.
  - **Goal:** Quickly log conversation highlights and contact details right after a meeting, before she forgets.
  - **Frustration:** By the time she sits down to type notes into MonicaHQ, she's already forgotten half the details. She wants to just talk into her phone while walking to the next session.

- **Persona 2: "Carlos the Connector"**
  - **Role:** A family-oriented person who maintains close relationships with a wide circle of friends and extended family.
  - **Goal:** Remember birthdays, life events, and conversation topics so he can be a thoughtful friend and family member.
  - **Frustration:** He forgets to check MonicaHQ for upcoming birthdays and wishes he had a daily reminder. After calling his mom, he wants to quickly note what they talked about without opening a browser.

### 1.4. Success Metrics

- **Speed of capture:** Users can log a contact note in under 30 seconds via voice message, compared to several minutes of manual typing in the MonicaHQ UI.
- **Data completeness:** Users who adopt Monica Companion log at least 3x more notes and activities than they did with manual entry alone.
- **Action accuracy:** The AI correctly identifies the intended contact and proposes the right action (add note, update field, log activity, query info) at least 90% of the time.

---

## 2. The Product Experience (The "What")

### 2.1. Core Features

- **Voice & Text Message Processing:** Accept voice messages and text commands via Telegram in any language. Transcribe voice to text using AI (OpenAI Whisper), then parse the intent. Multi-language support is built-in from day one — the AI detects the user's language and responds accordingly.
- **Smart Contact Resolution:** AI identifies the target contact from the user's MonicaHQ data. Handles ambiguity via Telegram inline keyboards (clickable buttons) — if there are multiple "Sherry"s, presents buttons to choose. Users can also reply via text or voice message (voice is always transcribed and handled as text throughout the entire flow, including disambiguations and confirmations). Skips confirmation when the match is unambiguous (full name, unique relationship like "my brother").
- **Basic CRUD Operations:** Create new contacts, add notes, log activities, update contact details (birthday, phone, email), and query information. V1 supports simple direct lookups only ("What's Sarah's birthday?", "What's Alex's phone number?"). Complex queries ("who haven't I talked to in 3 months") are deferred to a future version.
- **Configurable Confirmation Flow:** Users can configure whether actions require explicit approval or execute automatically. AI always asks for clarification when information is ambiguous, regardless of setting. Confirmations use Telegram inline keyboards (Yes/No/Cancel buttons). Users can also reply via text or voice message — the Telegram bridge always transcribes voice to text before processing.
- **Daily/Weekly Event Reminders:** A configurable cron job that sends the user a summary of today's or this week's events (birthdays, reminders) at a user-chosen time via Telegram. When reminder delivery fails (e.g., MonicaHQ unreachable), retries automatically with backoff and notifies the user via Telegram if retries are exhausted.
- **Multi-User / Multi-Account Support:** Multiple users can connect their own MonicaHQ v4 instances (each with a different server URL and API key) and Telegram accounts independently. Each user's data and configuration is fully isolated.
- **Web-Based Onboarding:** Users set up their account via a secure Astro-based web page (linked from the Telegram bot) where they enter their MonicaHQ instance URL, API key, and configure preferences. Credentials are never sent through Telegram chat. The web frontend is designed to be extended into a full management dashboard (per-user settings, activity logs, login) in future versions.
- **Modular Connector Architecture:** The system is designed with a pluggable connector layer so that new messaging platforms (Matrix, Discord, etc.) can be added without changing the core logic.

### 2.2. User Journey

1. **Setup:** User starts the Monica Companion Telegram bot and receives a unique setup link. They open the web setup page in their browser, enter their MonicaHQ instance URL and API key over HTTPS, choose their preferred language and confirmation mode, and set their reminder schedule. Credentials never pass through Telegram chat.
2. **Capture:** User finishes a phone call with their mom. They open Telegram and send a voice message: *"Talked with Mom today, she mentioned she's starting a garden project and wants help picking tomato plants next weekend."*
3. **Processing:** The AI transcribes the voice message, identifies "Mom" as a unique contact in the user's MonicaHQ, and sends a message with inline keyboard buttons: *"Add note to **Maria (Mom)**: Talked today — she's starting a garden project, wants help picking tomato plants next weekend."* **[Yes] [Edit] [Cancel]**
4. **Confirmation:** User taps "Yes" (or the AI auto-executes if configured). The note is saved to MonicaHQ.
5. **Disambiguation:** User says *"Add a note to Sherry."* The AI finds two Sherrys and presents inline buttons: *"Which Sherry?"* **[Sherry Miller — friend] [Sherry Chen — colleague]**. User taps one, then continues.
6. **Query:** Later, user texts: *"When is Uncle Jorge's birthday?"* — the AI looks it up and responds: *"Jorge's birthday is April 12th — that's in 28 days!"*
7. **Reminders:** Every morning at 8am, the bot sends: *"Good morning! Today's events: Sarah's birthday. This week: dinner with Alex (Thursday)."* If MonicaHQ is unreachable, the bot retries and eventually notifies: *"Couldn't fetch your reminders — MonicaHQ appears to be down. I'll keep trying."*

---

## 3. Project Boundaries

### 3.1. What's In-Scope for V1

- MonicaHQ v4 (latest OSS) as the sole supported CRM backend.
- Each user connects to their own MonicaHQ instance (custom server URL + API key).
- Telegram bot as the sole messaging connector.
- Web-based setup page for secure credential entry and preference configuration (never via Telegram chat).
- Voice message transcription (via OpenAI Whisper API) with multi-language support from day one.
- Natural language understanding to parse user intent and extract contact references, in any language.
- Smart contact disambiguation via Telegram inline keyboards (buttons). Voice and text replies accepted at every stage — voice is always transcribed first.
- Basic CRUD: create contacts, add notes, log activities, update key fields (birthday, phone, email, address).
- Simple direct queries only (field lookups like birthday, phone, last note). Complex/aggregation queries deferred.
- Configurable auto/manual action confirmation per user.
- One configurable cron job per user: daily or weekly event summary (birthdays, reminders) at a user-selected time. Telegram error notification when retries are exhausted.
- Multi-user support with isolated accounts and MonicaHQ credentials.
- Shared OpenAI API key (operator-provided), no per-user rate limits in v1 — monitor via observability.
- Modular architecture with a clear connector interface for future platforms.
- Each service runs as a separate Docker container.

### 3.2. What's Out-of-Scope (Non-Goals)

- **Native mobile app:** All interaction happens through Telegram — no separate iOS/Android app.
- **Calendar integration:** No syncing with Google Calendar, Outlook, or other calendar services.
- **Bulk operations:** No batch imports, CSV processing, or mass edits.
- **Advanced analytics/reports:** No relationship health dashboards or reporting features.
- **Complex queries:** No aggregation queries like "who haven't I talked to recently" — only simple direct lookups in v1.
- **Matrix / Discord / other connectors:** Architecture supports them, but only Telegram ships in v1.
- **Multiple cron jobs per user:** V1 supports a single daily-or-weekly reminder; more complex scheduling is deferred.
- **Full MonicaHQ feature parity:** Only core CRUD and query operations are supported — advanced features like gift tracking, debt management, or journal entries are out of scope.
- **MonicaHQ versions other than v4:** Only v4 API is supported in v1. Multi-version support (different API payload types/available commands per version) may be added later.
- **Per-user rate limiting or BYOK (bring your own key):** Deferred to a future version. V1 uses a shared operator-provided OpenAI key.
