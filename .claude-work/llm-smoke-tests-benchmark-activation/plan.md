# Implementation Plan: LLM Smoke Tests & Benchmark Activation

## Objective

Activate the LLM evaluation pipeline and create Docker Compose smoke tests that validate the full AI-driven command lifecycle against a live service stack. This completes the quality-gate infrastructure required for V1 release: verifiable intent classification accuracy, false-positive mutation tracking, and acceptance-criteria enforcement.

## Scope

### In Scope

- Four LLM smoke test suites (command parsing, multi-stage dialog, context preservation, out-of-scope rejection) that hit the live ai-router `/internal/process` endpoint
- Activation of pending benchmark fixture cases in `read-intents.ts`, `write-intents.ts`, and `clarification-turns.ts` (change status from `"pending"` to `"active"`, fix V1 command type mismatches)
- Intent evaluation path in `evaluate.ts` that calls the real LangGraph classifier and compares structured output against expected labels
- False-positive mutation rate measurement (replace hardcoded `0`)
- Release gate enforcement via acceptance-criteria thresholds in CI
- `llm-smoke.yml` GitHub Actions workflow for on-demand and pre-release execution
- Root `pnpm test:smoke:llm` script

### Out of Scope

- Expanding the benchmark to 200 utterances (Phase 7 item "Benchmark Expansion to Release Threshold")
- Voice sample benchmarks (Phase 7 -- requires audio fixtures)
- Latency validation (separate Phase 7 item)
- Telegram-bridge webhook testing (already covered by existing smoke tests; LLM smoke tests bypass the Telegram layer intentionally)
- Changes to the LangGraph pipeline itself (no prompt tuning or graph topology changes)

## Affected Services & Packages

| Package/Service | Changes |
|-----------------|---------|
| `services/ai-router` | New `src/__smoke__/` directory with 4 smoke test files, new `vitest.smoke.config.ts`, fixture updates in `src/benchmark/fixtures/`, evaluator updates in `src/benchmark/evaluate.ts` |
| `packages/types` | No schema changes (existing `IntentBenchmarkCase.expected.commandType` is `z.string().nullable()` which already accommodates V1 types) |
| Root | New `pnpm test:smoke:llm` script in `package.json`, new `.github/workflows/llm-smoke.yml` |
| `context/product` | Update `testing-strategy.md` if any details change during implementation |

## Critical Pre-Implementation Finding: Fixture Command Type Misalignment

The benchmark fixtures in `read-intents.ts` and `write-intents.ts` use command types that do not exist in the V1 `IntentSchema` / `V1CommandTypeSchema` enum. These must be corrected before activation:

**Read intent fixtures (`read-intents.ts`):**
| Fixture ID | Current `commandType` | Correct V1 `commandType` | Action |
|---|---|---|---|
| ri-001 | `get_birthday` | `query_birthday` | Rename |
| ri-002 | `get_last_activity` | N/A (not a V1 query type) | Rewrite as `query_last_note` for "Mom" or remove |
| ri-003 | `list_birthdays` | N/A (not V1) | Remove -- V1 only supports single-contact lookups |
| ri-004 | `get_contact` | N/A (not V1) | Remove -- V1 has no generic `get_contact` query |
| ri-005 | `list_activities` | N/A (not V1) | Remove -- V1 has no activity listing query |
| ri-006 | `list_reminders` | N/A (not V1) | Remove -- V1 has no reminder listing query |

**Write intent fixtures (`write-intents.ts`):**
| Fixture ID | Current `commandType` | Correct V1 `commandType` | Action |
|---|---|---|---|
| wi-003 | `update_contact` | `update_contact_birthday` | Be specific |
| wi-005 | `create_reminder` | N/A (not V1 mutating type) | Remove |
| wi-007 | `update_contact` | `update_contact_phone` | Be specific |
| wi-009 | `create_task` | N/A (not V1) | Remove |

After cleanup: ~4 read intent cases, ~8 write intent cases, 4 clarification cases = 16 active intent cases. Combined with the existing 45 active contact-resolution cases = 61 total active cases.

## Implementation Steps

### Step 1: Create LLM smoke test infrastructure

**What:** Set up the vitest config, smoke config, and helper utilities for the LLM smoke tests in `services/ai-router/src/__smoke__/`.

