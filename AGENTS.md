# AGENTS.md

## Mission
Build a Telegram-first personal assistant backed by Monica, following the PRD in `docs/prd-telegram-first-plain-english.md`.

## Source Of Truth
1. `docs/prd-telegram-first-plain-english.md` (product scope and architecture authority).
2. `docs/monica-api-contracts.md` (Monica route request/response contracts for implementation and tests).
3. `AGENTS.md` (repository operating rules).
4. `.opencode/base-AGENTS.md` (OpenCode runtime routing supplement).

## Repo Layout
1. `docs/`: Product documentation (current PRD).
2. `.codex/skills/`: Codex skill instructions.
3. `.opencode/agents/`: OpenCode agent prompts and roles.
4. `.opencode/skills/`: OpenCode skill workflows.
5. `opencode.jsonc`: OpenCode configuration and instruction loading order.

## Operating Workflow
1. Start every non-trivial task with a clear contract via `task-contract`: objective, scope in/out, affected services, validations, quality targets, execution mode, and stop conditions.
2. For cross-service/new integration/high-risk changes, run `architecture-planner` and apply `architecture-patterns` guidance before implementation.
3. For feature/bug/refactor work, use `test-driven-development` and enforce RED -> GREEN -> REFACTOR.
4. Implement in small vertical slices and keep diffs focused.
5. For unattended execution, run `nightly-autopilot` with explicit runtime/cycle/backlog limits.
6. Run review and validation before completion.
7. Report changed files, verification results, and residual risks.

## Skill Routing (Autonomous Mode)
1. Use `task-contract` for requirement completeness and execution gating.
2. Use `architecture-patterns` for architecture decisions/refactors and boundary planning (architector use case).
3. Use `test-driven-development` for all implementation tasks before writing production code.
4. Use `langchain-architecture` for AI-layer work (LangChain/LangGraph agents, memory, tools, orchestration).
5. Use `telegram-bot-builder` for Telegram bot interaction/API/flow tasks.
6. Use `nightly-autopilot` for unattended long-running execution loops.
7. If a task spans these domains, apply all relevant skills together.

## Imported Shared Skills
1. Use `ui-ux-pro-max` for design-heavy UI/UX tasks.
2. Use Tavily-backed `web-researcher` for external/current web facts, then `webfetch` for specific page retrieval.

## Architecture (PRD)
1. Telegram Bot Service: Telegram ingress/egress handling, command parsing, private-chat policy, voice intake, streaming UI behavior.
2. Assistant Core Service: Command execution, workflow orchestration, response composition.
3. Monica Integration Service: Monica API gateway for contacts, reminders, and notes.
4. Voice Transcription Service: Audio-to-text conversion and transcription error handling.
5. Scheduler Service: Cron-driven digest and other scheduled workflows with retries and idempotency.
6. Delivery Service: Outbound Telegram delivery for system-generated messages and digests.
7. Security And Access Layer (shared): service authentication, authorization, dedupe/idempotency, rate limiting, secret policy, redaction.
8. Observability Layer (shared): structured logs, traces, metrics, health checks, alertability.

## Service Boundary Rules
1. Keep Telegram API specifics in Bot/Delivery boundaries only.
2. Keep Monica API specifics in Monica Integration boundaries only.
3. Keep Scheduler logic separate from live Telegram request handling.
4. Enforce service-to-service auth and explicit caller allowlists on internal endpoints.
5. Preserve command-first behavior and private-chat-only policy for Telegram flows.

## Tech Stack Baseline
1. Use Python (3.12+) for service implementation.
2. Build service APIs with FastAPI + Pydantic v2.
3. Use `httpx` for outbound HTTP, with retries/backoff for external dependencies.
4. Use Docker Compose for local deployment and service orchestration.
5. Keep one service per container and use private internal networking for inter-service traffic.

## Testing And External Calls
1. Use mock/stub Monica payloads in tests and local validation by default.
2. Do not call a real Monica instance during automated tests or CI runs.
3. Prefer fixtures aligned with `docs/monica-api-contracts.md`.
4. Treat live Monica calls as manual-only and require explicit user approval before running them.

## First-Release Scope
1. Telegram private chats only.
2. Command-based interaction (AI interpretation optional later).
3. Contacts: list/search/get/update basic/career details.
4. Reminders: list/upcoming support and scheduled digests.
5. Notes: list/get/create/update/delete.
6. Voice-to-text for command input.
7. Streaming responses for long operations.

## Out Of Scope (Current PRD)
1. Group chat support.
2. Non-Telegram channels.
3. Default autonomous AI agent behavior.

## Definition Of Done
1. Changes align with PRD scope and architecture boundaries.
2. Security/reliability/observability constraints remain explicit.
3. No unresolved high/medium review findings.
4. TDD sequence is preserved for behavior changes: failing test observed first, then minimal implementation.
5. Relevant tests/checks pass, or gaps are explicitly documented.
6. Delivery summary includes changed files and residual risks.
