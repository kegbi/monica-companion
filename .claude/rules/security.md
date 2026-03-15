# Security Rules

- Service-to-service authentication is required on all internal endpoints (signed JWT via `@monica-companion/auth`).
- Each service must enforce caller allowlists — only explicitly expected callers are accepted.
- Internal endpoints are closed to anonymous traffic. Security checks are enforced per endpoint, not only at the edge.
- MonicaHQ API keys are encrypted at rest (AES-256) in PostgreSQL. Never store credentials in plaintext.
- Sensitive data (API keys, personal contact info, credentials) must be redacted from all logs via `@monica-companion/redaction`.
- Idempotency must be enforced at scheduler ingress to prevent duplicate command execution.
- The Telegram bot operates in private chats only — group messages must be rejected.
- Credentials are never sent through Telegram chat — only via the web-ui over HTTPS.
- JWT signing keys and encryption master keys follow a defined rotation schedule.
- Keep secrets out of logs, responses, and error messages.
