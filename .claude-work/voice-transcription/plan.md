# Implementation Plan: Voice Transcription

## Objective

Implement the `voice-transcription` service as a fully functional standalone service that accepts connector-neutral audio input (binary upload or short-lived fetch URL plus media metadata) and returns normalized transcript output via the OpenAI Whisper API. The service already exists as a stub with auth, health check, and multipart form parsing scaffolded during the Telegram Bridge phase. This plan replaces the stub with real transcription logic, adds the fetch-URL input mode, integrates guardrails (shared OpenAI key protection), and defines user-safe failure states.

## Scope

### In Scope

- Add the OpenAI SDK as a dependency (verify latest stable version before pinning).
- Implement real Whisper API transcription in `voice-transcription`, replacing the current stub response.
- Support two input modes on `POST /internal/transcribe`: (1) binary upload via multipart form-data (existing contract), and (2) fetch-URL mode where a short-lived URL is provided in metadata and the service downloads the audio.
- Extend `TranscriptionRequestMetadataSchema` in `@monica-companion/types` with an optional `fetchUrl` field and an optional `fileSizeBytes` field.
- Extend `TranscriptionResponseSchema` with an optional `detectedLanguage` field.
- Integrate `@monica-companion/guardrails` for per-user rate limiting, concurrency gating, budget tracking, and kill-switch checks on the Whisper API call path.
- Add explicit timeout handling for the Whisper API call.
- Implement transport-level quick retry (single retry) for transient Whisper API failures.
- Return normalized, user-safe error responses for all failure modes (file too large, unsupported format, transcription timeout, Whisper API error, budget exhausted, rate limited).
- Ensure voice audio is processed transiently and not persisted after transcription succeeds or fails.
- Add `OPENAI_API_KEY`, `REDIS_URL`, and guardrail config env vars to the `voice-transcription` container in `docker-compose.yml`.
- Add OpenTelemetry spans for transcription operations.
- Apply `@monica-companion/redaction` to all logged data (especially the OpenAI API key).
- Unit tests with mocked Whisper API, integration tests for guardrail checks.
- Smoke test via Docker Compose verifying the real network path.

### Out of Scope

- Changes to `telegram-bridge` (it already sends correctly formatted requests to this service).
- Changes to the `delivery` service.
- Fetch-URL producers (telegram-bridge already sends binary upload; future connectors may use fetch URLs).
- Whisper model fine-tuning or custom vocabulary.
- Audio format conversion (Whisper API supports OGG/opus, MP3, WAV, etc. natively).
- Persistent audio storage or audio archival.
- Real-Monica smoke suite execution (separate gated process).

## Affected Services & Packages

| Package/Service | Changes |
|-----------------|---------|
| `packages/types` | Extend `TranscriptionRequestMetadataSchema` with optional `fetchUrl` and `fileSizeBytes`. Extend `TranscriptionResponseSchema` with optional `detectedLanguage`. |
| `services/voice-transcription` | Major: real Whisper API integration, fetch-URL download, guardrails middleware, config expansion, error handling, transient audio handling, OTel spans. |
| `pnpm-workspace.yaml` | Add `openai` SDK to catalog with pinned version. |
| `docker-compose.yml` | Add `OPENAI_API_KEY`, `REDIS_URL`, and guardrail env vars to `voice-transcription` container. |
| `.env.example` | Document new `OPENAI_API_KEY` usage by voice-transcription. |

## Implementation Steps

### Step 1: Add OpenAI SDK to workspace catalog and voice-transcription dependencies

**What:** Add the `openai` npm package to `pnpm-workspace.yaml` catalog with an exact pinned version (verify latest stable on npmjs.com before pinning). Add it as a dependency in `services/voice-transcription/package.json`. Also add `@monica-companion/guardrails`, `@monica-companion/redaction`, and `ioredis` as dependencies (guardrails needs Redis for per-user limits).

**Files to modify:**
- `pnpm-workspace.yaml` -- add `openai: <verified-version>`
- `services/voice-transcription/package.json` -- add `openai: "catalog:"`, `@monica-companion/guardrails: "workspace:*"`, `@monica-companion/redaction: "workspace:*"`, `ioredis: "catalog:"`

**Expected outcome:** `pnpm install` succeeds. The OpenAI SDK and guardrails package are importable in voice-transcription.

---

### Step 2: Extend shared transcription schemas

**What:** Add optional fields to the existing transcription schemas in `@monica-companion/types`:

