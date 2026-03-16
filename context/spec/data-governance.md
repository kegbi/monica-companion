# Data Governance Specification

## Retention Policies

| Data Category | Retention Period | Enforcement Layer |
|---|---|---|
| Traces (Tempo) | 14 days | Tempo compactor `block_retention: 336h` |
| Logs (Loki) | 14 days | Loki `limits_config.retention_period: 336h` + compactor |
| Metrics (Prometheus) | 14 days | Prometheus `--storage.tsdb.retention.time=14d` |
| Dead-letter payloads | 14 days | Application-level (deferred to Phase 4 when BullMQ DLQ exists) |
| Conversation summaries | 30 days after completion | Application-level (deferred to Phase 3 when conversation state exists) |
| Pending-command records | 30 days after completion | Application-level (deferred to Phase 3) |
| Command logs, delivery audits | 90 days | Application-level (deferred to Phase 4) |
| Voice audio | Not retained post-transcription | Application-level (deferred to Phase 2) |

## Deletion Policies

- **Account disconnection**: Immediate credential deletion, 30-day purge of all user data.
- **Emergency purge**: Retention periods may be shortened for security investigations. Operations team must document the reason and scope.
- **Automated deletion**: Infrastructure-level retention (Loki, Tempo, Prometheus) is enforced automatically by backend compaction. Application-level retention requires scheduled purge jobs, which are deferred to when the relevant data stores are implemented.

## Redaction Scope

All of the following must have sensitive data redacted via `@monica-companion/redaction` before reaching external storage:

- Log records (via `RedactingLogProcessor`)
- Trace span attributes (via `RedactingSpanProcessor`)
- Dead-letter queue payloads (deferred to Phase 4)
- Queue job payloads (deferred to Phase 4)
- Support tooling output (deferred)

### Sensitive Data Patterns

Field names matching (case-insensitive): `authorization`, `api_key`, `apikey`, `api-key`, `password`, `secret`, `token`, `credential`, `cookie`, `encryption_master_key`.

Value patterns: Bearer tokens, JWT-like strings (three base64url segments), OpenAI API keys (`sk-` prefix).

## Production Deployment Notes

### Observability Port Bindings

In development, observability services (Grafana on 3000, Loki on 3100, Tempo on 3200, Prometheus on 9090, OTel Collector on 4317/4318) are bound to all host interfaces via `ports:` in Docker Compose for convenience.

**Production deployments MUST either:**
- Remove the `ports:` mappings for all observability services (use `expose:` only for internal Docker network access), OR
- Bind them to `127.0.0.1` only (e.g., `"127.0.0.1:3000:3000"`)

These services must never be accessible from the public network.

### Grafana Authentication

Development uses anonymous admin access (`GF_AUTH_ANONYMOUS_ENABLED=true`, `GF_AUTH_ANONYMOUS_ORG_ROLE=Admin`). Production deployments must:
- Disable anonymous access
- Configure proper authentication (OAuth, LDAP, or local accounts)
- Set a strong `GF_SECURITY_ADMIN_PASSWORD`

### Grafana Credentials

`GF_SECURITY_ADMIN_PASSWORD` is set to `admin` for development only. Production must use a proper secret management solution.
