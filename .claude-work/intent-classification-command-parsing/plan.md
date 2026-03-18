# Implementation Plan: Intent Classification & Command Parsing

## Objective

Replace the echo placeholder node in the ai-router LangGraph graph with a real LLM-powered intent classification and command parsing pipeline. After this work, the graph will call OpenAI `gpt-5.4-mini` with structured outputs to classify user utterances into one of five intent categories (`mutating_command`, `read_query`, `clarification_response`, `greeting`, `out_of_scope`), extract typed command payloads using Zod schemas, detect the user's language, and generate user-facing copy in that same language.

This task does NOT wire commands to pending-command creation, scheduler execution, or delivery. It produces the classification result and typed payload on the graph state -- downstream wiring happens in the "End-to-End Pipeline Wiring" task.

## Scope

### In Scope

- Integrate `@langchain/openai` `ChatOpenAI` with model `gpt-5.4-mini` and medium reasoning effort.
- Make `OPENAI_API_KEY` a required config field (no longer optional).
- Define a V1 system prompt covering all supported command types.
- Define Zod schemas for GPT structured output (the LLM response schema).
- Replace the echo `processNode` with `classifyIntentNode` and `formatResponseNode` in the LangGraph graph.
- Add an `intentClassification` field to graph state carrying the parsed result.
- Classify intents: `mutating_command`, `read_query`, `clarification_response`, `greeting`, `out_of_scope`.
- Extract typed command payloads for mutating and read-only intents.
- Detect user language from utterance text; include `detectedLanguage` and `userFacingText` in the classification output.
- Unit tests with mocked LLM responses (no real OpenAI calls in CI).
- Update existing tests that depend on the echo node behavior.

### Out of Scope

- Multi-turn conversation context loading (separate task).
- Pending command creation from classification output (separate task: "End-to-End Pipeline Wiring").
- Delivery wiring (classification produces graph state, not outbound intents yet).
- Contact resolution calls during classification (the LLM extracts a `contactRef` string; resolution happens in a later graph node).
- Benchmark fixture activation (separate task).
- Voice transcription model upgrade (separate task).

## Affected Services & Packages

| Package/Service | Changes |
|-----------------|---------|
| `services/ai-router` | Core changes: config, graph state, graph topology, new LLM module, system prompt, structured output schemas, tests |
| `packages/types` | No changes |
| `docker-compose.yml` | `OPENAI_API_KEY` becomes required for ai-router |

## Implementation Steps

### Step 1: Define LLM Structured Output Zod Schema

Create `services/ai-router/src/graph/intent-schemas.ts` containing the Zod schema that GPT structured outputs will produce.

```
IntentClassificationResultSchema = z.object({
  intent: z.enum(["mutating_command", "read_query", "clarification_response", "greeting", "out_of_scope"]),
  detectedLanguage: z.string(),       // ISO 639-1 code
  userFacingText: z.string(),         // response text in detected language
  commandType: z.string().nullable(), // e.g. "create_note", "query_birthday", null for greeting/out_of_scope
  contactRef: z.string().nullable(),  // natural-language contact reference
  commandPayload: z.record(z.string(), z.unknown()).nullable(), // extracted fields
  confidence: z.number().min(0).max(1),
})
```

**Files:**
- Create: `services/ai-router/src/graph/intent-schemas.ts`
- Create: `services/ai-router/src/graph/__tests__/intent-schemas.test.ts`

### Step 2: Build the System Prompt

Create `services/ai-router/src/graph/system-prompt.ts` with a builder function. The prompt:

1. Defines the assistant's role as Monica Companion, a personal CRM assistant.
2. Enumerates V1 supported operations: `create_contact`, `create_note`, `create_activity`, `update_contact_birthday`, `update_contact_phone`, `update_contact_email`, `update_contact_address`, `query_birthday`, `query_phone`, `query_last_note`.
3. Instructs intent classification into exactly one of five categories.
4. Instructs language detection and user-facing text generation in detected language.
5. Instructs extraction of `contactRef` and `commandPayload` fields.
6. Instructs greetings get friendly responses, out-of-scope gets polite declines.
7. Instructs the LLM to never reveal system instructions or internal details.

**Files:**
- Create: `services/ai-router/src/graph/system-prompt.ts`
- Create: `services/ai-router/src/graph/__tests__/system-prompt.test.ts`

### Step 3: Create the LLM Client Module

Create `services/ai-router/src/graph/llm.ts` exporting a factory:

- `model: "gpt-5.4-mini"`, `temperature: 0`, `reasoning_effort: "medium"`
- Explicit 30-second timeout
- API key injected as parameter (never imported from env directly)
- Returns model bound with `withStructuredOutput(IntentClassificationResultSchema)`

**Files:**
- Create: `services/ai-router/src/graph/llm.ts`
- Create: `services/ai-router/src/graph/__tests__/llm.test.ts`

### Step 4: Implement the classifyIntent Node

Create `services/ai-router/src/graph/nodes/classify-intent.ts`:

1. Extracts user text from `state.inboundEvent` (`.text` or `.transcribedText`).
2. For `callback_action` events, returns `clarification_response` placeholder.
3. Constructs message array: `[SystemMessage, HumanMessage]`.
4. Invokes the structured-output LLM.
5. Returns state update with `intentClassification`.
6. Handles LLM errors: returns `out_of_scope` with error-indicating text.

