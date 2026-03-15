# Reliability Rules

- All external API calls (MonicaHQ, OpenAI, Telegram) must have timeout handling.
- Transient failures on external calls must be retried with exponential backoff.
- Large Monica datasets must be handled with safe pagination — never assume all data fits in one response.
- Users must receive graceful fallback messages when operations fail — no raw error dumps.
- Strict payload validation (Zod schemas) must be applied on all inbound/outbound requests.
- ALL commands (real-time and scheduled) must flow through the scheduler for uniform retry, idempotency, and error handling.
- Duplicate sends for the same schedule window must be prevented.
