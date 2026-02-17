# OpenCode Runtime Supplement

This file supplements `AGENTS.md` with execution routing rules for OpenCode subagents.

## Non-negotiables
1. Treat `AGENTS.md` and `docs/prd-telegram-first-plain-english.md` as authoritative.
2. Treat `docs/monica-api-contracts.md` as the Monica I/O contract source.
3. Preserve the PRD service boundaries:
- Telegram Bot Service
- Assistant Core Service
- Monica Integration Service
- Voice Transcription Service
- Scheduler Service
- Delivery Service
4. Keep Telegram API access inside Bot and Delivery service seams only.
5. Keep Monica API access inside Monica Integration seams only.
6. Use mock Monica payloads for tests; do not call a real Monica instance in automated validation.
7. Keep security and observability controls explicit in every service change.

## Autonomous skill routing
1. For contract definition/intake, explicitly use `task-contract`.
2. For architecture decisions, explicitly use `architecture-patterns` (architector).
3. For cross-service/new integration/high-risk work, run `architecture-planner`.
4. For any feature/bug/refactor implementation, explicitly use `test-driven-development` before writing production code.
5. For AI-layer design/implementation (LangChain/LangGraph, agent memory/tools), explicitly use `langchain-architecture`.
6. For Telegram bot behavior/design/integration work, explicitly use `telegram-bot-builder`.
7. For UI/UX-heavy work, explicitly use `ui-ux-pro-max`.
8. Use Tavily-backed `web-researcher` for current external web facts, and use `webfetch` only for specific pages.
9. For unattended long-running execution, explicitly use `nightly-autopilot`.
10. When work spans multiple domains, use all matching skills in the same run.
11. Do not skip domain-skill selection for non-trivial architecture, implementation, AI, Telegram, or unattended tasks.

## Required orchestration flow
1. Before implementation, ensure a task contract exists using `task-contract` (objective, scope, validations, quality targets, execution mode, stop conditions). If missing, run `requirements-intake` and ask the user.
2. For cross-service/new integration/high-risk work, run `architecture-planner` and apply `architecture-patterns` guidance before editing.
3. Enforce TDD for implementation: RED (failing test) -> GREEN (minimal pass) -> REFACTOR.
4. If execution mode is unattended, activate `nightly-autopilot` with explicit runtime/cycle/backlog bounds.
5. Delegate implementation to `feature-implementer`.
6. Run `reviewer` before completion.
7. Run `test-keeper` before completion.
8. If research uncertainty exists (Telegram/Monica API behavior, limits, library changes), run `web-researcher`.

## Done criteria
1. Requested behavior implemented.
2. Architecture and scope rules from PRD respected.
3. No unresolved high/medium review findings.
4. TDD evidence is present for behavior changes (failing test first, then passing test with minimal code).
5. Relevant tests pass, or explicit documented reason if tests cannot run.
6. Output includes changed files and residual risk notes.

## Loop stop conditions
1. Acceptance criteria passed for interactive runs.
2. Hard blocker identified with evidence.
3. Step budget exhausted.
4. Risk exceeds allowed autonomy (request user input).