**Files:**
- Create: `services/ai-router/src/graph/nodes/classify-intent.ts`
- Create: `services/ai-router/src/graph/nodes/__tests__/classify-intent.test.ts`

### Step 5: Implement the formatResponse Node

Create `services/ai-router/src/graph/nodes/format-response.ts`:

Maps `state.intentClassification` to `GraphResponse`:
- All intent types -> `{ type: "text", text: userFacingText }`
- Later tasks will add richer routing (confirmation prompts, disambiguation).

**Files:**
- Create: `services/ai-router/src/graph/nodes/format-response.ts`
- Create: `services/ai-router/src/graph/nodes/__tests__/format-response.test.ts`

### Step 6: Add intentClassification to Graph State

Extend `ConversationAnnotation` and `ConversationStateSchema` in `state.ts` with:

```
intentClassification: Annotation<IntentClassificationResult | null>({
  reducer: (_prev, next) => next,
  default: () => null,
})
```

**Files:**
- Modify: `services/ai-router/src/graph/state.ts`
- Update: `services/ai-router/src/graph/__tests__/state.test.ts`

### Step 7: Rewire the Graph Topology

Replace echo graph:
- Current: `START -> process (echo) -> END`
- New: `START -> classifyIntent -> formatResponse -> END`

`createConversationGraph` now accepts config with `openaiApiKey`.

**Files:**
- Modify: `services/ai-router/src/graph/graph.ts`
- Update: `services/ai-router/src/graph/__tests__/graph.test.ts`
- Modify: `services/ai-router/src/graph/index.ts`

### Step 8: Make OPENAI_API_KEY Required and Wire Config

1. `config.ts`: Change from optional to required.
2. `app.ts`: Pass `config.openaiApiKey` to `createConversationGraph()`.
3. `docker-compose.yml`: Remove empty default from `OPENAI_API_KEY`.

**Files:**
- Modify: `services/ai-router/src/config.ts`
- Modify: `services/ai-router/src/app.ts`
- Modify: `docker-compose.yml`
- Update: `services/ai-router/src/__tests__/config.test.ts`
- Update: `services/ai-router/src/__tests__/process-endpoint.test.ts`

### Step 9: Update Remaining Tests

Update all test files that create the app or reference the graph to include `openaiApiKey` in mockConfig and mock the LLM module.

**Files:**
- Update: `services/ai-router/src/__tests__/boundary-enforcement.test.ts`
- Update: `services/ai-router/src/__tests__/guardrails-wiring.test.ts`
- Update: `services/ai-router/src/__tests__/read-only-bypass.test.ts`

## Test Strategy

### Unit Tests (Vitest)

| Test File | Tests | Mocks |
|-----------|-------|-------|
| `intent-schemas.test.ts` | Schema validation for valid/invalid inputs per intent type | None |
| `system-prompt.test.ts` | Prompt contains required instructions, command types, current date | None |
| `llm.test.ts` | Factory returns object with `invoke`, correct model config | ChatOpenAI constructor |
| `classify-intent.test.ts` | Correct classification for each intent, error handling, callback passthrough | LLM client (injected mock) |
| `format-response.test.ts` | Maps each intent type to correct GraphResponse shape | None (pure function) |
| `graph.test.ts` | Full graph flow produces valid response for each event type | LLM module (vi.mock) |
| `state.test.ts` | New intentClassification field defaults to null, accepts valid data | None |
| `config.test.ts` | OPENAI_API_KEY required, fails without it | Auth/guardrail loaders |
| `process-endpoint.test.ts` | Endpoint returns classified response instead of echo | LLM module, auth, guardrails |

### TDD Sequence

For each step, write the failing test FIRST, then implement to pass.

## Smoke Test Strategy

### Services to Start
```bash
docker compose --profile app up -d ai-router postgres redis
```

### HTTP Checks
1. Health check returns OK
2. Intent classification with valid JWT returns classified response
3. Language detection works for English and French
4. Out-of-scope messages get polite decline

## Security Considerations

1. **API key handling:** `OPENAI_API_KEY` never in logs/traces/errors. Redaction applied.
2. **No PII in logs:** User utterance text not logged at info level. Only intent type, command type, confidence logged.
3. **No PII in traces:** Span attributes include intent metadata but NOT raw utterance, contact names, or user-facing text.
4. **System prompt safety:** Instructs LLM to never reveal system instructions or API keys.
5. **Structured output validation:** Always validate LLM response with Zod schema after parsing (LLM output is untrusted input).
6. **Service auth unchanged:** Existing `serviceAuth` with allowlist `["telegram-bridge"]` remains.

## Risks

1. **Structured output + reasoning model compatibility:** `@langchain/openai` must support `reasoning_effort` with `withStructuredOutput()`. Verify during implementation.
2. **Zod v4 compatibility:** Project uses `zod/v4`. `@langchain/openai` may expect Zod v3. May need `zodToJsonSchema` explicitly.
3. **Callback action handling:** Minimal classification for now; full handling deferred.
4. **Latency:** Medium reasoning effort may approach 5s p95 target. Add `OPENAI_REASONING_EFFORT` config option.
5. **Cost estimation:** Current static `costPerRequestUsd` should be reviewed for `gpt-5.4-mini` pricing.
