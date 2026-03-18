# Implementation Summary: Intent Classification & Command Parsing

## Files Changed
| File | Action | Description |
|------|--------|-------------|
| `services/ai-router/src/graph/intent-schemas.ts` | created | Zod schema for LLM structured output (IntentClassificationResultSchema) with z.enum for V1 command types per LOW-3 |
| `services/ai-router/src/graph/system-prompt.ts` | created | buildSystemPrompt function with role definition, V1 operations, intent categories, language detection rules, security instructions |
| `services/ai-router/src/graph/llm.ts` | created | createIntentClassifier factory: ChatOpenAI gpt-5.4-mini, temperature 0, reasoning_effort medium, 30s timeout, withStructuredOutput binding |
| `services/ai-router/src/graph/nodes/classify-intent.ts` | created | classifyIntentNode: extracts text, invokes LLM, handles callback_action as placeholder, graceful fallback on LLM error |
| `services/ai-router/src/graph/nodes/format-response.ts` | created | formatResponseNode: maps intentClassification to GraphResponse (text type). Separate node per LOW-1 with explanatory comment |
| `services/ai-router/src/graph/state.ts` | modified | Added intentClassification field to ConversationAnnotation and ConversationStateSchema |
| `services/ai-router/src/graph/graph.ts` | modified | Replaced echo node with classifyIntent -> formatResponse topology. createConversationGraph now takes { openaiApiKey } |
| `services/ai-router/src/graph/index.ts` | modified | Added exports for IntentClassificationResultSchema, IntentSchema, ConversationGraphConfig |
| `services/ai-router/src/config.ts` | modified | OPENAI_API_KEY changed from optional to required |
| `services/ai-router/src/app.ts` | modified | Passes config.openaiApiKey to createConversationGraph |
| `docker-compose.yml` | modified | Removed empty default from OPENAI_API_KEY (now required) |
| `services/ai-router/src/__tests__/config.test.ts` | modified | Updated: OPENAI_API_KEY in baseEnv, test for required validation |
| `services/ai-router/src/__tests__/process-endpoint.test.ts` | modified | Rewritten: mocks @langchain/openai, tests classified responses instead of echo |
| `services/ai-router/src/__tests__/guardrails-wiring.test.ts` | modified | Added @langchain/openai mock and openaiApiKey to mockConfig |
| `services/ai-router/src/__tests__/read-only-bypass.test.ts` | modified | Added OPENAI_API_KEY to baseEnv |
| `services/ai-router/src/contact-resolution/__tests__/routes.test.ts` | modified | Added @langchain/openai mock and openaiApiKey to testConfig |
| `services/ai-router/src/graph/__tests__/graph.test.ts` | modified | Rewritten: mocks LLM, tests new topology with intent classification |
| `services/ai-router/src/graph/__tests__/state.test.ts` | modified | Added tests for intentClassification field defaults and validation |

## Tests Added
| Test File | What It Tests |
|-----------|---------------|
| `services/ai-router/src/graph/__tests__/intent-schemas.test.ts` | (pre-existing) Schema validation for all intent types, V1 command type enum, confidence bounds, null handling |
| `services/ai-router/src/graph/__tests__/system-prompt.test.ts` | Prompt contains role, all V1 commands, five intent categories, language detection, security instructions, current date |
| `services/ai-router/src/graph/__tests__/llm.test.ts` | Factory creates ChatOpenAI with correct model/temp/timeout/reasoning_effort, binds structured output |
| `services/ai-router/src/graph/nodes/__tests__/classify-intent.test.ts` | Text/voice classification, callback_action passthrough, LLM error fallback, message structure |
| `services/ai-router/src/graph/nodes/__tests__/format-response.test.ts` | Maps all 5 intent types to GraphResponse, null classification handling, schema validation |

## Verification Results
- **Biome**: `pnpm biome check --diagnostic-level=error` passes with 0 errors on 56 files
- **Tests**: 19/20 test files pass, 178 tests pass, 22 skipped. The 1 failing file is `repository.integration.test.ts` (pre-existing, requires running PostgreSQL)

## Plan Deviations
- **LOW-2 (configurable reasoning_effort)**: Not implemented. Hardcoded to "medium" as the plan specified in Step 3. A future config option can be added when latency data is available.
- **LOW-4 (OTel span attributes)**: Not added in this task. The classify-intent node does not emit custom spans. This can be added as part of observability improvements.
- **MEDIUM-1 (typed commandPayload validation)**: Documented with TODO comment in intent-schemas.ts. Deferred to End-to-End Pipeline Wiring task as per plan scope.
- **MEDIUM-2 (redaction of OPENAI_API_KEY)**: Already covered by existing `sk-` pattern in `@monica-companion/redaction/patterns.ts`. No additional registration needed.
- **MEDIUM-3 (smoke test provisioning)**: Smoke tests are deferred as they require a running Docker environment with a valid OPENAI_API_KEY.

## Residual Risks
1. **Zod v4 / @langchain/openai compatibility**: The project uses zod/v4 while @langchain/openai@1.3.0 uses InteropZodType. Unit tests mock the LLM layer. Real compatibility is confirmed only at smoke test level with a live OpenAI call.
2. **reasoning_effort + withStructuredOutput**: Whether gpt-5.4-mini supports both simultaneously is untested without real API calls.
3. **commandPayload is loosely typed**: The LLM can return arbitrary JSON in commandPayload. Typed validation is deferred to pending-command creation.
4. **Callback action handling is minimal**: Returns a placeholder clarification_response. Full confirm/cancel/disambiguate logic is in a later task.
