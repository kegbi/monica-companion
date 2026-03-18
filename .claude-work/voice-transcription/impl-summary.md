# Implementation Summary: Voice Transcription

## Files Changed

| File | Action | Description |
|------|--------|-------------|
| `pnpm-workspace.yaml` | modified | Added `openai: 6.31.0` to catalog |
| `services/voice-transcription/package.json` | modified | Added `openai`, `@monica-companion/guardrails`, `@monica-companion/redaction`, `ioredis`, `@opentelemetry/api` as dependencies |
| `packages/types/src/transcription.ts` | modified | Added `fetchUrl` (optional URL string), `fileSizeBytes` (optional positive int) to request metadata; added `detectedLanguage` (optional string) to response |
| `services/voice-transcription/src/config.ts` | modified | Extended config with `OPENAI_API_KEY`, `WHISPER_MODEL`, `WHISPER_TIMEOUT_MS`, `WHISPER_MAX_FILE_SIZE_BYTES`, `FETCH_URL_TIMEOUT_MS`, `WHISPER_COST_PER_MINUTE_USD`, `REDIS_URL`, and guardrail config |
| `services/voice-transcription/src/whisper-client.ts` | created | Thin wrapper around OpenAI Whisper API with timeout, retry (1 attempt for 5xx), error classification, and OTel spans |
| `services/voice-transcription/src/audio-fetcher.ts` | created | Fetch-URL audio downloader with SSRF protections (blocked hosts, redirect: error), size limits, timeout, and OTel spans |
| `services/voice-transcription/src/transcription-handler.ts` | created | Real transcription handler supporting binary upload and fetch-URL input modes, with structured logging and OTel spans |
| `services/voice-transcription/src/app.ts` | modified | Replaced stub with real handler; wired guardrails middleware with duration-based cost estimation; accepts Redis and WhisperClient dependencies |
| `services/voice-transcription/src/index.ts` | modified | Added Redis lifecycle (create on startup, close on shutdown) and WhisperClient creation |
| `docker-compose.yml` | modified | Added OPENAI_API_KEY, REDIS_URL, WHISPER_*, GUARDRAIL_* env vars to voice-transcription container |
| `.env.example` | modified | Documented new voice-transcription environment variables |
| `services/telegram-bridge/src/lib/voice-transcription-client.ts` | modified | Added `userId` parameter to `transcribe()` and passes it via `client.fetch()` options (M1 fix) |
| `services/telegram-bridge/src/bot/handlers/voice-message.ts` | modified | Updated `TranscribeFn` type to include `userId`; passes `ctx.userId` to transcribe call (M1 fix) |
| `services/telegram-bridge/src/app.ts` | modified | Updated transcribe wiring to pass userId through (M1 fix) |

## Tests Added

| Test File | What It Tests |
|-----------|---------------|
| `packages/types/src/__tests__/transcription.test.ts` | Extended with tests for `fetchUrl`, `fileSizeBytes`, `detectedLanguage` schema fields (6 new tests) |
| `services/voice-transcription/src/__tests__/config.test.ts` | Config loading: required fields, defaults, overrides, guardrail config, missing env var errors (8 tests) |
| `services/voice-transcription/src/__tests__/whisper-client.test.ts` | Whisper client: success, language hint, timeout error, rate limit error, retry on 500, retry exhaustion, invalid audio error, user-safe messages (8 tests) |
| `services/voice-transcription/src/__tests__/audio-fetcher.test.ts` | Audio fetcher: successful download, non-2xx rejection, content-length oversize, body oversize, loopback/localhost/RFC1918/link-local blocking, timeout wrapping, redirect:error enforcement (10 tests) |
| `services/voice-transcription/src/__tests__/transcription-handler.test.ts` | Handler integration: binary upload success, fetch-URL success, missing input rejection, file too large, Whisper API failure user-safe error, health endpoint, auth enforcement (8 tests) |
| `services/voice-transcription/src/__tests__/app.test.ts` | Updated to match new createApp signature; tests health, auth, and successful transcription (4 tests) |
| `services/telegram-bridge/src/bot/handlers/__tests__/voice-message.test.ts` | Added test verifying userId is passed to transcribe function (1 new test) |

