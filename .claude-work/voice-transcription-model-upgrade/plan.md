# Implementation Plan: Voice Transcription Model Upgrade

## Objective

Upgrade the default voice transcription model from `whisper-1` to `gpt-4o-transcribe` to improve word-error rate and language recognition. The change must preserve backward compatibility for operators who prefer `whisper-1` as a lower-cost fallback via the `WHISPER_MODEL` env var. The response format must change from `verbose_json` to `json` for `gpt-4o-transcribe` (since it only supports `json`), while retaining `verbose_json` for `whisper-1` so that language detection continues to work for the legacy model. Pricing defaults must be updated to reflect `gpt-4o-transcribe`'s token-based pricing.

## Scope

### In Scope

- Change the default `WHISPER_MODEL` from `whisper-1` to `gpt-4o-transcribe` in config schema defaults, `.env.example`, `.env`, and `docker-compose.yml`.
- Make `response_format` selection model-aware: `json` for `gpt-4o-transcribe` (and other `gpt-4o-*-transcribe` models), `verbose_json` for `whisper-1`.
- Handle the loss of `language` field in the `json` response format (the `Transcription` type returned by `json` format has no `language` property; only `TranscriptionVerbose` from `verbose_json` has it).
- Update the default `WHISPER_COST_PER_MINUTE_USD` from `0.006` to a token-equivalent approximation for `gpt-4o-transcribe`.
- Update all unit tests in `services/voice-transcription/src/__tests__/` to cover both models.
- Update existing smoke tests (no new smoke test files needed -- the existing `services.smoke.test.ts` already covers voice-transcription auth and request validation).
- Update `context/product/architecture.md` and `context/product/service-architecture.md` comments if they still reference `whisper-1` as the default (they already reference `gpt-4o-transcribe` -- verified).

### Out of Scope

- Token-based cost tracking using actual `usage.input_tokens` from API response (the current duration-based estimator in the guardrail middleware is a pre-request check that does not have access to the API response; refactoring to post-response cost tracking would be a separate task).
- Streaming transcription support.
- Changes to the `TranscriptionResponse` schema in `@monica-companion/types` (the `detectedLanguage` field is already optional).
- Changes to `telegram-bridge` or `ai-router` (they already treat `detectedLanguage` as optional).
- Changes to the guardrails `modelType` key (it remains `"whisper"` since it is just a Redis namespace prefix, not tied to the actual OpenAI model name).

## Affected Services & Packages

| Package/Service | Changes |
|-----------------|---------|
| `services/voice-transcription/src/config.ts` | Change `WHISPER_MODEL` default from `whisper-1` to `gpt-4o-transcribe`. Change `WHISPER_COST_PER_MINUTE_USD` default from `0.006` to `0.048`. |
| `services/voice-transcription/src/whisper-client.ts` | Make `response_format` model-aware. Handle different response types for `json` vs `verbose_json`. |
| `services/voice-transcription/src/__tests__/config.test.ts` | Update expected defaults. Add test for cost override. |
| `services/voice-transcription/src/__tests__/whisper-client.test.ts` | Add tests for `gpt-4o-transcribe` model behavior (json format, no language field). Update existing tests for `whisper-1` backward compatibility. |
| `services/voice-transcription/src/__tests__/app.test.ts` | Update `testConfig` default model to `gpt-4o-transcribe`. |
| `services/voice-transcription/src/__tests__/transcription-handler.test.ts` | Update `testConfig` default model. |
| `.env.example` | Update `WHISPER_MODEL` default to `gpt-4o-transcribe`, update `WHISPER_COST_PER_MINUTE_USD` to `0.048`, add comments explaining fallback. |
| `.env` | Update `WHISPER_MODEL` to `gpt-4o-transcribe`, update `WHISPER_COST_PER_MINUTE_USD` to `0.048`. |
| `docker-compose.yml` | Update `WHISPER_MODEL` fallback default from `whisper-1` to `gpt-4o-transcribe`, update `WHISPER_COST_PER_MINUTE_USD` fallback default. |

## Key Technical Findings

### Response Format Difference

From the OpenAI SDK types (`openai@6.31.0`):

- **`json` format** returns `Transcription` type: `{ text: string; logprobs?: ...; usage?: Tokens | Duration }` -- **no `language` field**.
- **`verbose_json` format** returns `TranscriptionVerbose` type: `{ text: string; language: string; duration: number; segments?: ...; usage?: ... }` -- **has `language` field**.
- **`gpt-4o-transcribe` only supports `json` format** (per SDK docs: "For `gpt-4o-transcribe` and `gpt-4o-mini-transcribe`, the only supported format is `json`").
- **`whisper-1` supports `json`, `verbose_json`, `srt`, `vtt`, and `text`**.

