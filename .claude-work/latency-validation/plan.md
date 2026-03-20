# Implementation Plan: Latency Validation

## Objective

Measure p95 time-to-first-response for the Monica Companion system under the Docker Compose staging environment, validate against acceptance criteria thresholds (text input: <=5 seconds, voice input: <=12 seconds), and profile the LangGraph pipeline for optimization opportunities if thresholds are exceeded.

This is a measurement and validation task, not a feature build.

## Scope

### In Scope

- Add per-node span instrumentation to the ai-router LangGraph pipeline
- Create a dedicated latency validation smoke test suite for text and voice flows
- Compute p95 from collected measurements and assert against acceptance criteria
- Profile per-node timing breakdown within the LangGraph pipeline
- Document optimization candidates and implement quick wins if thresholds exceeded
- Verify the existing Grafana HighLatency alert rule fires correctly

### Out of Scope

- Load testing or concurrency stress testing
- Changes to Grafana dashboard layout
- Changes to voice-transcription model selection
- Changes to LLM model or reasoning effort
- Production deployment or monitoring changes

## Affected Services & Packages

| Package/Service | Changes |
|---|---|
| `services/ai-router` | Add OTel spans to LangGraph nodes; add latency smoke tests; add graph timing wrapper |
| Other services | No code changes; used as-is in tests |

## Implementation Steps

### Step 1: Add OTel span instrumentation to LangGraph graph nodes

**What:** Add `trace.getTracer("ai-router")` spans to each LangGraph node for per-node latency visibility.

**Files to modify (add span wrappers):**
- `services/ai-router/src/graph/nodes/load-context.ts` — span `ai-router.graph.load_context`
- `services/ai-router/src/graph/nodes/classify-intent.ts` — span `ai-router.graph.classify_intent`
- `services/ai-router/src/graph/nodes/execute-action.ts` — span `ai-router.graph.execute_action`
- `services/ai-router/src/graph/nodes/format-response.ts` — span `ai-router.graph.format_response`
- `services/ai-router/src/graph/nodes/deliver-response.ts` — span `ai-router.graph.deliver_response`
- `services/ai-router/src/graph/nodes/persist-turn.ts` — span `ai-router.graph.persist_turn`

Each node wraps its body in `tracer.startActiveSpan("ai-router.graph.<node_name>", async (span) => { ... span.end(); })`. Record only structural metadata in attributes (intent type, action outcome type) — no user text, contact names, or PII per redaction rules.

**TDD:** Write a unit test verifying the span wrapper calls `span.end()` even when the inner function throws. Verify existing node tests still pass.

### Step 2: Add graph-level timing wrapper in /internal/process handler

**What:** Record total graph invocation time as a span attribute and structured log entry.

**File to modify:**
- `services/ai-router/src/app.ts` — wrap `graph.invoke()` with `performance.now()` timing; set `graph.total_duration_ms` as span attribute; emit structured log line.

### Step 3: Create latency validation smoke test — text input

**What:** Send 20 representative text messages through `POST /internal/process`, measure wall-clock time, compute p95.

**File to create:**
- `services/ai-router/src/__smoke__/latency-text.smoke.test.ts`

**Design:**
- Reuse `sendMessage()` from existing `helpers.ts`
- 1 warmup request (excluded from metrics) + 20 timed requests
- Fresh UUID userId per request to avoid context accumulation
- Cover: write (create_note, create_contact, update_birthday), read (query_birthday, query_phone), greeting, out_of_scope
- Compute p50, p95, p99, max
- Assert: `p95 <= 5000ms`
- Print latency report table to stdout

### Step 4: Create latency validation smoke test — voice input

**What:** Measure combined voice pipeline latency (transcription + intent classification).

**File to create:**
- `services/ai-router/src/__smoke__/latency-voice.smoke.test.ts`

**Approach (simulated voice path):**
1. **Transcription leg:** Call voice-transcription `POST /internal/transcribe` with a small synthetic OGG audio file. Measure round-trip.
2. **AI-router leg:** Already measured in Step 3.
3. **Combined:** Sum p95_transcription + p95_text_processing; assert <=12000ms.

**Audio fixture:** Create or bundle a small (3-5 second) OGG Opus file with clear English speech in `services/ai-router/src/__smoke__/fixtures/test-audio.ogg`.

**Fallback:** If synthetic audio is impractical, measure transcription latency from trace data or manual testing and document separately.

### Step 5: Run latency tests and record results

**What:** Execute tests against live Docker Compose stack and document results.

**Procedure:**
1. Start all services: `docker compose --profile app up -d --build`
2. Health check: ai-router (:3002), voice-transcription (:3003)
3. Run text latency test
4. Run voice latency test (if audio fixture available)
5. Capture results

### Step 6: Profile LangGraph pipeline and identify optimizations

**What:** Analyze per-node span durations. Document breakdown.

**Expected breakdown for text:**
- `load_context`: <100ms (parallel DB queries)
- `classify_intent`: 1500-4000ms (LLM call — dominant cost)
- `execute_action`: <200ms
- `format_response`: <5ms
- `deliver_response`: <500ms
- `persist_turn`: <100ms

**Optimization candidates (if thresholds exceeded, in priority order):**
1. Context window trimming — reduce MAX_CONVERSATION_TURNS from 10 to 5
2. Prompt caching — verify OpenAI automatic prompt caching is active (check `cached_tokens` in response)
3. Parallelize deliverResponse and persistTurn
4. Reduce reasoning effort to "low" (last resort, may impact accuracy)

### Step 7: Write results report

**File to create:**
- `.claude-work/latency-validation/results.md` — p50/p95/p99, per-node breakdown, optimizations applied

## Test Strategy

### Unit Tests
- Verify OTel span wrappers don't change functional behavior (existing node tests must pass)
- No new unit tests for smoke tests themselves

### Smoke Tests
The latency tests ARE the smoke tests. They require:
- Real Postgres, Redis, and all app services running
- Real OpenAI API key for LLM calls
- Network connectivity to OpenAI

### TDD Sequence
1. Add span wrappers to nodes, verify existing tests pass
2. Write text latency smoke test, run against live stack
3. Write voice latency smoke test, run against live stack

## Security Considerations

- No user text, contact names, or PII in span attributes — structural metadata only
- All test messages are synthetic
- Audio fixture contains synthetic speech only
- OPENAI_API_KEY from environment, never hardcoded
- Logged latency data includes only correlation IDs and timing numbers

## Risks

1. **LLM API variance:** OpenAI response times vary. Run 20+ requests for meaningful p95.
2. **Cold start effects:** Include warmup request excluded from p95 computation.
3. **Network dependency:** Document test environment alongside results.
4. **Voice test audio:** Fall back to manual measurement if synthetic audio is impractical.
