# Implementation Plan: Safe Multi-Instance Support

## Objective

Prevent SSRF and ensure URL hygiene for user-supplied Monica base URLs. Each user connects their own MonicaHQ instance by providing a base URL during onboarding. This task normalizes those URLs into a canonical form, rejects insecure or dangerous targets (`http://`, loopback, RFC1918, link-local, DNS rebinding), and provides a documented operator override for trusted single-tenant deployments that intentionally target local-network Monica instances.

This directly addresses three roadmap sub-items under "Safe Multi-Instance Support" and satisfies the security rules in `.claude/rules/security.md` requiring HTTPS enforcement, blocked target rejection after DNS resolution, and a documented operator override.

## Scope

### In Scope

- A shared URL validation module in `packages/monica-api-lib` that normalizes and validates Monica base URLs.
- Canonical normalization rules: lowercase scheme and host, strip trailing slashes, ensure `/api` suffix, reject fragments and userinfo.
- Blocked target rejection in hosted default: `http://` scheme, loopback (`127.0.0.0/8`, `::1`), RFC1918 (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`), link-local (`169.254.0.0/16`, `fe80::/10`), and DNS rebinding protection (resolve hostname, check resolved IP).
- Operator override via environment variable (`ALLOW_PRIVATE_NETWORK_TARGETS=true`) for single-tenant deployments.
- Integration of URL validation into `monica-integration` service at request time (in `shared.ts` before creating the `MonicaApiClient`).
- Persisting the canonical form: the validation module produces a canonical URL string that is what gets stored and used downstream.
- Update `.env.example` with the new environment variable and documentation.
- Comprehensive unit tests for every validation rule and edge case.
- Docker Compose smoke test verifying the real network path.

### Out of Scope

- Full onboarding form implementation in `web-ui` (URL validation at write-time will be added when the full form is built in "Least-Privilege User Management").
- Encrypted credential storage in `user-management` (that is "Least-Privilege User Management").
- HTTP redirect interception and target validation on each redirect hop (see Risks section).
- Database schema changes for persisting the canonical URL (proper storage comes with "Least-Privilege User Management").

## Affected Services & Packages

| Package/Service | Changes |
|-----------------|---------|
| `packages/monica-api-lib` | New `src/url-validation.ts` module with `normalizeMonicaUrl`, `validateMonicaUrl`, IP range checkers, and `MonicaUrlValidationError`. New `src/__tests__/url-validation.test.ts`. Update `src/index.ts` exports. Refactor private `normalizeBaseUrl` in `src/client.ts` to use the shared normalization. |
| `services/monica-integration` | Update `src/config.ts` to add `allowPrivateNetworkTargets` config option. Update `src/routes/shared.ts` to normalize and validate the base URL before creating the `MonicaApiClient`. Update error handlers in route files. Update tests. |
| `docker-compose.yml` | Add `ALLOW_PRIVATE_NETWORK_TARGETS` env var to `monica-integration` service. |
| `.env.example` | Add documented `ALLOW_PRIVATE_NETWORK_TARGETS` variable with security warning. |

## Architecture Decisions

### Where URL Validation Lives

The URL validation module lives in `@monica-companion/monica-api-lib` because:

1. It is Monica-specific (it understands the `/api` suffix convention).
2. It will be needed by both `monica-integration` (at request time) and `user-management` (at onboarding write time, in a future task).
3. Keeping it in the shared library avoids duplication and ensures consistent rules across services.

The module exports two functions with distinct responsibilities:

- `normalizeMonicaUrl(rawUrl: string): string` -- Pure synchronous URL normalization (canonical form). No network calls. Throws on malformed URLs.
- `validateMonicaUrl(normalizedUrl: string, options: ValidateMonicaUrlOptions): Promise<void>` -- Async validation that performs DNS resolution and checks the resolved IP against blocked ranges. Throws a typed `MonicaUrlValidationError` on failure.

These are separate because normalization is synchronous and cheap (safe at storage time) while DNS validation is async and must be done at connection time (DNS results can change between storage and use).

### Operator Override Mechanism

A single environment variable `ALLOW_PRIVATE_NETWORK_TARGETS` (string `"true"` / `"false"`, default `"false"`) controls whether private network targets and `http://` scheme are allowed. When `"true"`:

- `http://` URLs are accepted (not only `https://`).
- Loopback, RFC1918, and link-local resolved IPs are accepted.
- DNS resolution still runs (the URL must still resolve to a valid IP).

### Normalization Rules (Canonical Form)

1. Parse with `new URL(rawUrl)`. Throw `MonicaUrlValidationError` (`INVALID_URL`) on failure.
2. Reject URLs with `username` or `password` (userinfo). Code: `USERINFO_NOT_ALLOWED`.
3. Reject URLs with `hash` (fragment). Code: `FRAGMENT_NOT_ALLOWED`.
4. Scheme must be `http:` or `https:`. Reject anything else. Code: `INVALID_URL`.
5. Lowercase scheme and hostname.
6. Strip default ports (`:443` for `https:`, `:80` for `http:`).
7. Normalize pathname: remove trailing slashes, then ensure it ends with `/api`.
8. Reconstruct as `${protocol}//${host}${pathname}`.

### Blocked Target Rules (Hosted Default)

Applied to the **resolved IP address(es)** of the hostname:

| Category | Ranges |
|----------|--------|
| Non-HTTPS scheme | `http://` |
| Loopback IPv4 | `127.0.0.0/8` |
| Loopback IPv6 | `::1` |
| RFC1918 Class A | `10.0.0.0/8` |
| RFC1918 Class B | `172.16.0.0/12` |
| RFC1918 Class C | `192.168.0.0/16` |
| Link-local IPv4 | `169.254.0.0/16` |
| Link-local IPv6 | `fe80::/10` |
| Unspecified | `0.0.0.0`, `::` |

DNS resolution uses Node.js `dns.promises.lookup` with `{ all: true }`. **All** resolved addresses must pass; if any is blocked, the URL is rejected.

### Integration Point

In `services/monica-integration/src/routes/shared.ts`, the `createMonicaClient` function:

1. `normalizeMonicaUrl(credentials.baseUrl)` for canonical form.
2. `await validateMonicaUrl(canonicalUrl, { allowPrivateNetworkTargets: config.allowPrivateNetworkTargets })` for scheme and IP checks.
3. Only if both pass is `MonicaApiClient` created with the canonical URL.
4. On failure, `MonicaUrlValidationError` is thrown, mapped to HTTP 422.

## Implementation Steps

### Step 1: URL Normalization Function and Error Type

**What:** Create `packages/monica-api-lib/src/url-validation.ts` with `MonicaUrlValidationError` and `normalizeMonicaUrl`.

**Files to create:**
- `packages/monica-api-lib/src/url-validation.ts`
- `packages/monica-api-lib/src/__tests__/url-validation.test.ts`

**Details:**
- `MonicaUrlValidationErrorCode` type: `"INVALID_URL" | "USERINFO_NOT_ALLOWED" | "FRAGMENT_NOT_ALLOWED" | "HTTP_NOT_ALLOWED" | "BLOCKED_IP" | "DNS_RESOLUTION_FAILED"`.
- `MonicaUrlValidationError extends Error` with `readonly code: MonicaUrlValidationErrorCode`.
- `normalizeMonicaUrl(rawUrl: string): string` with canonical normalization rules.

**Test (TDD):**
- `"https://app.monicahq.com"` -> `"https://app.monicahq.com/api"`
- `"https://app.monicahq.com/"` -> `"https://app.monicahq.com/api"`
- `"https://app.monicahq.com/api"` -> `"https://app.monicahq.com/api"`
- `"https://app.monicahq.com/api/"` -> `"https://app.monicahq.com/api"`
- `"HTTPS://APP.MONICAHQ.COM/API"` -> `"https://app.monicahq.com/api"` (lowercase)
- `"https://app.monicahq.com:443/api"` -> `"https://app.monicahq.com/api"` (strip default port)
- `"https://monica.example.com:8443/api"` -> `"https://monica.example.com:8443/api"` (preserve non-default port)
- `"https://example.com/monica"` -> `"https://example.com/monica/api"` (append /api)
- `"https://user:pass@example.com"` -> throws `USERINFO_NOT_ALLOWED`
- `"https://example.com/api#frag"` -> throws `FRAGMENT_NOT_ALLOWED`
- `"not-a-url"` -> throws `INVALID_URL`
- `"ftp://example.com"` -> throws `INVALID_URL`

### Step 2: IP Range Checking Utilities

**What:** Add IP address range checking functions to `url-validation.ts`.

**Details:**
- `isBlockedIpv4(ip: string): boolean` -- Parse octets, check loopback/RFC1918/link-local/unspecified.
- `isBlockedIpv6(ip: string): boolean` -- Check `::1`, `::`, `fe80::/10`, IPv4-mapped `::ffff:x.x.x.x`.
- `isBlockedIp(ip: string): boolean` -- Dispatch by type.

**Test (TDD):**
- IPv4: `127.0.0.1` blocked, `10.0.0.1` blocked, `172.16.0.1` blocked, `192.168.0.1` blocked, `169.254.1.1` blocked, `0.0.0.0` blocked, `8.8.8.8` NOT blocked.
- IPv6: `::1` blocked, `fe80::1` blocked, `::` blocked, `::ffff:127.0.0.1` blocked, `2607:f8b0:4004:800::200e` NOT blocked.

### Step 3: Async URL Validation with DNS Resolution

**What:** Add `validateMonicaUrl` async function with DNS resolution and IP checking.

**Details:**
- `ValidateMonicaUrlOptions`: `{ allowPrivateNetworkTargets: boolean, dnsLookup?: ... }`.
- Check scheme (reject `http://` unless override enabled).
- Resolve hostname via DNS, check all resolved IPs.
- IP literals checked directly without DNS.

**Test (TDD) -- mock dnsLookup:**
- Public HTTPS URL passes.
- HTTP URL without override throws `HTTP_NOT_ALLOWED`.
- URL resolving to `127.0.0.1` throws `BLOCKED_IP`.
- URL resolving to blocked IP with override=true passes.
- DNS failure throws `DNS_RESOLUTION_FAILED`.
- Multi-address with one blocked throws `BLOCKED_IP`.

### Step 4: Export from `monica-api-lib`

**What:** Update exports in `packages/monica-api-lib/src/index.ts`.

### Step 5: Refactor Client `normalizeBaseUrl`

**What:** Replace private `normalizeBaseUrl` in `client.ts` with shared `normalizeMonicaUrl`. Existing tests must pass.

### Step 6: `monica-integration` Config Update

**What:** Add `allowPrivateNetworkTargets` to config schema.

**Test (TDD):**
- Default produces `false`.
- `"true"` produces `true`.
- Invalid value `"yes"` throws.

### Step 7: Integrate URL Validation into `shared.ts`

**What:** Modify `createMonicaClient` to normalize and validate URL before creating client.

### Step 8: Update Route Error Handlers

**What:** Add `MonicaUrlValidationError` handling, return 422 with generic message.

**Test (TDD):**
- Mock throws `MonicaUrlValidationError`. Verify 422 response.
- Verify no URL/IP leaks in response body.

### Step 9: Docker Compose and `.env.example` Updates

**What:** Wire `ALLOW_PRIVATE_NETWORK_TARGETS` env var.

### Step 10: Smoke Test

**Services:** postgres, redis, user-management, monica-integration.

**Checks:**
1. Health check passes.
2. Loopback URL (`http://127.0.0.1`) returns 422.
3. Public HTTPS URL passes URL validation (may fail at Monica API level).
4. Override=true allows private targets.

## Test Strategy

| Test File | Tests | Mocks |
|-----------|-------|-------|
| `packages/monica-api-lib/src/__tests__/url-validation.test.ts` | URL normalization (15+ cases), IP blocking (20+ cases), async validation (15+ cases) | `dnsLookup` (injected) |
| `packages/monica-api-lib/src/__tests__/client.test.ts` | Existing normalization tests still pass | `fetch` (existing) |
| `services/monica-integration/src/__tests__/config.test.ts` | `ALLOW_PRIVATE_NETWORK_TARGETS` parsing | None |
| `services/monica-integration/src/__tests__/app.test.ts` | URL validation error -> 422 | `createMonicaClient` (existing) |

## Security Considerations

- **SSRF protection:** DNS resolution-based checking prevents hostname-to-IP rebinding.
- **HTTPS enforcement:** `http://` rejected in hosted default.
- **No credential leakage:** URLs never logged, error responses use generic messages.
- **Service boundary:** URL validation in `monica-api-lib`, enforced only in `monica-integration`.
- **Operator override:** Documented, defaults secure, opt-in only.

## Risks & Open Questions

1. **DNS resolution timing:** Per-request validation mitigates DNS rebinding.
2. **Redirect-following:** Initial URL validated, redirect targets not intercepted (documented as future hardening).
3. **IPv6 edge cases:** IPv4-mapped IPv6 explicitly handled and tested.
4. **`dns.promises.lookup` behavior:** Conservative approach -- reject if ANY resolved address is blocked.
5. **Stub credential endpoint returns raw env var:** Request-time validation in `monica-integration` is the primary defense.
