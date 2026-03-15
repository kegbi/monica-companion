# Secret Rotation

## JWT Signing Key

### Generate a new key

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

### Rotation procedure

1. Copy the current `JWT_SECRET` value to `JWT_SECRET_PREVIOUS` in `.env`
2. Generate a new key and set it as `JWT_SECRET`
3. Restart all services (`docker compose --profile app restart`)
4. Tokens signed with the previous key are accepted during the dual-key window
5. After 30 seconds (token TTL), all in-flight old tokens have expired
6. Remove `JWT_SECRET_PREVIOUS` from `.env` (optional cleanup)

### How it works

The auth package verifies tokens against `JWT_SECRET` first, then falls back to `JWT_SECRET_PREVIOUS`. Since tokens have a 30-second TTL, old tokens expire almost immediately after rotation. Rolling restarts are safe because services picking up the new secret will still accept tokens signed with the previous secret.

### Rotation frequency

- Every 90 days under normal operation
- Immediately on suspected compromise

## Encryption Master Key

Rotation procedure for `ENCRYPTION_MASTER_KEY` will be defined when credential encryption is implemented in a later phase. The key is used for encrypting MonicaHQ API keys at rest in PostgreSQL.
