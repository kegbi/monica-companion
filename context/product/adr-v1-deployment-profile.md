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

---

## Validation Addendum (2026-03-17)

### Instrumentation added

BullMQ queue metrics (depth, wait duration, process duration, retry count, dead-letter count) and reminder reliability counters (on-time, late, missed) are now instrumented via OTel custom metrics in the scheduler service. The Operations & Queues Grafana dashboard has been updated with real PromQL panels, and alert rules for SchedulerMisfire, QueueBacklog, and HighRetryRate replace the former placeholder.

### Load test tooling

Load test scripts exist in `tests/load/` covering:
- Queue latency at concurrency levels 5/10/25
- Read-only bypass latency with variable simulated external delays
- Reminder on-time delivery rate
- OpenAI budget gauge accuracy (Redis vs Prometheus)
- Docker resource profiles during load

### Service separation validation criteria

The following criteria are used to validate whether `delivery` and `voice-transcription` warrant separate deployables:

1. **Independent failure domains**: A crash in one does not affect the other or the scheduler.
2. **Independent scaling needs**: Under load, resource consumption differs between queue-driven (scheduler), connector-driven (delivery), and provider-driven (voice-transcription) workloads.
3. **Connector-neutral contract preservation**: Keeping the boundary prevents Telegram-specific concerns from leaking into business logic.
4. **Operational overhead**: The marginal cost of two extra containers is low given the Docker Compose deployment model.

### Measured results

Full measurement data will be recorded in `context/spec/operational-review-findings.md` after load tests are executed against the Docker Compose stack during smoke testing.
