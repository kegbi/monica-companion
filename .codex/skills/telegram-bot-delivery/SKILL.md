---
name: telegram-bot-delivery
description: Implement Telegram-first Monica-backed assistant features using the PRD service architecture, command-first behavior, and safety controls. Use when changing Telegram command flows, Monica operations, reminder digests, voice-to-text handling, or service boundaries.
---

# Telegram Bot Delivery

## Procedure
1. Read `AGENTS.md` and `docs/prd-telegram-first-plain-english.md`.
2. Confirm objective, scope, affected services, and acceptance criteria.
3. Plan changes across PRD service boundaries (Bot, Core, Monica Integration, Voice, Scheduler, Delivery).
4. Implement in small vertical slices with minimal diff.
5. Add/update tests in module-aligned folders.
6. Run the smallest sufficient lint/test commands for the repository toolchain.
7. Report changed files and residual risks.

## Rules
1. Keep Telegram API specifics inside Bot/Delivery seams.
2. Keep Monica API specifics inside Monica Integration seams.
3. Preserve command-first behavior and private-chat-only policy.
4. Keep Scheduler and Delivery concerns separate from live request handling.
5. Make security and observability requirements explicit in each change (auth, rate-limit, dedupe, logs/traces).

## Validation checklist
1. Private-chat-only enforcement is covered for Telegram flows.
2. Contact/reminder/note behaviors remain aligned with PRD scope.
3. Scheduler digest path and retry/idempotency expectations are validated when touched.
4. No unresolved high/medium review findings.
