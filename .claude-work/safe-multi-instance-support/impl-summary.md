# Implementation Summary: Safe Multi-Instance Support

## Files Changed
| File | Action | Description |
|------|--------|-------------|
| `packages/monica-api-lib/src/url-validation.ts` | created | URL normalization, IP range checking, and async DNS-based validation module |
| `packages/monica-api-lib/src/__tests__/url-validation.test.ts` | created | Comprehensive tests: 46 test cases covering normalization, IP blocking, async validation |
| `packages/monica-api-lib/src/index.ts` | modified | Added exports for MonicaUrlValidationError, normalizeMonicaUrl, validateMonicaUrl, isBlockedIp |
| `packages/monica-api-lib/src/client.ts` | modified | Replaced private normalizeBaseUrl with shared normalizeMonicaUrl; added redirect: "manual" + validateRedirectTarget for SSRF protection |
| `packages/monica-api-lib/src/__tests__/client.test.ts` | modified | Added 3 redirect protection tests |
| `packages/monica-api-lib/package.json` | modified | Added @types/node dev dependency for node:net and node:dns type support |
| `services/monica-integration/src/config.ts` | modified | Added ALLOW_PRIVATE_NETWORK_TARGETS with z.enum validation producing boolean |
| `services/monica-integration/src/__tests__/config.test.ts` | modified | Added 5 tests for the new config option |
| `services/monica-integration/src/routes/shared.ts` | modified | Added URL normalization + validation to createMonicaClient; extracted shared handleMonicaError with MonicaUrlValidationError -> 422 handling |
| `services/monica-integration/src/routes/read.ts` | modified | Removed local handleMonicaError; imports shared version from shared.ts |
| `services/monica-integration/src/routes/write.ts` | modified | Removed local handleMonicaError; imports shared version from shared.ts |
| `services/monica-integration/src/routes/reference.ts` | modified | Removed local handleMonicaError; imports shared version from shared.ts |
| `services/monica-integration/src/__tests__/app.test.ts` | modified | Added observability mock, updated testConfig, added 3 URL validation error tests |
| `docker-compose.yml` | modified | Added ALLOW_PRIVATE_NETWORK_TARGETS env var to monica-integration service |
| `.env.example` | modified | Added documented ALLOW_PRIVATE_NETWORK_TARGETS variable with security warning |

## Tests Added
| Test File | What It Tests |
|-----------|---------------|
| `packages/monica-api-lib/src/__tests__/url-validation.test.ts` | 46 tests: URL normalization (15 cases incl. IPv4/IPv6 literals), IP blocking (20 cases for v4/v6/mapped), async validation (11 cases for scheme/DNS/blocking/overrides) |
| `packages/monica-api-lib/src/__tests__/client.test.ts` | 3 new tests: redirect rejection, blocked IP redirect detection, redirect: manual flag |
| `services/monica-integration/src/__tests__/config.test.ts` | 5 new tests: default false, "true" -> true, "false" -> false, rejects "yes", rejects "1" |
| `services/monica-integration/src/__tests__/app.test.ts` | 3 new tests: 422 on URL validation error, no IP/URL leakage in response, 422 on write endpoints |

## Verification Results
- **Biome**: `pnpm biome check` -- 54 files checked, no issues
- **Tests (monica-api-lib)**: 6 test files, 144 tests passed, 0 failed
- **Tests (monica-integration)**: 5 test files, 51 tests passed, 0 failed

## Plan Deviations

1. **Pre-existing app.test.ts failure**: The `@monica-companion/observability` package could not be resolved in the test environment due to a Windows symlink issue with pnpm. This was a pre-existing issue (confirmed by stashing changes and testing the original code). Fixed by adding a `vi.mock("@monica-companion/observability")` mock in app.test.ts.

2. **@types/node dependency**: Added `@types/node` as a devDependency to `packages/monica-api-lib` because the new `url-validation.ts` module uses `node:net` and `node:dns` which need type declarations for the DTS build. This was not in the plan but is required for the build to succeed.

3. **Package rebuild**: Had to rebuild `packages/monica-api-lib` dist so that the `monica-integration` service (which imports from `dist/index.js`) could access the new `MonicaUrlValidationError` export.

4. **Smoke test (Step 10) not executed**: Docker Compose smoke tests were not run because this is an environment constraint (Windows development). The smoke test step is deferred per the completion rules -- the roadmap item should only be marked complete after Docker Compose smoke tests pass against the live stack.

## Review Findings Addressed

| Finding | Status | How Addressed |
|---------|--------|---------------|
| MEDIUM #1: Redirect protection | Done | Added `redirect: "manual"` to fetch, `validateRedirectTarget` checks Location header against `isBlockedIp` |
| MEDIUM #2: DRY consolidation | Done | Extracted `handleMonicaError` into `routes/shared.ts`, removed 3 duplicate copies from read/write/reference |
| MEDIUM #3: Config schema | Done | Used `z.enum(["true", "false"]).default("false").transform(v => v === "true")` |
| LOW #1: IP literal test cases | Done | Added tests for `"https://192.0.2.1:443/api"` and `"https://[2001:db8::1]/api"` |
| LOW #2: Smoke test assertion | Documented | Smoke test not yet executed; the plan notes to assert NOT 422 rather than success |

## Residual Risks

1. **Smoke test pending**: Docker Compose smoke test (Step 10) has not been run. The roadmap item should not be marked complete until the smoke test confirms the real network path.

2. **Redirect protection covers IP literals only**: The `validateRedirectTarget` method checks the redirect Location header against blocked IP ranges only for IP literal hostnames. For domain-name redirect targets, it does not perform DNS resolution (which would require async code in the sync `validateRedirectTarget` method). The redirect is still rejected with a `MonicaNetworkError` in all cases -- it just may not produce the more specific `MonicaUrlValidationError` for domain-name redirect targets.

3. **IPv6 link-local prefix check**: The `isBlockedIpv6` function uses string comparison for the fe80::/10 range. This is correct for the standard `fe80::` through `febf::` prefix range but does not handle all possible IPv6 representations. The `isIPv6` guard ensures only valid IPv6 strings reach this code.

4. **Windows pnpm symlink issue**: The `@monica-companion/observability` package cannot be resolved in the test environment on Windows. A mock was added to `app.test.ts` to work around this. This may need investigation for the CI environment.