**Files to create:**
- `services/ai-router/vitest.smoke.config.ts` -- Vitest config that includes `src/__smoke__/**/*.smoke.test.ts`, with extended timeouts (60s per test, 120s hooks), JUnit output, `fileParallelism: false`
- `services/ai-router/src/__smoke__/smoke-config.ts` -- Zod-validated config loading `OPENAI_API_KEY`, `AI_ROUTER_URL` (default `http://localhost:3002`), `JWT_SECRET`, `POSTGRES_URL`
- `services/ai-router/src/__smoke__/helpers.ts` -- Shared helper that signs a JWT (issuer=`telegram-bridge`, audience=`ai-router`) and sends an `InboundEvent` to `/internal/process`, returning the parsed `GraphResponse`. Reuse `signServiceToken` from `@monica-companion/auth`. Include a `sendMessage(userId, text, correlationId?)` convenience function.

**Expected outcome:** Running `vitest run --config vitest.smoke.config.ts` with proper env vars finds and runs tests in `__smoke__/`. With no test files yet, it exits cleanly.

**TDD:** Write a trivial placeholder test that asserts config loading works, then implement the config loader.

### Step 2: Command parsing smoke tests

**What:** Create `services/ai-router/src/__smoke__/command-parsing.smoke.test.ts` covering all V1 command types.

**Test cases (each sends a `text_message` to `/internal/process` and asserts on the JSON response):**
1. `create_contact` -- "Create a new contact named Bob Wilson" -- expect `type` = `confirmation_prompt` or `text`, response text mentions "Bob Wilson"
2. `create_note` -- "Add a note to Jane about our lunch yesterday" -- expect response references "Jane" and "note"
3. `create_activity` -- "I had coffee with Sarah this morning" -- expect response references "Sarah" and "activity"/"coffee"
4. `update_contact_birthday` -- "Update Alex's birthday to March 5th" -- expect response references "Alex" and "birthday"
5. `update_contact_phone` -- "Set David's phone number to 555-0199" -- expect response references "David" and "phone"
6. `update_contact_email` -- "Change Lisa's email to lisa@example.com" -- expect response references "Lisa" and "email"
7. `update_contact_address` -- "Update Maria's address to 123 Oak Street, Portland" -- expect response references address
8. `query_birthday` (read) -- "When is Sarah's birthday?" -- expect `type` = `text` (not `confirmation_prompt`), response text is non-empty
9. `query_phone` (read) -- "What's John's phone number?" -- expect `type` = `text`
10. `query_last_note` (read) -- "Show me the last note about Mike" -- expect `type` = `text`

**Key assertion pattern:** Each test sends a `text_message` via the `sendMessage` helper, asserts `status === 200`, asserts `body.type` is one of `["text", "confirmation_prompt", "disambiguation_prompt"]` (not `"error"`), and asserts `body.text` is a non-empty string. Mutating commands should produce `confirmation_prompt` or `text` (if auto-confirmed); read queries should produce `text`. We do NOT assert exact wording since LLM output varies.

**Each test uses a unique `userId` (random UUID)** so there are no cross-test state interactions via `conversation_turns` or `pending_commands`.

**TDD sequence:** Write the first test (create_note) expecting `status === 200` and `body.type` to exist. Run it -- it will fail because the smoke infrastructure is not wired. Step 1's helpers make it pass. Then add remaining cases.

### Step 3: Out-of-scope rejection smoke tests

**What:** Create `services/ai-router/src/__smoke__/out-of-scope.smoke.test.ts`.

**Test cases:**
1. "What's the weather like today?" -- expect `type` = `text`, response should be a polite decline
2. "Who won the World Cup in 2022?" -- expect no `confirmation_prompt` (no pending command created)
3. "Write me a Python function to sort a list" -- expect `type` = `text`, no mutation
4. "Tell me a joke" -- expect `type` = `text`

**Critical assertion:** After each out-of-scope message, query the `pending_commands` table directly via a Postgres client (using `POSTGRES_URL` from config) to verify NO pending command was created for that userId. This is the definitive proof that no mutation was triggered.

**TDD:** Write the weather test first, assert no pending command in DB, then implement the DB query helper in `helpers.ts`.

### Step 4: Multi-stage dialog smoke tests

**What:** Create `services/ai-router/src/__smoke__/dialog-clarification.smoke.test.ts`.

**Test cases:**
1. **Ambiguous contact clarification:**
   - Send "Add a note" (missing contact) to userId A
   - Assert response asks for clarification (response text is a question)
   - Query DB: pending command for userId A exists in `draft` status
   - Send "to Jane about the meeting" as a follow-up for the same userId A
   - Assert response is now a `confirmation_prompt` (or `text` if auto-confirmed)
   - Query DB: pending command transitioned to `pending_confirmation` (or `confirmed`)

