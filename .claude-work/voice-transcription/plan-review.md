---
verdict: APPROVED
attempt: 1
critical_count: 0
high_count: 0
medium_count: 4
---

# Plan Review: Voice Transcription

## Summary

A well-structured, thorough implementation plan that replaces the existing voice-transcription stub with real Whisper API integration. The plan correctly reuses shared packages (auth, guardrails, redaction, types), respects architecture boundaries, and addresses security and reliability requirements. Four medium-severity findings are noted as advisory improvements; none block implementation.

## Findings

### CRITICAL
(none)

### HIGH
(none)

### MEDIUM

1. **userId not passed by telegram-bridge client is incorrectly categorized as out of scope** — The plan identifies in Risk #6 that `services/telegram-bridge/src/lib/voice-transcription-client.ts` does not pass `userId` to the service client, and that without it guardrails cannot function. The plan then says telegram-bridge is "conceptually out of scope" but the fix "should be included in implementation." This is contradictory. Since the guardrail middleware rejects requests without a `userId` with a 400 error, the voice-transcription service will be non-functional for its primary caller without this fix. — **Fix:** Explicitly move the telegram-bridge client userId fix into scope as a prerequisite. The change is minimal: add `userId` to the `transcribe` method and pass it through `client.fetch` options.

2. **Cost estimation uses flat per-request rate instead of duration-based pricing** — Whisper pricing is duration-based (~$0.006/minute). A flat rate will systematically under-count costs for long messages and over-count for short ones. — **Fix:** Implement a simple duration-based cost estimator: `(durationSeconds / 60) * costPerMinuteUsd`. Add a `WHISPER_COST_PER_MINUTE_USD` config var with a default of `0.006`.

3. **Fetch-URL SSRF protection described as "basic" with no specifics** — The plan should specify the concrete mechanism. — **Fix:** In Step 5, specify: (a) use `fetch` with `redirect: "error"` to prevent automatic redirect following, (b) validate that the resolved URL hostname is not a loopback/RFC1918/link-local address, and (c) set a Content-Length upper bound check.

4. **Docker Compose Step 8 missing `depends_on: redis` consideration** — **Fix:** Add a note confirming that the existing `depends_on: redis: condition: service_healthy` is correct and now functionally required.

### LOW

1. Smoke test #4 requires a real OPENAI_API_KEY — split into "always run" and "requires API key" sections.
2. Step 9 OTel spans could be added inline with Steps 4-6 rather than as a separate step.
3. Config schema for OPENAI_API_KEY should ensure validation errors don't leak the key value.
4. Plan does not mention response validation on Whisper API output.

## Verdict
APPROVED — No critical or high findings. Medium findings are advisory improvements that should be addressed during implementation but do not represent design-level problems.
