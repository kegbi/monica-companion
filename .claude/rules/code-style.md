# Code Style & Stack

- TypeScript on Node.js for all services.
- pnpm monorepo with workspaces — shared packages and service packages.
- Zod for all runtime schema validation (API contracts, command payloads, config).
- Drizzle ORM for database queries — schemas defined in shared package.
- Biome for linting and formatting (replaces ESLint + Prettier).
- tsx for development, tsup for production Docker builds.
- grammY for Telegram bot (TypeScript-first).
- LangGraph TS for AI/LLM orchestration.
- BullMQ + Redis for job queues and scheduling.
- OpenTelemetry SDK for instrumentation (logs, metrics, traces).
- Vitest for all tests.
- Husky + lint-staged for pre-commit hooks.