1. `TranscriptionRequestMetadataSchema`: add `fetchUrl` (optional `z.url()`) for the fetch-URL input mode, and `fileSizeBytes` (optional `z.number().int().positive()`) for pre-validation of file size before download.
2. `TranscriptionResponseSchema`: add `detectedLanguage` (optional `z.string()`) so callers can know what language Whisper detected.

The multipart form-data contract remains unchanged: metadata is a JSON string in the `metadata` field, and `file` is an optional binary blob (required when `fetchUrl` is absent).

**Files to modify:**
- `packages/types/src/transcription.ts` -- add the new optional fields
- `packages/types/src/__tests__/transcription.test.ts` -- add test cases for new fields, including validation that at least one of `file` or `fetchUrl` must be present (this validation happens at the service layer, not the schema layer, since `file` is a FormData part, not a JSON field)

**TDD:** Write failing tests first for the new schema fields, then update the schemas.

**Expected outcome:** Updated schemas export cleanly and all existing tests pass.

---

### Step 3: Expand voice-transcription config with OpenAI and guardrail settings

**What:** Expand the voice-transcription `Config` and `loadConfig` to include:
- `OPENAI_API_KEY` (required string, min 1)
- `WHISPER_MODEL` (optional string, default `"whisper-1"`)
- `WHISPER_TIMEOUT_MS` (optional number, default `60000` -- 60 seconds for Whisper API call)
- `WHISPER_MAX_FILE_SIZE_BYTES` (optional number, default `25 * 1024 * 1024` -- 25MB, Whisper API limit)
- `FETCH_URL_TIMEOUT_MS` (optional number, default `15000` -- 15 seconds for downloading from fetch URL)
- `REDIS_URL` (required string for guardrails)
- All `GUARDRAIL_*` env vars via `loadGuardrailConfig` from `@monica-companion/guardrails`

**Files to modify:**
- `services/voice-transcription/src/config.ts` -- extend schema and `Config` type

**TDD:** Write a failing test for config loading with the new required fields, then implement.

**Files to create:**
- `services/voice-transcription/src/__tests__/config.test.ts`

**Expected outcome:** Config loads all required env vars and applies defaults for optional ones.

---

### Step 4: Implement the Whisper transcription client

**What:** Create a thin wrapper around the OpenAI SDK's audio transcription API. This client:
- Accepts an audio `File`/`Blob` plus optional language hint
- Calls the Whisper API with timeout handling (`AbortSignal.timeout`)
- Returns the transcript text and detected language on success
- Maps OpenAI API errors to structured error types (rate limit, timeout, invalid audio, server error)
- Implements a single transport-level retry for transient failures (5xx or network error) with a short delay (1 second)
- Uses `@monica-companion/redaction` to ensure the API key never appears in logs
- Emits OTel spans for the Whisper API call

**Files to create:**
- `services/voice-transcription/src/whisper-client.ts` -- the client implementation
- `services/voice-transcription/src/__tests__/whisper-client.test.ts` -- unit tests with mocked OpenAI SDK

**TDD:** Write failing tests for: successful transcription, timeout error, 429 rate limit, 500 server error with retry, invalid audio error. Then implement the client.

**Expected outcome:** A tested `WhisperClient` class/function that wraps the OpenAI SDK with proper error handling and retry logic.

---

### Step 5: Implement fetch-URL audio download

**What:** Create a function that downloads audio from a short-lived fetch URL. This supports future connectors that provide download URLs instead of binary uploads. The function:
- Accepts a URL string, a timeout duration, and a maximum file size
- Downloads the audio with `AbortSignal.timeout`
- Validates the response content-length against the max file size before reading the body
- Validates the actual downloaded size against the max
- Returns the audio buffer and content-type
- Rejects non-2xx responses
- Does not follow redirects to private/loopback IPs (basic protection; full SSRF protection is connector-side responsibility since connectors generate the fetch URLs)

**Files to create:**
- `services/voice-transcription/src/audio-fetcher.ts`
- `services/voice-transcription/src/__tests__/audio-fetcher.test.ts`

**TDD:** Write failing tests for: successful download, timeout, oversized response (content-length check), non-2xx status, download exceeding max size during streaming. Then implement.

**Expected outcome:** A tested audio fetch function that safely downloads from short-lived URLs.

---

### Step 6: Wire transcription endpoint with real Whisper integration and guardrails

**What:** Replace the stub `/internal/transcribe` endpoint handler in `app.ts` with the real implementation:

