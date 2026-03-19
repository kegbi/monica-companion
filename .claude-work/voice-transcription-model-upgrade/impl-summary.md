# Implementation Summary: Voice Transcription Model Upgrade

## Files Changed
| File | Action | Description |
|------|--------|-------------|
| `services/voice-transcription/src/config.ts` | modified | Changed `WHISPER_MODEL` default from `whisper-1` to `gpt-4o-transcribe`; changed `WHISPER_COST_PER_MINUTE_USD` default from `0.006` to `0.048` |
| `services/voice-transcription/src/whisper-client.ts` | modified | Added `isGpt4oTranscribeModel()` helper; branched `attemptTranscription` to use `response_format: "json"` for gpt-4o-transcribe models (returns `detectedLanguage: undefined`) and `response_format: "verbose_json"` for whisper-1 (returns `detectedLanguage` from response) |
| `services/voice-transcription/src/__tests__/config.test.ts` | modified | Updated default assertions to `gpt-4o-transcribe` and `0.048`; added whisper-1 fallback override test |
| `services/voice-transcription/src/__tests__/whisper-client.test.ts` | modified | Restructured into `gpt-4o-transcribe model`, `whisper-1 model`, and `error handling` describe blocks; added tests for json format, undefined detectedLanguage, gpt-4o-mini-transcribe and dated model variant recognition; updated makeClient default to `gpt-4o-transcribe` |
| `services/voice-transcription/src/__tests__/app.test.ts` | modified | Updated `testConfig` defaults to `gpt-4o-transcribe` and `0.048` |
| `services/voice-transcription/src/__tests__/transcription-handler.test.ts` | modified | Updated `testConfig` defaults; added test for undefined `detectedLanguage` propagation (gpt-4o-transcribe behavior) |
| `.env.example` | modified | Updated `WHISPER_MODEL` to `gpt-4o-transcribe`, `WHISPER_COST_PER_MINUTE_USD` to `0.048`, added model selection and cost estimate documentation comments |
| `.env` | modified | Updated `WHISPER_MODEL` to `gpt-4o-transcribe`, `WHISPER_COST_PER_MINUTE_USD` to `0.048` |
| `docker-compose.yml` | modified | Updated voice-transcription `WHISPER_MODEL` fallback from `whisper-1` to `gpt-4o-transcribe`, `WHISPER_COST_PER_MINUTE_USD` fallback from `0.006` to `0.048` |

## Tests Added
| Test File | What It Tests |
|-----------|---------------|
| `config.test.ts` | Default model is `gpt-4o-transcribe`, default cost is `0.048`, whisper-1 fallback via env override |
| `whisper-client.test.ts` | gpt-4o-transcribe uses `json` format, returns undefined `detectedLanguage`, passes language hint; whisper-1 uses `verbose_json`, returns language; gpt-4o-mini-transcribe and dated variants recognized correctly; error handling and retry unchanged |
| `transcription-handler.test.ts` | Handler propagates undefined `detectedLanguage` without error (gpt-4o-transcribe simulation) |

## Verification Results
- **Biome**: `pnpm check:fix` completed. 0 errors, 138 warnings (all pre-existing `any` type warnings in test mock patterns).
- **Tests**: `pnpm --filter @monica-companion/voice-transcription test` -- 6 test files, 50 tests passed, 0 failed.

## Plan Review Findings Addressed
1. **MEDIUM-1 (language parameter)**: Verified against OpenAI SDK types (`openai@6.31.0`). The `TranscriptionCreateParamsBase` interface accepts `language?: string` for all models including `gpt-4o-transcribe`. The JSDoc states it improves accuracy and latency with no model restriction. The implementation passes `language` hint for both model branches. Unit tests verify language hint is passed for both gpt-4o-transcribe and whisper-1.
2. **MEDIUM-2 (cost estimate documentation)**: Added comments in `.env.example` noting the cost is a conservative upper-bound estimate and that operators should adjust based on observed OpenAI billing, with per-model reference values.

## Plan Deviations
None. All steps executed as specified in the plan.

## Residual Risks
1. **Cost approximation**: The $0.048/minute estimate for gpt-4o-transcribe is a conservative upper bound based on ~133 tokens/second audio token density. Actual costs may be lower. Operators should monitor OpenAI billing and adjust `WHISPER_COST_PER_MINUTE_USD` accordingly. Documented in `.env.example`.
2. **Language detection**: gpt-4o-transcribe does not return `detectedLanguage` in the json response format. This is acceptable because the field is already optional throughout the system (TranscriptionResult, TranscriptionResponseSchema, ai-router does independent language detection).
