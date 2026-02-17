# Monica Project

Telegram-first personal assistant product scaffold, with Monica as the relationship data source.

## Current Status
This repository currently defines product and delivery guidance (PRD, agent prompts, and skills). Runtime implementation code is expected to be added in later iterations.

## Product Direction
The first release is command-first and Telegram-only, with these core capabilities:
1. Private-chat Telegram bot commands.
2. Monica-backed contact/reminder/note operations.
3. Scheduled reminder digests sent to Telegram.
4. Voice-to-text command intake.
5. Streaming responses for long-running operations.

Detailed scope and acceptance criteria live in `docs/prd-telegram-first-plain-english.md`.

## Architecture Overview
The target system is split into independent services:
1. Telegram Bot Service
2. Assistant Core Service
3. Monica Integration Service
4. Voice Transcription Service
5. Scheduler Service
6. Delivery Service
7. Shared Security/Access layer
8. Shared Observability layer

## Planned Tech Stack
1. Python 3.12+.
2. FastAPI + Pydantic v2 for service APIs and contracts.
3. `httpx` for Monica/Telegram/internal HTTP calls.
4. Docker Compose for local deployment and service orchestration.

## Development Approach
1. Test-Driven Development (TDD) is the default for feature, bugfix, and refactor work.
2. Use RED -> GREEN -> REFACTOR: write failing test first, implement minimal code to pass, then clean up.
3. Prefer targeted `pytest`/`uv run pytest` commands for fast feedback on touched modules.

## Important Constraints
1. Private chats only (no groups in first release).
2. Command-first UX; optional AI interpretation is a future phase.
3. Telegram API concerns stay in Bot/Delivery boundaries.
4. Monica API concerns stay in Monica Integration boundaries.
5. Internal service calls require authentication/authorization.

## Repository Docs
1. `AGENTS.md`: Repo operation rules and architecture constraints.
2. `docs/prd-telegram-first-plain-english.md`: Product requirements and rollout phases.
3. `docs/monica-api-contracts.md`: Monica route I/O contracts and examples.
4. `.opencode/base-AGENTS.md`: OpenCode-specific orchestration supplement.