1. Parse and validate the multipart form data (existing code).
2. Determine input mode: if `fetchUrl` is present in metadata, download audio via the audio fetcher (Step 5); otherwise, read the `file` form field (existing path). Reject requests with neither.
3. Validate audio size against `WHISPER_MAX_FILE_SIZE_BYTES`.
4. Run guardrail checks (the guardrail middleware is applied to the transcribe route):
   - Kill switch check
   - Per-user rate limit
   - Budget check (cost estimate for Whisper call)
   - Per-user concurrency gate
5. Call the Whisper client (Step 4) with the audio buffer and optional language hint.
6. Return `TranscriptionResponse` with `success: true`, `text`, `detectedLanguage`, and `correlationId` on success.
7. Return `TranscriptionResponse` with `success: false`, a user-safe `error` message, and `correlationId` on failure.
8. Ensure audio buffers are not retained after the handler completes (no persistence, no variable leaks).

Apply the guardrail middleware from `@monica-companion/guardrails` on the `/internal/transcribe` route, configured with `modelType: "whisper"`. The `userId` is extracted from the JWT by `serviceAuth` middleware. The `costEstimator` estimates cost based on audio duration from metadata.

**Files to modify:**
- `services/voice-transcription/src/app.ts` -- replace stub with real handler, add guardrails middleware, add Redis initialization

**Files to create:**
- `services/voice-transcription/src/transcription-handler.ts` -- extracted handler logic for testability

**TDD:** Update existing stub test to expect real behavior. Write failing tests for: successful transcription with binary upload, successful transcription with fetch URL, missing both file and fetchUrl, file too large, Whisper API failure returning user-safe error, guardrail rejection (rate limit, budget, kill switch, concurrency).

**Files to modify:**
- `services/voice-transcription/src/__tests__/app.test.ts` -- update and expand tests

**Expected outcome:** The endpoint processes real transcription requests and returns structured responses with proper error handling.

---

### Step 7: Update index.ts with Redis lifecycle and graceful shutdown

**What:** Update the service entry point to:
- Create a Redis client on startup (needed for guardrails)
- Pass the Redis client to `createApp`
- Close the Redis connection on shutdown
- Log startup configuration (redacted)

**Files to modify:**
- `services/voice-transcription/src/index.ts`

**Expected outcome:** Service starts with Redis connection, shuts down cleanly.

---

### Step 8: Update Docker Compose and environment

**What:** Add required environment variables to the `voice-transcription` container in `docker-compose.yml`:
- `OPENAI_API_KEY: ${OPENAI_API_KEY}`
- `REDIS_URL: redis://redis:6379`
- `WHISPER_MODEL: ${WHISPER_MODEL:-whisper-1}`
- `WHISPER_TIMEOUT_MS: ${WHISPER_TIMEOUT_MS:-60000}`
- `WHISPER_MAX_FILE_SIZE_BYTES: ${WHISPER_MAX_FILE_SIZE_BYTES:-26214400}`
- `FETCH_URL_TIMEOUT_MS: ${FETCH_URL_TIMEOUT_MS:-15000}`
- Guardrail env vars: `GUARDRAIL_RATE_LIMIT_PER_USER`, `GUARDRAIL_RATE_WINDOW_SECONDS`, `GUARDRAIL_CONCURRENCY_PER_USER`, `GUARDRAIL_BUDGET_LIMIT_USD`, `GUARDRAIL_BUDGET_ALARM_THRESHOLD_PCT`, `GUARDRAIL_COST_PER_REQUEST_USD`

Update `.env.example` with documentation for the new variables.

**Files to modify:**
- `docker-compose.yml` -- add env vars to voice-transcription
- `.env.example` -- add documentation

**Expected outcome:** Voice-transcription container has all required config to call Whisper API and enforce guardrails.

---

### Step 9: Add OTel spans and structured logging

**What:** Add OpenTelemetry trace spans to the transcription handler for:
- `voice-transcription.transcribe` -- top-level span wrapping the entire request
- `voice-transcription.fetch_audio` -- span for fetch-URL downloads (when used)
- `voice-transcription.whisper_call` -- span for the Whisper API call
- `voice-transcription.guardrail_check` -- span for guardrail evaluation

Add structured log entries for:
- Transcription request received (correlationId, mimeType, durationSeconds, input mode -- no audio content)
- Transcription succeeded (correlationId, detectedLanguage, transcript length in chars -- no transcript content)
- Transcription failed (correlationId, error category, user-safe error message -- no raw API errors)
- Guardrail rejection (correlationId, rejection reason)

All log entries must go through `@monica-companion/redaction` and never include audio content, transcript text, or API keys.

