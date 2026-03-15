# Monica Companion — Product Summary

## Vision

Enable MonicaHQ v4 users to capture and retrieve relationship information effortlessly through voice and text messages in Telegram, in any language. Talk into your phone after a call, and AI handles the rest — transcribing, identifying the contact, and saving to MonicaHQ. Each user connects to their own MonicaHQ instance.

## Target Audience

Individuals using MonicaHQ v4 (self-hosted or app.monicahq.com) as a personal CRM — from relationship-focused people who want to remember birthdays and life events, to busy professionals who need to log networking details on the go.

## Core Features

- **Voice & Text Processing** — Send voice or text messages via Telegram in any language; AI transcribes and parses intent.
- **Smart Contact Resolution** — AI identifies contacts, disambiguates via inline keyboard buttons, skips confirmation when unambiguous.
- **Basic CRUD** — Create contacts, add notes, log activities, update details. Simple direct lookups only in v1.
- **Configurable Confirmation** — Auto-execute or require approval via inline keyboards; always clarifies ambiguity.
- **Daily/Weekly Reminders** — Cron job for event summaries (birthdays, reminders) at a chosen time. Telegram notification on failure.
- **Web-Based Onboarding** — Secure web page for credential entry (MonicaHQ URL + API key). Never via Telegram chat.
- **Multi-User / Multi-Instance** — Isolated accounts, each with their own MonicaHQ instance URL and API key.
- **Private Chat Only** — Bot enforces private-chat-only policy; shows typing indicators during processing.
- **Modular Architecture** — 8 app containers: telegram-bridge, ai-router, voice-transcription, scheduler, delivery, user-management, web-ui. Pluggable connector layer for future platforms. Unified command execution through scheduler with idempotency. Dedicated delivery service for outbound messages. Log redaction and per-service health checks.
