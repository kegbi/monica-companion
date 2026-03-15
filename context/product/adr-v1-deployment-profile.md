# ADR: V1 Deployment Profile

- **Status:** Accepted
- **Date:** 2026-03-15

## Context

The logical architecture defines 8 service boundaries: `telegram-bridge`, `ai-router`, `voice-transcription`, `monica-integration`, `scheduler`, `delivery`, `user-management`, and `web-ui`.

The repository is still documentation-first, and `context/product/monica-api-scope.md` is not complete yet. Shipping all 8 boundaries as standalone deployables in the first Telegram-only release would add avoidable operational overhead before the Monica contract and the live workflow are stable.

## Decision

- Preserve all 8 logical service boundaries and their connector-neutral contracts in the documentation and package structure.
- Use an initial Telegram-only V1 deployment profile with 8 application containers:
  - `telegram-bridge`
  - `ai-router`
  - `voice-transcription`
  - `monica-integration`
  - `scheduler`
  - `delivery`
  - `user-management`
  - `web-ui`
- Route only confirmed mutating commands and scheduled reminder jobs through `scheduler`.
- Keep read-only queries, clarification prompts, and other non-mutating conversational responses on the synchronous `ai-router -> delivery` path.
- Keep `voice-transcription` and `delivery` as separate deployables in V1 because they isolate different provider/runtime concerns, preserve connector-neutral contracts, and avoid overloading `telegram-bridge` with unrelated responsibilities.

## Consequences

- The initial V1 deployment carries more operational overhead than an embedded profile, but the responsibilities and failure domains are cleaner.
- The logical contracts remain stable because the deployable boundaries match the documented service boundaries from the start.
- Container counts in docs must distinguish between logical boundaries and the initial deployment profile.