**Files to modify:**
- `services/voice-transcription/src/transcription-handler.ts` -- add spans and logging
- `services/voice-transcription/src/whisper-client.ts` -- add span around API call

**Expected outcome:** Transcription operations are fully traceable in the observability stack.

---

## Test Strategy

### Unit Tests (Vitest)

**What to test:**
1. **Config loading** (`config.test.ts`): validates required fields, applies defaults, rejects missing OPENAI_API_KEY and REDIS_URL.
2. **Whisper client** (`whisper-client.test.ts`): mock the OpenAI SDK. Test successful transcription, timeout handling, rate-limit error mapping, server error with retry, invalid audio format error, language detection.
3. **Audio fetcher** (`audio-fetcher.test.ts`): mock `fetch`. Test successful download, timeout, oversized response, non-2xx status.
4. **Transcription handler** (`transcription-handler.test.ts` or expanded `app.test.ts`): mock the Whisper client and audio fetcher. Test binary upload mode, fetch-URL mode, missing input rejection, file size validation, error response formatting.
5. **App integration** (`app.test.ts`): test the full request through the Hono app with mocked dependencies. Test auth enforcement (existing), successful transcription, various error responses.

**What to mock:**
- OpenAI SDK (`openai` package) -- never make real API calls in unit tests
- `fetch` for audio fetcher tests
- Redis for guardrail tests (use the existing `@monica-companion/guardrails` test patterns)
- OTel spans (use noop tracer)

### Integration Tests

**What needs real Postgres/Redis:**
- Guardrail integration tests: verify rate limiting, concurrency gating, budget tracking, and kill switch with a real Redis instance. The `@monica-companion/guardrails` package already has integration tests for these; voice-transcription integration tests verify the middleware is wired correctly on the `/internal/transcribe` endpoint.

### TDD Sequence

For each step, the failing test is written first:

1. **Step 2:** Write tests for new schema fields (fetchUrl, fileSizeBytes, detectedLanguage) -- they fail because fields do not exist yet.
2. **Step 3:** Write config test requiring OPENAI_API_KEY -- fails because config schema does not include it.
3. **Step 4:** Write whisper-client test for successful transcription -- fails because module does not exist.
4. **Step 5:** Write audio-fetcher test for successful download -- fails because module does not exist.
5. **Step 6:** Write app test expecting real transcription result instead of stub -- fails because handler still returns stub.

## Smoke Test Strategy

### Docker Compose services to start

```bash
docker compose up -d postgres redis
docker compose --profile app up -d voice-transcription
```

Wait for health checks to pass.

### HTTP checks to run

1. **Health check:**
   ```bash
   curl -s http://localhost:3003/health
   # Expected: {"status":"ok","service":"voice-transcription"}
   ```
   (Note: voice-transcription is on the internal network only; for smoke testing, temporarily expose port 3003 or exec into the container.)

2. **Auth enforcement (unauthenticated):**
   ```bash
   curl -s -X POST http://voice-transcription:3003/internal/transcribe
   # Expected: 401 with {"error":"Missing or invalid Authorization header"}
   ```

3. **Auth enforcement (wrong caller):**
   ```bash
   # Generate a JWT with issuer=ai-router (not in allowedCallers)
   curl -s -X POST http://voice-transcription:3003/internal/transcribe \
     -H "Authorization: Bearer <token-from-ai-router>"
   # Expected: 403 with {"error":"Caller not allowed"}
   ```

4. **Transcription with real audio (requires OPENAI_API_KEY):**
   ```bash
   # Generate a JWT with issuer=telegram-bridge, audience=voice-transcription
   # Send multipart form-data with metadata and a short audio file
   curl -s -X POST http://voice-transcription:3003/internal/transcribe \
     -H "Authorization: Bearer <valid-token>" \
     -F 'metadata={"mimeType":"audio/ogg","durationSeconds":3,"correlationId":"smoke-test-1"}' \
     -F 'file=@test-audio.ogg;type=audio/ogg'
   # Expected: 200 with {"success":true,"text":"...","correlationId":"smoke-test-1","detectedLanguage":"en"}
   ```

5. **Missing input rejection:**
   ```bash
   curl -s -X POST http://voice-transcription:3003/internal/transcribe \
     -H "Authorization: Bearer <valid-token>" \
     -F 'metadata={"mimeType":"audio/ogg","durationSeconds":3,"correlationId":"smoke-test-2"}'
   # Expected: 400 with {"error":"No audio input provided. Supply either a file upload or a fetchUrl.","correlationId":"smoke-test-2"}
   ```

### What the smoke test proves

