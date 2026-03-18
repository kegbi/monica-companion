---
verdict: APPROVED
attempt: 1
biome_pass: true
tests_pass: true
test_summary: "voice-transcription: 38 passed, 0 failed; types: 130 passed, 0 failed; telegram-bridge: 81 passed, 0 failed"
critical_count: 0
high_count: 0
medium_count: 2
---

# Code Review: Voice Transcription

## Automated Checks
- **Biome**: PASS -- 0 errors, 93 pre-existing warnings (all `any` casts in test files across the project, none introduced by this change)
- **Tests**:
  - `@monica-companion/voice-transcription`: 5 files, 38 passed, 0 failed
  - `@monica-companion/types`: 8 files, 130 passed, 0 failed
  - `@monica-companion/telegram-bridge`: 17 files, 81 passed, 0 failed

## Summary

A solid implementation that replaces the voice-transcription stub with real Whisper API integration. The code correctly uses dependency injection for the WhisperClient, applies guardrail middleware for per-user rate limiting/budget/concurrency, implements SSRF protections on fetch-URL downloads, provides user-safe error messages, and adds OTel spans throughout. All plan review medium findings (M1-M4) have been addressed. The telegram-bridge userId fix is correctly wired end-to-end. Test coverage is thorough across all new modules.

## Findings

### CRITICAL
(none)

### HIGH
(none)

### MEDIUM

1. [MEDIUM] `services/voice-transcription/src/transcription-handler.ts:188` -- The outer catch block logs `e.message` for unexpected errors. If an unexpected exception somehow carries sensitive data (e.g., an OpenAI SDK error including the API key in the message), this would be logged before the OTel redacting processors can intercept it in non-OTel log sinks. The observability package's RedactingLogProcessor and RedactingSpanProcessor do handle this for OTel-exported logs and spans, so the risk is limited to console output in development. -- **Fix:** Consider wrapping the error message through `redactString()` from `@monica-companion/redaction` before logging, or confirm that the `createLogger` implementation already pipes through the redacting processor for all output targets. Since the observability package wires RedactingLogProcessor into the OTel SDK pipeline and the production deployment uses OTel collectors, this is acceptable for V1 but should be documented as a known limitation for local development.

2. [MEDIUM] `services/voice-transcription/src/app.ts:42-45` -- The `costEstimator` returns a flat `config.whisperCostPerMinuteUsd` (which defaults to $0.006) regardless of audio duration. The implementation summary acknowledges this deviation from the plan's M2 finding (duration-based estimation) and explains that audio duration metadata is not available at middleware execution time. This is a reasonable trade-off for V1 since the budget is a safety cap, not a billing system, but the comment is misleading -- it says "Duration-based cost estimation per M2 finding" when it is actually a flat rate. -- **Fix:** Update the comment to accurately describe the behavior: "Flat per-request cost estimate. Audio duration is not available at middleware time; see impl-summary.md for rationale."

### LOW

1. [LOW] `services/voice-transcription/src/whisper-client.ts:78` -- The `RETRY_DELAY_MS = 1000` constant introduces a 1-second sleep in tests when testing the retry path. This slows down the test suite. -- **Fix:** Consider making the retry delay configurable via `WhisperClientOptions` (with a default of 1000ms) so tests can set it to 0 or 1ms.

2. [LOW] `services/voice-transcription/src/audio-fetcher.ts:55` -- The `^\[?fd/i` regex pattern for blocking `fd00::/8` addresses is overly broad -- it would also match hostnames that simply start with "fd" (e.g., `fdexample.com`). In practice this is unlikely to cause false positives since these are IPv6 addresses in bracket notation, but the regex could be more precise. -- **Fix:** Tighten the pattern to `^\[?fd[0-9a-f]{2}:/i` to match only valid `fd00::/8` ULA prefixes.

3. [LOW] `services/voice-transcription/package.json` -- `@monica-companion/redaction` is listed as a dependency but never directly imported in any source file under `services/voice-transcription/src/`. It is used transitively through `@monica-companion/observability`. -- **Fix:** Remove the direct dependency on `@monica-companion/redaction` since it is a transitive dependency via observability, or add a direct import if redaction functions are needed in the future.

4. [LOW] `services/voice-transcription/src/transcription-handler.ts:103` -- Audio fetch failures return HTTP 200 with `success: false`. This is consistent with Whisper API failures (line 178) but inconsistent with missing-input (400) and file-too-large (400) rejections. The inconsistency is minor since the caller (telegram-bridge) checks `body.success`, not the HTTP status. -- **Fix:** Consider using 200 consistently for all application-level errors in the transcription response, or 4xx consistently. Not blocking for V1.

## Plan Compliance

The implementation follows the approved plan closely. All nine steps are implemented. All four medium findings from the plan review (M1: userId passthrough, M2: cost estimation, M3: SSRF protections, M4: Redis dependency) are addressed. The three documented deviations (types package rebuild, cost estimation scope, Zod v4 URL validation) are reasonable and well-documented in the implementation summary. The plan's Step 9 (OTel spans) was correctly folded into Steps 4-6 inline, as suggested by the plan review's LOW-2 finding.

The smoke test was not executed because it requires a live OPENAI_API_KEY. This is documented as a residual risk and is consistent with the plan's own Risk #1 and the testing rules that separate controlled real-API smoke suites from normal CI runs.

## Verdict Rationale

APPROVED. All automated checks pass (Biome: 0 errors, all tests green across 3 packages). There are zero critical or high findings. The two medium findings are advisory: one is a comment accuracy issue and the other is a defense-in-depth logging concern that is already mitigated by the OTel redacting processors in production. The implementation is well-structured with proper dependency injection, comprehensive test coverage (38 tests for voice-transcription alone), correct service boundary enforcement (connector-agnostic, no Telegram types), and thorough error handling with user-safe messages.
