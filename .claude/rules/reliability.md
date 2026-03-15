# Reliability Rules

- All external API calls (MonicaHQ, OpenAI, Telegram) must have explicit timeout handling.
- Transport-level quick retries belong only in the edge client for that dependency. Scheduler owns job-level retries and must not duplicate the transport retry budget.
- Large Monica datasets must be handled with safe pagination.
- All confirmed commands and scheduled reminder jobs must flow through `scheduler` for uniform idempotency, auditability, and job-level retry handling.
- Read-only queries, clarification prompts, and other non-mutating conversational responses must bypass `scheduler` and stay on the live request path.
- Pending commands must carry correlation ID, version, and TTL so stale confirmations can be rejected safely.
- Reminder schedules must use stored IANA timezones and deterministic schedule-window dedupe keys.
- DST spring-forward and fall-back behavior plus misfire catch-up rules must be explicit and tested.
- Duplicate sends for the same schedule window must be prevented.
- Users must receive graceful fallback messages when operations fail.
- Strict payload validation with Zod must be applied on all inbound and outbound service contracts.
- Dead-letter payloads must stay redacted.