- The voice-transcription container starts, connects to Redis, and passes health checks.
- Service-to-service JWT auth is enforced with the correct caller allowlist.
- The multipart form-data parsing, metadata validation, and Whisper API integration work end-to-end through the real Docker network.
- Error responses are structured and user-safe.
- The service is reachable on the internal Docker network at `voice-transcription:3003` as expected by `telegram-bridge`.

## Security Considerations

1. **OpenAI API key protection:** The `OPENAI_API_KEY` is passed as an environment variable and used only by the OpenAI SDK. It is never logged, included in trace attributes, or returned in responses. The `@monica-companion/redaction` patterns already match `sk-` prefixed strings and the `api_key` field name.

2. **Service-to-service auth:** The existing `serviceAuth` middleware enforces JWT validation with `allowedCallers: ["telegram-bridge"]`. Only telegram-bridge (and future connectors) can call the transcription endpoint. This is already implemented in the stub.

3. **No public exposure:** The Caddyfile does not route to voice-transcription. The service is on the `internal` Docker network only, with no `ports:` mapping (only `expose:`).

4. **Audio data transience:** Voice audio buffers exist only for the duration of the request handler. They are not written to disk, database, or queue. After the handler returns (success or failure), the buffer is eligible for garbage collection. This satisfies the data governance requirement: "Voice audio is not retained after transcription completes, aside from minimal operational metadata."

5. **Fetch-URL safety:** The audio fetcher validates response size and applies timeouts. Fetch URLs are expected to be short-lived and generated by trusted connectors. The service does not follow redirects to private IPs (basic protection).

6. **Guardrails:** Per-user rate limiting, concurrency caps, budget tracking, and kill switch protect the shared OpenAI key from abuse. These use the same `@monica-companion/guardrails` middleware already proven in ai-router.

7. **Input validation:** All inbound data is validated with Zod schemas (metadata JSON, file presence, file size). Invalid requests get structured 400 responses.

## Risks & Open Questions

1. **OpenAI SDK version:** The exact latest stable version of the `openai` npm package must be verified at implementation time. The SDK has had frequent breaking changes. Verify compatibility with Node.js 24 and ESM.

2. **Whisper API cost estimation:** The `costEstimator` in the guardrail middleware estimates cost based on audio duration. The current Whisper pricing is approximately $0.006/minute. This rate should be configurable via `GUARDRAIL_COST_PER_REQUEST_USD` or a separate `WHISPER_COST_PER_MINUTE_USD` env var. For simplicity, the plan uses a flat cost-per-request estimate from the existing guardrail config, which may underestimate costs for long audio files.

3. **Fetch-URL mode testing:** No existing connector currently produces fetch URLs (telegram-bridge sends binary uploads). The fetch-URL code path will be tested with unit tests and mocks but will not have an end-to-end smoke test until a connector that uses it is implemented. This is acceptable since the architecture requires the contract to exist now for future connectors.

4. **Audio format support:** Whisper API natively supports mp3, mp4, mpeg, mpga, m4a, wav, webm, and ogg. Telegram voice messages are ogg/opus. If future connectors send unsupported formats, audio conversion would be needed, but that is out of scope for this plan.

5. **25MB file size limit:** The Whisper API has a 25MB limit. The existing body limit on the endpoint is 25MB (set in the Telegram Bridge plan). This is consistent but means very long voice messages might be rejected. The 25MB limit covers approximately 6+ hours of ogg/opus audio at typical voice bitrates, so this is not a practical concern for V1.

6. **User identity in guardrails:** The guardrail middleware requires a `userId` from the JWT. The `serviceAuth` middleware sets `userId` from the JWT `sub` claim. Telegram-bridge must include the user's internal UUID as the `subject` when signing the JWT for voice-transcription calls. The existing `voice-transcription-client.ts` in telegram-bridge currently does not pass `userId` to the service client. This needs to be verified and fixed in the telegram-bridge client if missing -- however, since telegram-bridge is out of scope for this plan, this should be flagged as a prerequisite. Looking at the existing code, `createServiceClient` supports an optional `userId` in `ServiceFetchOptions`, and the `createVoiceTranscriptionClient` does pass `correlationId` via `client.fetch` options but not `userId`. The telegram-bridge voice handler has access to `ctx.userId`. The `transcribe` method in the client needs to pass `userId` to make guardrails work. This is a minor change to `services/telegram-bridge/src/lib/voice-transcription-client.ts` that should be included in implementation even though telegram-bridge is conceptually out of scope, because without it the guardrails cannot function.