2. **Missing fields clarification:**
   - Send "Update a birthday" (missing contact AND date)
   - Assert clarification response
   - Query DB: draft status
   - Send "Alex's birthday is March 5th"
   - Assert final response with confirmation prompt

**Note on multi-turn:** The `conversation_turns` table is populated by the `persistTurn` graph node after each invocation. The `loadContext` node reads them back on the next invocation for the same userId. This enables the follow-up resolution. Both messages must use the same `userId`.

**TDD:** Write case 1 first (two sequential messages), assert DB state between them.

### Step 5: Context preservation smoke tests

**What:** Create `services/ai-router/src/__smoke__/context-preservation.smoke.test.ts`.

**Test cases:**
1. **Pronoun resolution across turns:**
   - Send "Add a note to John about our meeting" to userId B
   - Wait for response (LLM processes, turn is persisted)
   - Send "Also update his birthday to March 5th" to the same userId B
   - Assert the second response references "John" (not asking "who do you mean by 'his'?")
   - Assert response type is `confirmation_prompt` or `text` for `update_contact_birthday`

2. **Implicit reference resolution:**
   - Send "What's Sarah's birthday?" to userId C
   - Wait for response
   - Send "Add a note to her about the party" to same userId C
   - Assert the response references "Sarah" (resolved from context)

**TDD:** Write case 1 first, assert the second response does not contain clarification-style text (no "who" or "which" in the text).

### Step 6: Fix and activate benchmark fixture cases

**What:** Update the fixtures to use correct V1 command types and change `status` from `"pending"` to `"active"`.

**Files to modify:**

**`services/ai-router/src/benchmark/fixtures/read-intents.ts`:**
- Keep ri-001: change `commandType` from `"get_birthday"` to `"query_birthday"`
- Rewrite ri-002: change utterance to "What was the last note about Mom?" and `commandType` to `"query_last_note"`
- Remove ri-003 through ri-006 (not V1 operations)
- Add 2 new cases to maintain coverage:
  - ri-003 (new): "What's Alex's phone number?" -> `commandType: "query_phone"`, `contactRef: "Alex"`, `resolvedContactId: 2`
  - ri-004 (new): "When is my brother's birthday?" -> `commandType: "query_birthday"`, `contactRef: "brother"`, `resolvedContactId: 2`
- Set all cases to `status: "active"`

**`services/ai-router/src/benchmark/fixtures/write-intents.ts`:**
- Keep wi-001 (create_note) as-is, set `status: "active"`
- Keep wi-002 (create_contact) as-is, set `status: "active"`
- Fix wi-003: change `commandType` from `"update_contact"` to `"update_contact_birthday"`, set `status: "active"`
- Keep wi-004 (create_activity) as-is, set `status: "active"`
- Remove wi-005 (create_reminder -- not V1)
- Keep wi-006 (create_note for gift idea) as-is, set `status: "active"`
- Fix wi-007: change `commandType` from `"update_contact"` to `"update_contact_phone"`, set `status: "active"`
- Keep wi-008 (create_activity -- lunch) as-is, set `status: "active"`
- Remove wi-009 (create_task -- not V1)
- Keep wi-010 (create_note) as-is, set `status: "active"`

**`services/ai-router/src/benchmark/fixtures/clarification-turns.ts`:**
- Set all 4 cases to `status: "active"`

**Expected case counts after cleanup:**
- Read intent: 4 active
- Write intent: 8 active
- Clarification: 4 active
- Contact resolution: 45 active (unchanged)
- Total: 61 active

**TDD:** Update `fixtures.test.ts` first to assert the new minimum counts (4 read, 8 write, 4 clarification, all active). Run -- fails. Then fix the fixtures.

### Step 7: Implement intent evaluation in evaluate.ts

**What:** Replace the stub in `evaluateBenchmark()` that says "Intent evaluation not implemented" with actual LLM-based evaluation.

**File to modify:** `services/ai-router/src/benchmark/evaluate.ts`