## Verification Results

- **Biome**: `pnpm check:fix` -- 0 errors, 0 fixes applied. 93 pre-existing warnings (all `any` casts in test files across the project). All new/modified production source files have 0 warnings.
- **Tests**:
  - `@monica-companion/types`: 8 files, 130 tests passed
  - `@monica-companion/voice-transcription`: 5 files, 38 tests passed
  - `@monica-companion/telegram-bridge`: 17 files, 81 tests passed
  - `@monica-companion/auth`: passed
  - `@monica-companion/guardrails`: 8 files, 39 tests passed (11 skipped - integration tests requiring Redis)

## Plan Review Findings Addressed

| Finding | Resolution |
|---------|------------|
| M1: telegram-bridge client userId fix | Added `userId` parameter to `VoiceTranscriptionClient.transcribe()`, `TranscribeFn` type, and `voice-message.ts` handler. userId is now passed through JWT `subject` claim for guardrail enforcement. |
| M2: Duration-based cost estimation | Added `WHISPER_COST_PER_MINUTE_USD` config (default 0.006). Cost estimator in guardrail middleware uses this rate. Note: per-request estimation uses the configured cost-per-minute as a per-request base since audio duration is not available in the guardrail middleware context (the metadata hasn't been parsed yet at middleware execution time). For accurate tracking, the cost is logged post-transcription. |
| M3: SSRF protections for fetch-URL | Implemented: (a) `fetch` with `redirect: "error"` to prevent automatic redirect following, (b) hostname validation against loopback, RFC1918, link-local, and localhost patterns before making the request, (c) Content-Length header and body size validation. |
| M4: Docker Compose Redis dependency | Confirmed existing `depends_on: redis: condition: service_healthy` is correct and functionally required for guardrails. |
| LOW-2: OTel spans inline | Spans added inline with Steps 4-6 rather than as a separate Step 9. |

## Plan Deviations

1. **Types package rebuild required**: The `@monica-companion/types` package exports via `dist/`, so after modifying the source, a `pnpm build` of the types package was required for the voice-transcription service to pick up the new schema fields. This was not mentioned in the plan.

2. **Cost estimation scope**: The plan suggested duration-based cost estimation in the guardrail middleware's `costEstimator` function. However, at middleware execution time, the multipart form data (containing audio duration) has not yet been parsed. The cost estimator uses the configured per-minute rate as a flat per-request estimate. Accurate per-request cost tracking based on actual duration would require moving the cost recording to after metadata parsing, which would be a change to the guardrails middleware API.

3. **Zod v4 URL validation**: Changed from `z.url()` (which returns a `URL` object in Zod v4) to `z.string().url()` (which validates but keeps the string type) for the `fetchUrl` field, since the rest of the code expects a string.

## Residual Risks

1. **No smoke test executed**: Docker Compose smoke test was not run because it requires a live OPENAI_API_KEY. The service structure, auth enforcement, and multipart processing are verified by unit tests, but the real Whisper API integration has not been tested end-to-end.

2. **Fetch-URL path untested end-to-end**: No existing connector produces fetch URLs. The code path is covered by unit tests with mocked fetch, but has no integration or smoke test.

3. **OpenAI SDK v6.31.0 compatibility**: The SDK version was verified on npmjs.com. The `verbose_json` response format and `TranscriptionVerbose` type are used for language detection. If the SDK API changes, this would need updating.

4. **Guardrail cost accuracy**: The flat per-request cost estimation means short messages slightly overpay and long messages slightly underpay in budget tracking. For V1 this is acceptable since the budget is a safety cap, not a billing system.

5. **Roadmap not marked complete**: Per project rules, the roadmap item should only be marked complete after Docker Compose smoke tests pass against the live stack. This has not been done.
