---
verdict: APPROVED
findings_critical: 0
findings_high: 0
findings_medium: 2
findings_low: 2
biome_pass: true
tests_pass: true
test_count: 299
---

# Code Review: Safe Multi-Instance Support

## Automated Checks
- **Biome**: PASS -- 179 project source files checked, 0 issues. (One pre-existing formatting error in `.claude/settings.local.json` due to Windows CRLF line endings; this file is not part of the implementation and is gitignored from Biome scope.)
- **Tests**:
  - `@monica-companion/monica-api-lib`: 6 test files, **144 passed**, 0 failed
  - `@monica-companion/monica-integration`: 5 test files, **51 passed**, 0 failed
  - `@monica-companion/auth`: 5 test files, 55 passed, 0 failed (no regressions)
  - `@monica-companion/redaction`: 1 test file, 40 passed, 0 failed (no regressions)
  - `@monica-companion/types`: 1 test file, 9 passed, 0 failed (no regressions)
  - `@monica-companion/observability`: 2 test files FAILED -- **pre-existing** Windows pnpm symlink issue (confirmed by testing on clean `main` without implementation changes). Not caused by this implementation.

## Findings

### CRITICAL
(none)

### HIGH
(none)

### MEDIUM

1. [MEDIUM] `packages/monica-api-lib/src/url-validation.ts:134-145` -- The `isBlockedIpv6` link-local check uses a two-layer approach with broad `startsWith` guards and a string comparison inner check. While the inner comparison `prefix >= "fe80" && prefix <= "febf"` is mathematically correct for `fe80::/10`, the outer guard conditions (`startsWith("fe8")`, `startsWith("fe9")`, `startsWith("fea")`, `startsWith("feb")`) are redundant noise since the inner check alone is sufficient. More importantly, an address like `"fe80"` (exactly 4 chars, no colon) would pass the `startsWith("fe80")` guard AND the inner check, but `node:net`'s `isIPv6` would reject it upstream, so this is not exploitable. However, the code is harder to reason about than necessary. -- **Fix:** Simplify to just extract the first 4 chars and do the range check directly: `const prefix = lower.slice(0, 4); if (prefix >= "fe80" && prefix <= "febf") return true;` This eliminates the redundant outer guards.

2. [MEDIUM] `services/monica-integration/src/__tests__/app.test.ts:31-49` -- The `handleMonicaError` function is duplicated in the mock (`vi.mock("../routes/shared.js")`) and in the real `shared.ts`. If the real `handleMonicaError` logic changes (e.g., adding new error types), the mock will diverge silently. The duplication exists because the observability package cannot be imported in tests on Windows. -- **Fix:** Extract the error-handling logic into a separate file (e.g., `routes/error-handler.ts`) that does not import from `@monica-companion/observability`, so the test can import the real implementation rather than duplicating it in a mock. Alternatively, document this as a known test fragility with a TODO comment in the mock.

### LOW

1. [LOW] `packages/monica-api-lib/src/client.ts:320-340` -- `validateRedirectTarget` only checks IP literal hostnames in redirect Location headers. Domain-name redirect targets are not checked against blocked IPs because DNS resolution would require async code. This is documented in the implementation summary as a residual risk, and redirects are still rejected with `MonicaNetworkError` regardless. -- **Fix:** No immediate fix required; this is a documented limitation. Consider adding a comment in the method explaining that domain-name redirect targets bypass IP checking but are still rejected as unsupported redirects.

2. [LOW] `packages/monica-api-lib/src/url-validation.ts:148` -- The IPv4-mapped IPv6 regex `^::ffff:(\d+\.\d+\.\d+\.\d+)$` does not handle uppercase `FFFF` or mixed-case variants. This is safe because `lower` is already lowercased on line 125, so the regex always matches the lowercase form. However, if this function were ever called independently (not through `isBlockedIp`), the case-insensitivity would be lost. -- **Fix:** Add a brief comment noting that case-insensitivity is guaranteed by the `lower` variable.

## Plan Compliance

The implementation follows the approved plan faithfully across all 9 implementation steps (Step 10, the smoke test, is correctly deferred due to Windows environment constraints).

All 5 plan review findings were addressed:
- **MEDIUM #1 (Redirect protection)**: Implemented via `redirect: "manual"` and `validateRedirectTarget` in `client.ts`.
- **MEDIUM #2 (DRY consolidation)**: `handleMonicaError` extracted to `routes/shared.ts`; removed from `read.ts`, `write.ts`, `reference.ts`.
- **MEDIUM #3 (Config schema)**: Uses `z.enum(["true", "false"]).default("false").transform(v => v === "true")` exactly as recommended.
- **LOW #1 (IP literal test cases)**: Tests added for `"https://192.0.2.1:443/api"` and `"https://[2001:db8::1]/api"`.
- **LOW #2 (Smoke test assertion)**: Documented as deferred; not applicable without Docker Compose environment.

Justified deviations from plan:
- Added `@types/node` devDependency to `monica-api-lib` (required for `node:net` and `node:dns` type declarations -- necessary for build).
- Added `vi.mock("@monica-companion/observability")` in `app.test.ts` to work around a pre-existing Windows symlink issue.
- Smoke test (Step 10) deferred -- documented appropriately.

## Verdict Rationale

The implementation is well-structured and comprehensive:

1. **URL normalization** correctly handles all specified cases: trailing slashes, `/api` suffix, lowercase, default port stripping, subpaths, IPv4/IPv6 literals, and rejects userinfo/fragments/non-HTTP schemes.

2. **IP range checking** covers all required blocked ranges: loopback (127.0.0.0/8, ::1), RFC1918 (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16), link-local (169.254.0.0/16, fe80::/10), unspecified (0.0.0.0, ::), and IPv4-mapped IPv6.

3. **DNS resolution** checks ALL resolved addresses (not just the first), correctly rejecting multi-homed hosts where any address is blocked.

4. **Operator override** (`ALLOW_PRIVATE_NETWORK_TARGETS`) works correctly with strict Zod enum validation, defaults to false, and bypasses both scheme and IP restrictions when enabled.

5. **Redirect protection** is implemented with `redirect: "manual"` and Location header validation against blocked IPs.

6. **DRY consolidation** is clean -- three identical `handleMonicaError` functions replaced with a single shared version that also handles the new `MonicaUrlValidationError`.

7. **No URL/IP leaks** -- error responses use generic messages, and the test explicitly verifies no IP addresses appear in 422 responses.

8. **Security boundaries respected** -- URL validation lives in `monica-api-lib` (shared package), enforcement happens in `monica-integration` only, and no Monica-specific types leak into other services.

9. **Test coverage is thorough** -- 57 new tests across 4 test files covering normalization, IP blocking, async validation, redirect protection, config parsing, and HTTP error mapping.

All automated checks pass (excluding pre-existing observability test failure). Zero CRITICAL or HIGH findings. APPROVED.