**Design:**
- Add an `evaluateIntentCase(case: IntentBenchmarkCase, classifier: Classifier)` function
- The function:
  1. Builds a system prompt via `buildSystemPrompt()` (no conversation history for most cases)
  2. Invokes `classifier.invoke([systemMessage, humanMessage])` with the case's `utterance`
  3. Compares `result.intent` to determine if the case passed:
     - For `write_intent` cases: `result.intent === "mutating_command"` AND `result.commandType === expected.commandType`
     - For `read_intent` cases: `result.intent === "read_query"` AND `result.commandType === expected.commandType`
     - For `clarification` cases: `result.intent === "clarification_response"` (when `expected.commandType === null`)
  4. Optionally checks `result.contactRef` matches `expected.contactRef` (case-insensitive substring match)
  5. Returns a `CaseResult` with pass/fail, errors, and duration

**Async evaluation:** Since the classifier is async (calls OpenAI), `evaluateBenchmark()` must become `async`. This changes the signature. All callers (`benchmark.test.ts`, smoke tests) must be updated.

**Classifier injection:** `evaluateBenchmark()` gets an optional `classifier` parameter. When provided, intent cases are evaluated. When absent (e.g., in unit tests without OpenAI), intent cases are skipped (reported as pending).

**Updated signature:**
```typescript
export async function evaluateBenchmark(
  cases: BenchmarkCase[],
  classifier?: { invoke(messages: unknown[]): Promise<IntentClassificationResult> }
): Promise<EvaluationReport>
```

**TDD:** Write a unit test with a mock classifier that returns known results, assert the evaluator produces correct pass/fail verdicts for intent cases. Then implement.

### Step 8: Implement false-positive mutation rate tracking

**What:** Replace `const falsePositiveMutationRate = 0` in `evaluate.ts` with actual measurement.

**Logic:**
1. Count cases where `expected.isMutating === false` (all read_intent and clarification cases)
2. Among those, count cases where the LLM returned `intent === "mutating_command"` (false positive)
3. `falsePositiveMutationRate = falsePositiveCount / nonMutatingCaseCount`
4. When there are no non-mutating active cases, report `0`

**Implementation detail:** The `evaluateIntentCase` function stores the actual intent in `CaseResult.actual`. The aggregation loop in `evaluateBenchmark` iterates over case results for non-mutating expected cases and counts false positives.

**TDD:** Write a unit test with a mock classifier that incorrectly classifies a read intent as mutating_command. Assert `falsePositiveMutationRate > 0`.

### Step 9: Update benchmark.test.ts for async evaluation and CI gating

**What:** Update `services/ai-router/src/benchmark/__tests__/benchmark.test.ts` to:
1. Make the evaluation async
2. Conditionally pass a classifier when `OPENAI_API_KEY` is available
3. Assert thresholds against actual results when active intent cases exist

**Changes:**
- The top-level `evaluateBenchmark(allBenchmarkCases)` call becomes `await evaluateBenchmark(allBenchmarkCases, classifier)` inside a `beforeAll`
- When `OPENAI_API_KEY` is not a real key (e.g., CI with `sk-fake-ci-key`), skip the classifier parameter -- intent cases remain unevaluated and thresholds for read/write accuracy are skipped
- When `OPENAI_API_KEY` IS a real key, pass the classifier -- all active intent cases are evaluated and thresholds are enforced
- The contact-resolution threshold (`>= 95%`) is always enforced (no LLM needed)

**CI impact:** The existing `pnpm bench:ai` step in `ci.yml` uses `sk-fake-ci-key`. Contact resolution precision will still be enforced. Intent accuracy will be enforced only when the `llm-smoke.yml` workflow runs with a real key.

### Step 10: Add root scripts and GitHub Actions workflow

**What:** Wire up the scripts and CI workflow.

**Files to create/modify:**

**`services/ai-router/package.json`:** Add script `"test:smoke": "vitest run --config vitest.smoke.config.ts"`

**Root `package.json`:** Add script `"test:smoke:llm": "pnpm --filter @monica-companion/ai-router test:smoke"`

**`.github/workflows/llm-smoke.yml`:**
```yaml
name: LLM Smoke Tests
on:
  workflow_dispatch:
    inputs:
      reason:
        description: "Reason for running"
        required: false
        default: "Manual trigger"
concurrency:
  group: llm-smoke
  cancel-in-progress: true
jobs:
  llm-smoke:
    runs-on: ubuntu-latest
    services:
      postgres: [same as ci.yml]
      redis: [same as ci.yml]
    steps:
      - Checkout, pnpm, Node.js setup (same as ci.yml)
      - Install dependencies
      - Run migrations (ai-router, user-management, delivery, scheduler)
      - Start services (ai-router, user-management, delivery, scheduler)
        with OPENAI_API_KEY from secrets
      - Wait for health
      - Run LLM smoke tests: pnpm test:smoke:llm
        env: OPENAI_API_KEY, JWT_SECRET, AI_ROUTER_URL, POSTGRES_URL
      - Run benchmark with real key: pnpm bench:ai
        env: OPENAI_API_KEY
      - Upload results as artifacts
```

