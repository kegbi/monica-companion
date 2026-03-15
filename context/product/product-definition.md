# Product Definition: Monica Companion

- **Version:** 1.0
- **Status:** Proposed

---

## 1. The Big Picture (The "Why")

### 1.1. Project Vision & Purpose

Enable MonicaHQ users to capture and retrieve relationship information effortlessly through voice and text messages in their favorite messaging apps. After a phone call or meeting, users should be able to talk into their phone, send a quick voice note, and have the AI handle the rest — transcribing, identifying the right contact, and saving the information to MonicaHQ. No more forgetting details or dreading manual data entry.

### 1.2. Target Audience

Individuals who use MonicaHQ (self-hosted or cloud) as a personal CRM to manage relationships with friends, family, colleagues, and professional contacts. These users value maintaining meaningful relationships but find it tedious to manually log notes, activities, and contact details after every interaction.

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

- **Voice & Text Message Processing:** Accept voice messages and text commands via Telegram. Transcribe voice to text using AI, then parse the intent.
- **Smart Contact Resolution:** AI identifies the target contact from the user's MonicaHQ data. Handles ambiguity intelligently — if there are multiple "Sherry"s, asks the user to choose. Skips confirmation when the match is unambiguous (full name, unique relationship like "my brother").
- **Basic CRUD Operations:** Create new contacts, add notes, log activities, update contact details (birthday, phone, email), and query information ("When did I last talk to Alex?", "What's Sarah's birthday?").
- **Configurable Confirmation Flow:** Users can configure whether actions require explicit approval or execute automatically. AI always asks for clarification when information is ambiguous, regardless of setting.
- **Daily/Weekly Event Reminders:** A configurable cron job that sends the user a summary of today's or this week's events (birthdays, reminders) at a user-chosen time via Telegram.
- **Multi-User / Multi-Account Support:** Multiple users can connect their own MonicaHQ instances and Telegram accounts independently. Each user's data and configuration is isolated.
- **Modular Connector Architecture:** The system is designed with a pluggable connector layer so that new messaging platforms (Matrix, Discord, etc.) can be added without changing the core logic.

### 2.2. User Journey

1. **Setup:** User registers with the Monica Companion bot on Telegram, provides their MonicaHQ API credentials, and configures their preferences (confirmation mode, reminder schedule).
2. **Capture:** User finishes a phone call with their mom. They open Telegram and send a voice message: *"Talked with Mom today, she mentioned she's starting a garden project and wants help picking tomato plants next weekend."*
3. **Processing:** The AI transcribes the voice message, identifies "Mom" as a unique contact in the user's MonicaHQ, and proposes: *"Add note to **Maria (Mom)**: Talked today — she's starting a garden project, wants help picking tomato plants next weekend. Confirm?"*
4. **Confirmation:** User taps "Yes" (or the AI auto-executes if configured). The note is saved to MonicaHQ.
5. **Query:** Later, user texts: *"When is Uncle Jorge's birthday?"* — the AI looks it up and responds: *"Jorge's birthday is April 12th — that's in 28 days!"*
6. **Reminders:** Every morning at 8am, the bot sends: *"Good morning! Today's events: Sarah's birthday. This week: dinner with Alex (Thursday)."*

---

## 3. Project Boundaries

### 3.1. What's In-Scope for V1

- Telegram bot as the sole messaging connector.
- Voice message transcription (via AI/speech-to-text).
- Natural language understanding to parse user intent and extract contact references.
- Smart contact disambiguation with multi-step confirmation when needed.
- Basic CRUD: create contacts, add notes, log activities, update key fields (birthday, phone, email, address), query contact info.
- Configurable auto/manual action confirmation per user.
- One configurable cron job per user: daily or weekly event summary (birthdays, reminders) at a user-selected time.
- Multi-user support with isolated accounts and MonicaHQ credentials.
- Modular architecture with a clear connector interface for future platforms.

### 3.2. What's Out-of-Scope (Non-Goals)

- **Native mobile app:** All interaction happens through Telegram — no separate iOS/Android app.
- **Calendar integration:** No syncing with Google Calendar, Outlook, or other calendar services.
- **Bulk operations:** No batch imports, CSV processing, or mass edits.
- **Advanced analytics/reports:** No relationship health dashboards or reporting features.
- **Matrix / Discord / other connectors:** Architecture supports them, but only Telegram ships in v1.
- **Multiple cron jobs per user:** V1 supports a single daily-or-weekly reminder; more complex scheduling is deferred.
- **Full MonicaHQ feature parity:** Only core CRUD and query operations are supported — advanced features like gift tracking, debt management, or journal entries are out of scope.