### Language Detection Impact

With `gpt-4o-transcribe` using `json` format, `detectedLanguage` will be `undefined` in the `TranscriptionResult`. This is acceptable because:

1. The `TranscriptionResult.detectedLanguage` is already typed as `string | undefined`.
2. The `TranscriptionResponseSchema` in `@monica-companion/types` already has `detectedLanguage` as optional.
3. The `ai-router` does its own language detection from the utterance text via the LLM, independent of the transcription language hint.
4. The `telegram-bridge` does not consume `detectedLanguage` from the transcription response.

With `whisper-1` fallback, language detection continues to work via `verbose_json` as before.

### Pricing Model Change

- `whisper-1`: $0.006/minute (duration-based).
- `gpt-4o-transcribe`: $6.00/1M audio input tokens. At approximately 8 tokens/second (OpenAI's stated rate), 1 minute = 480 tokens, so cost per minute is approximately $0.00288. However, the roadmap states "$6.00/1M audio input tokens", and at the more common estimate of ~133 tokens/second for audio (based on OpenAI Realtime API), 1 minute = ~8000 tokens, cost per minute = ~$0.048.

The most conservative safe default is `0.048` USD/minute (using the higher token density). Operators can override via `WHISPER_COST_PER_MINUTE_USD`. The env var name is kept as-is for backward compatibility.

### Model Detection Strategy

A simple helper function `isGpt4oTranscribeModel(model: string): boolean` that checks if the model string starts with `gpt-4o` and contains `transcribe`. This covers `gpt-4o-transcribe`, `gpt-4o-mini-transcribe`, and `gpt-4o-mini-transcribe-2025-12-15` as listed in the SDK's `AudioModel` type.

## Implementation Steps

### Step 1: Update config defaults (TDD)

**What to do:**
1. Write a failing test in `config.test.ts` that asserts `loadConfig(baseEnv).whisperModel` equals `"gpt-4o-transcribe"` (currently fails because default is `"whisper-1"`).
2. Write a failing test that asserts `loadConfig(baseEnv).whisperCostPerMinuteUsd` equals `0.048`.
3. Update `config.ts`:
   - Change `.default("whisper-1")` to `.default("gpt-4o-transcribe")` on `WHISPER_MODEL`.
   - Change `.default(0.006)` to `.default(0.048)` on `WHISPER_COST_PER_MINUTE_USD`.
4. Update the existing `"allows overriding whisper settings"` test to use `whisper-1` as the override value (proving fallback works).
5. Add a test that loads config with `WHISPER_MODEL: "whisper-1"` and verifies it loads correctly.

**Files to modify:**
- `services/voice-transcription/src/__tests__/config.test.ts`
- `services/voice-transcription/src/config.ts`

### Step 2: Make whisper-client response_format model-aware (TDD)

**What to do:**
1. Write a failing test in `whisper-client.test.ts`: create a client with `model: "gpt-4o-transcribe"`, mock `openai.audio.transcriptions.create` to return `{ text: "Hello world" }` (no `language` field), and assert the result has `text: "Hello world"` and `detectedLanguage: undefined`.
2. Write a failing test: create a client with `model: "gpt-4o-transcribe"`, verify `mockCreate` is called with `response_format: "json"` (not `verbose_json`).
3. Write a test: create a client with `model: "whisper-1"`, verify `mockCreate` is called with `response_format: "verbose_json"` and response.language is mapped to `detectedLanguage`.
4. Implement the change in `whisper-client.ts`:
   - Add a helper: `function isGpt4oTranscribeModel(model: string): boolean { return model.startsWith("gpt-4o") && model.includes("transcribe"); }`
   - In `attemptTranscription`, branch based on the model:
     - If `isGpt4oTranscribeModel(options.model)`: use `response_format: "json"`, return `{ text: response.text, detectedLanguage: undefined }`.
     - Otherwise (whisper-1 or other): use `response_format: "verbose_json"`, return `{ text: response.text, detectedLanguage: response.language }`.
   - The type assertion for the `params` and `response` must be adjusted to handle both overloads of `openai.audio.transcriptions.create`.

**Files to modify:**
- `services/voice-transcription/src/__tests__/whisper-client.test.ts`
- `services/voice-transcription/src/whisper-client.ts`

### Step 3: Update test fixtures in handler and app tests

**What to do:**
1. Update `testConfig.whisperModel` from `"whisper-1"` to `"gpt-4o-transcribe"` in both `app.test.ts` and `transcription-handler.test.ts`.
2. Update `testConfig.whisperCostPerMinuteUsd` from `0.006` to `0.048`.
3. Add one test in `transcription-handler.test.ts` that verifies the response works when `detectedLanguage` is `undefined` (simulating `gpt-4o-transcribe` behavior where the whisper client returns no language).

**Files to modify:**
- `services/voice-transcription/src/__tests__/app.test.ts`
- `services/voice-transcription/src/__tests__/transcription-handler.test.ts`

### Step 4: Update environment files and Docker Compose

**What to do:**
1. In `.env.example`:
   - Change `WHISPER_MODEL=whisper-1` to `WHISPER_MODEL=gpt-4o-transcribe`.
   - Add a comment: `# Supported: gpt-4o-transcribe (default, better accuracy), whisper-1 (lower cost fallback)`.
   - Change `WHISPER_COST_PER_MINUTE_USD=0.006` to `WHISPER_COST_PER_MINUTE_USD=0.048`.
   - Add a comment: `# For whisper-1, use 0.006. For gpt-4o-transcribe, use 0.048 (~$6/1M audio tokens).`
2. In `.env`:
   - Change `WHISPER_MODEL=whisper-1` to `WHISPER_MODEL=gpt-4o-transcribe`.
   - Change `WHISPER_COST_PER_MINUTE_USD=0.006` to `WHISPER_COST_PER_MINUTE_USD=0.048`.
3. In `docker-compose.yml`:
   - Change `WHISPER_MODEL: ${WHISPER_MODEL:-whisper-1}` to `WHISPER_MODEL: ${WHISPER_MODEL:-gpt-4o-transcribe}`.
   - Change `WHISPER_COST_PER_MINUTE_USD: ${WHISPER_COST_PER_MINUTE_USD:-0.006}` to `WHISPER_COST_PER_MINUTE_USD: ${WHISPER_COST_PER_MINUTE_USD:-0.048}`.

**Files to modify:**
- `.env.example`
- `.env`
- `docker-compose.yml`

### Step 5: Run all unit tests and fix any regressions

Run `pnpm --filter @monica-companion/voice-transcription test` and `pnpm --filter @monica-companion/types test`.

### Step 6: Docker Compose smoke test

Start `voice-transcription`, `redis`, `postgres`. Verify health, auth, and body limit smoke tests pass. Tear down.

## Test Strategy

### Unit Tests (Vitest)

- `config.test.ts`: Default model is `gpt-4o-transcribe`, default cost is `0.048`, override to `whisper-1` works.
- `whisper-client.test.ts`: `gpt-4o-transcribe` uses `json` format with no language; `whisper-1` uses `verbose_json` with language; `gpt-4o-mini-transcribe` recognized as gpt-4o transcribe model; error handling works for both models.
- `transcription-handler.test.ts`: Handler propagates `undefined` detectedLanguage without error.
- `app.test.ts`: Integration tests pass with updated config defaults.

### TDD Sequence

1. **RED**: Test asserting default model is `gpt-4o-transcribe` -- fails.
2. **GREEN**: Change default in `config.ts`.
3. **RED**: Test asserting `gpt-4o-transcribe` uses `response_format: "json"` -- fails.
4. **GREEN**: Add model-aware response format logic.
5. **RED**: Test asserting `gpt-4o-transcribe` returns `detectedLanguage: undefined` -- fails.
6. **GREEN**: Add model-aware response mapping.
7. **REFACTOR**: Extract helper function.

## Smoke Test Strategy

### Docker Compose services: `voice-transcription`, `redis`, `postgres`

### HTTP checks:
1. `GET /health` -- 200
2. `POST /internal/transcribe` without auth -- 401
3. `POST /internal/transcribe` with wrong caller -- 403
4. `POST /internal/transcribe` with invalid payload -- 400
5. Run `pnpm --filter smoke test`

## Security Considerations

1. No new public exposure. Voice-transcription remains internal-only.
2. Service-to-service auth unchanged. Caller allowlists remain `["telegram-bridge"]`.
3. No new secrets. `OPENAI_API_KEY` handling unchanged.
4. Sensitive data redaction unchanged.
5. Request-size limits unchanged (25MB body limit).

## Risks & Mitigations

1. **Token-based cost approximation may be inaccurate.** Mitigation: Document in `.env.example`, operators can override.
2. **Loss of language detection for gpt-4o-transcribe.** Mitigation: `ai-router` LLM detects language independently; field already optional.
3. **OpenAI SDK compatibility.** Verified: `openai@6.31.0` already includes `gpt-4o-transcribe` in `AudioModel` type.

## Open Questions (Resolved)

1. **Rename `WHISPER_COST_PER_MINUTE_USD`?** No -- backward compatibility. Comments clarify dual-model usage.
2. **Use actual token counts?** Out of scope -- pre-request estimator is sufficient for V1.