### Step 11: Update testing-strategy.md and verify documentation

**What:** Update `context/product/testing-strategy.md` to reflect any implementation details that diverged from the planned structure. Verify the `pnpm test:smoke:llm` command documented there matches reality.

## Test Strategy

### Unit Tests (Vitest -- no OpenAI key needed)

**What to test:**
1. `evaluateIntentCase()` with a mock classifier returning known results -- verify pass/fail logic for each category
2. False-positive mutation rate calculation with mock data -- verify the formula is correct
3. Fixture schema validation -- all active cases parse against their Zod schemas
4. Fixture command type alignment -- all `commandType` values in active fixtures exist in the V1 command type enum

**What to mock:**
- The classifier's `invoke()` method -- returns predetermined `IntentClassificationResult` objects
- No OpenAI calls, no HTTP calls, no database

**TDD sequence for evaluate.ts changes:**
1. RED: Write test asserting `evaluateIntentCase()` returns `passed: true` for a correct write intent classification. Fails because function doesn't exist.
2. GREEN: Implement `evaluateIntentCase()` with classifier invocation and comparison logic.
3. RED: Write test asserting false-positive mutation rate is non-zero when a read intent is misclassified. Fails because rate is still hardcoded.
4. GREEN: Implement actual counting in `evaluateBenchmark()`.
5. REFACTOR: Clean up, extract helpers.

### LLM Smoke Tests (need real OpenAI key + live Docker stack)

These are the primary verification mechanism for this task group. They run against the live Docker Compose stack with a real OpenAI API key.

**Docker Compose services to start:**
- `postgres` (infrastructure, always running)
- `redis` (infrastructure, always running)
- `ai-router` (the target service -- needs real `OPENAI_API_KEY`)
- `user-management` (ai-router depends on it for delivery routing and preferences)
- `delivery` (ai-router sends responses through delivery)
- `scheduler` (ai-router sends confirmed commands to scheduler)
- `monica-integration` (ai-router calls it for contact resolution)

**HTTP checks to run:**
1. **Health pre-check:** `GET http://localhost:3002/health` returns `200` with `{"status":"ok"}` before running tests
2. **Command parsing:** `POST http://localhost:3002/internal/process` with various `text_message` payloads, authenticated JWT
3. **Dialog flow:** Sequential `POST` calls to the same userId, checking response types and DB state between calls
4. **DB verification:** Direct `SELECT` from `pending_commands` table via `POSTGRES_URL` to verify no unintended mutations

## Security Considerations

1. **OpenAI API key handling:** The `OPENAI_API_KEY` is a secret. It must come from environment variables or GitHub Actions secrets, never hardcoded. The smoke config uses Zod validation with `.min(1)` -- no default value.
2. **Test user IDs:** Each smoke test uses a random UUID for `userId`. No real Telegram user IDs or PII appear in test data.
3. **JWT signing:** Smoke tests use the shared `JWT_SECRET` to sign service-to-service tokens.
4. **Redaction in CI output:** The benchmark summary formatter already excludes PII-bearing fields from output.
5. **DB access in smoke tests:** The `POSTGRES_URL` is used for read-only verification queries (`SELECT` from `pending_commands`). No write operations are performed directly against the database from test code.
6. **No raw LLM responses in logs:** The smoke tests assert on `GraphResponse` fields (`type`, `text`) but do not log full LLM responses.

## Risks

1. **LLM non-determinism:** The same utterance may produce slightly different classifications across runs. Tests assert on structural properties rather than exact text.
2. **OpenAI rate limits / cost:** ~$0.30-$0.50 per full suite run. Acceptable for manual/nightly runs.
3. **Fixture case count below Phase 7 targets:** After cleanup, ~16 active intent cases. Phase 7 target is 200. This plan explicitly defers expansion.
4. **Clarification test flakiness:** Multi-turn dialog tests depend on the LLM producing clarification questions for ambiguous inputs. Mitigation: use utterances that are clearly incomplete.
5. **Contact resolution in smoke tests:** The live ai-router calls `monica-integration` for contact resolution, which has no real Monica backend. For smoke tests, this is acceptable -- we are testing intent classification, not contact resolution.
