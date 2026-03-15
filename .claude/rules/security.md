# Security Rules

- Service-to-service authentication is required on all internal endpoints using signed JWTs from `@monica-companion/auth`.
- Each service must enforce per-endpoint caller allowlists. Do not treat a service-wide allowlist as sufficient when endpoints have different privilege levels.
- Public ingress is limited to the Telegram webhook and onboarding web UI. Internal APIs and `/health` endpoints must not be exposed publicly.
- Telegram webhook ingress must verify authenticity, enforce request-size limits, and apply rate limiting before business logic runs.
- Setup links are authentication artifacts. They must be signed, one-time, short-lived, bound to Telegram user identity and onboarding step, and rejected if replayed or expired.
- Onboarding form submission must use HTTPS plus CSRF/origin protections.
- MonicaHQ API keys are encrypted at rest in PostgreSQL. Never store credentials in plaintext.
- Only `monica-integration` may obtain decrypted Monica credentials, and only through an audited narrow endpoint on `user-management`.
- Monica base URLs must be normalized canonically, require HTTPS in the hosted default, and reject loopback, RFC1918, link-local, and blocked redirect targets after DNS resolution.
- Sensitive data must be redacted from logs, traces, queue payloads, dead letters, and support tooling via `@monica-companion/redaction`.
- Idempotency must be enforced at scheduler ingress to prevent duplicate command execution.
- The Telegram bot operates in private chats only.
- JWT signing keys and encryption master keys follow a defined rotation schedule.
- Keep secrets and unnecessary personal data out of logs, responses, error messages, and trace attributes.
