---
verdict: APPROVED
attempt: 1
critical_count: 0
high_count: 0
medium_count: 4
---

# Plan Review: Least-Privilege User Management

## Summary

The plan replaces the current stub credential endpoint in `user-management` with a production-ready least-privilege access model. It introduces three new database tables (`users`, `user_preferences`, `credential_access_audit_log`), an AES-256-GCM encryption module with HKDF key derivation, per-endpoint caller allowlists separating credential access (monica-integration only) from preference/schedule access (telegram-bridge, ai-router, scheduler), and audit logging for credential reads. Shared Zod schemas are extracted to `@monica-companion/types`. The plan explicitly preserves the existing `credential-client.ts` contract in `monica-integration`, requiring zero changes to the consuming service.

## Roadmap Coverage

All three sub-items are addressed:

- **Keep Monica credentials encrypted at rest** -- AES-256-GCM encryption module, `users` table with encrypted column, HKDF key derivation
- **Expose audited credential access only to `monica-integration`** -- Per-endpoint caller allowlist, audit log table
- **Expose separate non-secret preference and schedule endpoints** -- Separate auth middlewares with appropriate caller lists

## Findings

### MEDIUM

1. **Missing `userId` path parameter validation.** Endpoints should validate `:userId` as UUID before DB query. Add Zod UUID validation returning 400 on failure.

2. **`encryption_key_id` column design is fragile.** Use a deterministic key identifier derived from key material (e.g., first 8 chars of SHA-256 of derived key) instead of static `'current'` string.

3. **HKDF without salt.** Use a hardcoded constant salt (e.g., `Buffer.from("monica-companion-credential-encryption-v1")`) per RFC 5869 recommendation.

4. **Config-to-handler wiring not specified.** Explicitly state that endpoint handler accesses encryption key via `config.encryptionMasterKey` passed to `createApp`.

### LOW

1. **`MonicaCredentialsResponse` extraction** requires a one-line import change in `credential-client.ts`. Update affected services table.

2. **File naming:** `user-preferences.ts` contains credential schemas too. Consider naming `user-management.ts` or splitting.

3. **Integration test setup** needs careful table creation ordering for FK dependencies. Consider using Drizzle migrations in test setup.

4. **Smoke test data seeding** not described. Add description of how test user is inserted.

## Verdict

**APPROVED.** The plan is well-structured, correctly scoped, and aligns with all architecture and security rules. Medium findings are addressable during implementation without design changes. No critical or high issues found.
