# Monica Companion — Product Summary

## Vision

Enable MonicaHQ v4 users to capture and retrieve relationship information effortlessly through voice and text messages in Telegram, in any language. Talk into your phone after a call, and AI handles the rest — transcribing, identifying the contact, and saving to MonicaHQ. Each user connects to their own MonicaHQ instance.

## Target Audience

Individuals using MonicaHQ v4 (self-hosted or app.monicahq.com) as a personal CRM — from relationship-focused people who want to remember birthdays and life events, to busy professionals who need to log networking details on the go.

## Core Features

- **Voice & Text Processing** — Send voice or text messages via Telegram in any language; AI transcribes and parses intent.
- **Smart Contact Resolution** — AI identifies contacts from a minimized contact projection, disambiguates via inline keyboard buttons, and rejects stale confirmations instead of mutating the wrong record.
- **Basic Create/Update/Query** — Create contacts, add notes, log activities, update details, and run simple direct lookups in v1. Delete flows are out of scope.
- **Configurable Confirmation** — Auto-execute or require approval via inline keyboards, with a versioned pending-action lifecycle and correlation checks.
- **Daily/Weekly Reminders** — Cron job for event summaries (birthdays, reminders) at a chosen local time in an IANA timezone, with DST-aware schedule windows and a bounded catch-up policy.
- **Web-Based Onboarding** — Secure web page for credential entry (MonicaHQ URL + API key) behind a short-lived one-time setup token with CSRF/origin checks. Never via Telegram chat.
- **Multi-User / Multi-Instance** — Isolated accounts, each with their own MonicaHQ instance URL and API key. Hosted defaults require canonical public HTTPS Monica endpoints.
- **Private Chat Only** — Bot enforces private-chat-only policy; shows typing indicators during processing.
- **Operational Guardrails** — Shared operator OpenAI key with per-user limits, budget alarms, and kill switch. Monica URLs are normalized and blocked from private-network SSRF targets. Retention/deletion rules cover logs, traces, queues, and history.
- **Modular Architecture** — 8 app containers: telegram-bridge, ai-router, voice-transcription, monica-integration, scheduler, delivery, user-management, web-ui (16 total with infra + observability). Pluggable connector layer for future platforms. Unified command execution through scheduler with idempotency. Dedicated Monica gateway with transport-level retries/timeouts/pagination. Delivery audit records. Caller allowlists, secret rotation, log redaction, health checks, and alerting.
