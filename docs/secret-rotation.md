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

The `ENCRYPTION_MASTER_KEY` is used to encrypt MonicaHQ API tokens at rest in PostgreSQL using AES-256-GCM. A per-purpose key is derived from the master key via HKDF-SHA256.

### Generate a new key

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

The key must be at least 32 bytes (256 bits). Provide it as a 64-character hex string or a base64url-encoded string.

### Rotation procedure

1. Copy the current `ENCRYPTION_MASTER_KEY` value to `ENCRYPTION_MASTER_KEY_PREVIOUS` in `.env`
2. Generate a new key and set it as `ENCRYPTION_MASTER_KEY`
3. Restart `user-management` (`docker compose --profile app restart user-management`)
4. On subsequent credential reads, `user-management` will:
   - Try decrypting with the new key first
   - If decryption fails (auth tag mismatch), try the previous key
   - If the previous key succeeds, the credential is transparently re-encrypted with the new key on the next write
5. After all users have had their credentials accessed (or a bulk re-encryption job is run), remove `ENCRYPTION_MASTER_KEY_PREVIOUS` from `.env`

### How it works

Each encrypted credential is stored as `base64(iv || ciphertext || authTag)`. The encryption key is derived from the master key using HKDF with:
- Hash: SHA-256
- Salt: `monica-companion-credential-encryption-v1` (constant)
- Info: `monica-credential-encryption`

Each user row stores an `encryption_key_id` (first 8 hex chars of SHA-256 of the derived key) to track which key version was used.

On read, the service tries the current key first. If decryption fails and a previous key is configured, it falls back to the previous key. This allows zero-downtime rotation without a separate migration step.

### Rotation frequency

- Every 180 days under normal operation
- Immediately on suspected compromise of the master key
- Never log the key value during rotation
