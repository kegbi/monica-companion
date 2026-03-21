# Implementation Plan: Migrate LLM Evaluation to promptfoo

## Objective

Replace the custom intent-evaluation pipeline in `evaluate.ts` and `benchmark.test.ts` with [promptfoo](https://www.promptfoo.dev/), an open-source LLM evaluation framework. This moves LLM quality gates (intent classification, payload extraction, false-positive mutation detection) into a declarative YAML-based evaluation suite while keeping deterministic contact-resolution tests in Vitest. The migration produces better evaluation reporting, easier dataset expansion, and standardized CI integration without changing the actual LLM provider or system prompt.

## Scope

### In Scope

- Install `promptfoo` as a pinned exact dev dependency in `ai-router`.
- Create a custom promptfoo provider wrapping `createIntentClassifier()`.
- Convert all 200 intent fixtures (100 write, 60 read, 25 clarification, 10 out-of-scope, 5 greeting) from TypeScript to YAML promptfoo datasets with proper assertions.
- Create a custom `isMutating` scorer to detect false-positive mutations.
- Create `promptfooconfig.yaml` with pass-rate thresholds matching acceptance criteria.
- Rewire `pnpm bench:ai` to run `promptfoo eval` for LLM quality gates.
- Slim `evaluate.ts` to contact-resolution-only evaluation.
- Slim `benchmark.test.ts` to contact-resolution quality gate only.
- Migrate applicable LLM integration tests from `llm-integration.test.ts` into promptfoo datasets.
- Update CI workflows to run both promptfoo eval and Vitest.

### Out of Scope

- Changing the system prompt, LLM model, or intent classification logic.
- Modifying the contact-resolution matcher or its benchmark fixtures.
- Adding new test cases beyond what currently exists.
- Changing the LangGraph graph structure.
- Modifying shared packages (`@monica-companion/types`, etc.).

## Affected Services & Packages

| Package/Service | Changes |
|-----------------|---------|
| `services/ai-router` | New `promptfoo/` directory with config, provider, datasets, scorers. Modified `package.json` (new dep, updated scripts). Slimmed `evaluate.ts` and `benchmark.test.ts`. Modified `vitest.bench.config.ts`. |
| `services/ai-router/src/benchmark/` | `evaluate.ts` loses `evaluateIntentCase()` and intent aggregation. `benchmark.test.ts` loses intent threshold checks. `index.ts` loses intent-related re-exports. |
| `services/ai-router/src/__tests__/llm-integration/` | `llm-integration.test.ts` loses tests migrated to promptfoo; keeps multi-turn context and prompt injection tests. |
| Root `package.json` | `bench:ai` script updated to run promptfoo eval. |
| `.github/workflows/ci.yml` | `bench:ai` step now invokes promptfoo. No structural change needed if the script stays the same. |
| `.github/workflows/llm-smoke.yml` | `bench:ai` step now invokes promptfoo with real API key. |
| `@monica-companion/types` | No changes. BenchmarkMetrics and CaseResult schemas remain for contact-resolution. |

## Implementation Steps

### Step 1: Install promptfoo

**What:** Add `promptfoo` as a pinned exact dev dependency in `services/ai-router/package.json`.

**Files to modify:**
- `services/ai-router/package.json` -- add `"promptfoo": "<exact-version>"` to `devDependencies`

**Details:**
- Look up the latest stable version of `promptfoo` on npmjs.com before installing. As of this plan, the version must be verified at implementation time per `dependencies.md` rules.
- Use `pnpm add -D --filter @monica-companion/ai-router promptfoo@<exact-version>` with an exact version (no caret/tilde).
- Verify it installs cleanly and does not conflict with existing dependencies (Node 24, ESM modules).

**Expected outcome:** `pnpm install` succeeds. `npx promptfoo --version` prints the installed version from within the `services/ai-router` directory.

---

### Step 2: Create the custom promptfoo provider

**What:** Create a custom provider module that wraps `createIntentClassifier()` so promptfoo can call it with utterance text and receive `IntentClassificationResult` JSON.

**Files to create:**
- `services/ai-router/promptfoo/provider.ts` -- the custom provider

**Details:**

The promptfoo custom provider must export a default function (or class) that implements the promptfoo `ApiProvider` interface. The provider:

1. Receives the prompt text (the user utterance) from promptfoo.
2. Constructs the system prompt via `buildSystemPrompt()` and the user message via LangChain's `HumanMessage`.
3. Calls `classifier.invoke(messages)` using `createIntentClassifier()` with the `OPENAI_API_KEY` from the environment.
4. Returns the `IntentClassificationResult` as a JSON string in the `output` field.

The provider must be a `.ts` file that promptfoo can load. Promptfoo supports TypeScript providers natively when run via `npx promptfoo eval`.

Key implementation details:
- The provider is instantiated once per eval run and reuses the classifier instance.
- The `OPENAI_API_KEY` is read from the environment at instantiation time.
- If `OPENAI_API_KEY` is missing or starts with `sk-fake`, the provider should throw a clear error (promptfoo evals must only run with a real key).
- The provider must NOT log or trace utterance text or PII -- only case IDs and pass/fail status are safe to emit (per `security.md` redaction rules).

Provider structure (pseudocode):
```
class IntentClassifierProvider implements ApiProvider {
  id() { return 'intent-classifier'; }
  async callApi(prompt: string) {
    const systemPrompt = buildSystemPrompt();
    const messages = [new SystemMessage(systemPrompt), new HumanMessage(prompt)];
    const result = await classifier.invoke(messages);
    return { output: JSON.stringify(result) };
  }
}
```

**Expected outcome:** The provider file exists and can be imported by promptfoo config. Unit-test the provider manually by running `npx promptfoo eval --no-cache` with a single test case.

---

### Step 3: Convert write-intent fixtures to `write-intents.yaml`

**What:** Convert all 100 write-intent cases from `write-intents.ts` to a promptfoo YAML dataset.

**Files to create:**
- `services/ai-router/promptfoo/datasets/write-intents.yaml`

**Details:**

Each fixture case becomes a promptfoo test entry. The YAML structure for promptfoo datasets uses a list of tests, where each test has:
- `vars.utterance` -- the utterance text (becomes the prompt)
- `assert` -- a list of assertions

For write intents, assertions per case:
1. `type: is-json` -- output must be valid JSON
2. `type: javascript` -- check `output.intent === "mutating_command"`
3. `type: javascript` -- check `output.commandType === "<expected>"` (e.g., `"create_note"`)
4. `type: javascript` -- check `output.contactRef` matches expected contactRef (case-insensitive substring match, matching current `evaluateIntentCase` logic)

Example entry:
```yaml
- vars:
    utterance: "Add a note to Mom about her garden project"
  metadata:
    id: "wi-001"
    category: "write_intent"
  assert:
    - type: is-json
    - type: javascript
      value: "output.intent === 'mutating_command'"
    - type: javascript
      value: "output.commandType === 'create_note'"
    - type: javascript
      value: "output.contactRef && output.contactRef.toLowerCase().includes('mom')"
```

The description and case ID should be included as `metadata` on each test for reporting.

Conversion approach:
- Write a one-time conversion script (not committed) that reads the TS fixtures, serializes them to YAML format, and writes the file. Or do it manually since the structure is repetitive.
- Omit `voiceSamplePath`, `contactContext`, `resolvedContactId`, and `isMutating` from the YAML since promptfoo does not use them for intent evaluation (these are for contact resolution, which stays in Vitest). `isMutating` is handled by the `guardrails.yaml` isMutating scorer instead.
- The `isMutating: true` field on write intents is implicitly asserted by `intent === "mutating_command"`.

**Expected outcome:** `write-intents.yaml` contains 100 test entries with proper assertions. Each maps cleanly to the original TS fixture.

---

### Step 4: Convert read-intent fixtures to `read-intents.yaml`

**What:** Convert all 60 read-intent cases from `read-intents.ts` to a promptfoo YAML dataset.

**Files to create:**
- `services/ai-router/promptfoo/datasets/read-intents.yaml`

**Details:**

Same structure as write intents, but assertions check:
1. `type: is-json`
2. `type: javascript` -- `output.intent === "read_query"`
3. `type: javascript` -- `output.commandType === "<expected>"` (e.g., `"query_birthday"`, `"query_phone"`, `"query_last_note"`)
4. `type: javascript` -- contactRef case-insensitive substring match

Tag with `category: "read_intent"` in metadata.

**Expected outcome:** `read-intents.yaml` contains 60 test entries.

---

### Step 5: Convert clarification fixtures to `clarification.yaml`

**What:** Convert all 25 clarification cases from `clarification-turns.ts` to a promptfoo YAML dataset.

**Files to create:**
- `services/ai-router/promptfoo/datasets/clarification.yaml`

**Details:**

Assertions for clarification cases:
1. `type: is-json`
2. `type: javascript` -- `output.intent === "clarification_response"`

For cases that have a non-null `contactRef` in expected (e.g., disambiguation answers like cl-006 through cl-010, cl-020 through cl-022), add:
3. `type: javascript` -- contactRef substring match

For cases that have null `contactRef` (confirmations, negations, missing-info), the contactRef assertion is omitted.

Tag with `category: "clarification"` in metadata.

**Expected outcome:** `clarification.yaml` contains 25 test entries.

---

### Step 6: Convert out-of-scope and greeting fixtures to `guardrails.yaml` with `isMutating` assertions

**What:** Convert 10 out-of-scope cases and 5 greeting cases into a single `guardrails.yaml` dataset. Include inline `isMutating` assertions that detect false-positive mutations.

**Files to create:**
- `services/ai-router/promptfoo/datasets/guardrails.yaml`

**Details:**

Assertions for out-of-scope cases:
1. `type: is-json`
2. `type: javascript` -- `output.intent === "out_of_scope"`
3. `type: javascript` -- `output.commandType === null`
4. `type: javascript`, `metric: isMutating` -- `output.intent !== "mutating_command"` (replaces the manual `falsePositiveMutationRate` calculation)

Assertions for greeting cases:
1. `type: is-json`
2. `type: javascript` -- `output.intent === "greeting"`
3. `type: javascript` -- `output.commandType === null`
4. `type: javascript`, `metric: isMutating` -- `output.intent !== "mutating_command"`

Use inline `javascript` assertions for the `isMutating` check rather than a separate scorer file -- simpler and avoids unnecessary abstraction.

Tag with `category: "guardrails"` in metadata.

**Expected outcome:** `guardrails.yaml` contains 15 test entries (10 out-of-scope + 5 greeting). Every entry has an `isMutating` assertion.

---

### Step 7: Create `promptfooconfig.yaml`

**What:** Create the main promptfoo configuration file that ties together the provider, datasets, and evaluation settings.

**Files to create:**
- `services/ai-router/promptfooconfig.yaml`

**Details:**

```yaml
description: "Monica Companion Intent Classification Quality Gates"

providers:
  - id: file://promptfoo/provider.ts

prompts:
  - "{{utterance}}"

tests:
  - file://promptfoo/datasets/write-intents.yaml
  - file://promptfoo/datasets/read-intents.yaml
  - file://promptfoo/datasets/clarification.yaml
  - file://promptfoo/datasets/guardrails.yaml
```

To enforce per-category thresholds (read >= 92%, write >= 90%, false-positive mutation < 1%), create a wrapper script `check-thresholds.ts` (Step 8) since promptfoo's built-in `--threshold` flag only supports a global pass rate.

**Expected outcome:** `promptfooconfig.yaml` correctly references all datasets and the custom provider.

---

### Step 8: Create the threshold-checking wrapper script

**What:** Create a Node.js script that runs `promptfoo eval`, parses results, and enforces per-category accuracy thresholds.

**Files to create:**
- `services/ai-router/promptfoo/check-thresholds.ts`

**Details:**

The script:
1. Checks `OPENAI_API_KEY` -- if missing or starts with `sk-fake`, prints "Skipping promptfoo eval (no real API key)" and exits 0.
2. Runs `npx promptfoo eval --output promptfoo/results.json --no-cache`.
3. Reads `promptfoo/results.json`.
4. Groups results by `metadata.category`.
5. Computes:
   - `readAccuracy` = passed read_intent tests / total read_intent tests
   - `writeAccuracy` = passed write_intent tests / total write_intent tests
   - `falsePositiveMutationRate` = count of non-mutating tests where `intent === "mutating_command"` / total non-mutating tests
6. Prints a formatted report (case IDs and pass/fail only -- no PII).
7. Exits 0 if all thresholds pass, exits 1 otherwise.

Thresholds:
- Read accuracy >= 0.92
- Write accuracy >= 0.90
- False-positive mutation rate < 0.01

**Expected outcome:** `npx tsx promptfoo/check-thresholds.ts` runs the full eval and reports results with exit code based on thresholds.

---

### Step 9: Update `package.json` scripts

**What:** Wire the new promptfoo evaluation into `pnpm bench:ai`.

**Files to modify:**
- `services/ai-router/package.json` -- update `bench` script

**Details:**

Update the `bench` script:
```json
"bench": "vitest run --config vitest.bench.config.ts && tsx promptfoo/check-thresholds.ts"
```

This runs both Vitest (contact-resolution) and promptfoo (intent classification) quality gates. The `check-thresholds.ts` script skips gracefully when `OPENAI_API_KEY` is fake, matching current behavior.

**Expected outcome:** `pnpm bench:ai` runs both quality gates.

---

### Step 10: Slim down `evaluate.ts`

**What:** Remove `evaluateIntentCase()` and intent aggregation logic. Keep only contact-resolution evaluation.

**Files to modify:**
- `services/ai-router/src/benchmark/evaluate.ts`

**Details:**

Remove:
- The `Classifier` interface
- `evaluateIntentCase()` function
- The `classifier` parameter from `evaluateBenchmark()`
- All intent-related metric computation: `readAccuracy`, `writeAccuracy`, `falsePositiveMutationRate`, intent result filtering
- The intent case iteration branch in `evaluateBenchmark()`

Keep:
- `evaluateContactResolutionCase()`
- `evaluateBenchmark()` simplified to only iterate contact-resolution cases
- `formatBenchmarkSummary()` simplified
- `EvaluationReport` interface (simplified)

Set `readAccuracy`, `writeAccuracy`, `falsePositiveMutationRate` to `0` in the metrics object (shared type is not modified in this task).

**Expected outcome:** `evaluate.ts` contains only contact-resolution evaluation logic.

---

### Step 11: Slim down `benchmark.test.ts`

**What:** Remove intent-accuracy threshold tests. Keep only contact-resolution precision threshold.

**Files to modify:**
- `services/ai-router/src/benchmark/__tests__/benchmark.test.ts`

**Details:**

Remove:
- `isRealKey` check and conditional classifier creation
- Dynamic import of `createIntentClassifier`
- "read accuracy meets threshold" test
- "write accuracy meets threshold" test
- "false-positive mutation rate stays below threshold" test
- The classifier parameter in `evaluateBenchmark()` call

Keep:
- "contact-resolution precision meets threshold (>= 95%)" test
- "has at least the minimum number of active contact-resolution cases" test
- "all evaluated cases pass" test (now only covers contact-resolution cases)
- "prints benchmark summary for CI output" test

**Expected outcome:** `benchmark.test.ts` is deterministic and never calls OpenAI.

---

### Step 12: Slim down `evaluate.test.ts`

**What:** Remove unit tests for `evaluateIntentCase()` and intent-related `evaluateBenchmark()` behavior.

**Files to modify:**
- `services/ai-router/src/benchmark/__tests__/evaluate.test.ts`

**Details:**

Remove:
- The entire `describe("evaluateIntentCase", ...)` block
- The entire `describe("false-positive mutation rate", ...)` block
- Tests that test intent behavior in `evaluateBenchmark`: "skips intent cases when no classifier is provided", "evaluates intent cases when classifier is provided"

Keep:
- `describe("evaluateContactResolutionCase", ...)` -- all tests
- Adapted `describe("evaluateBenchmark", ...)` tests without intent-related assertions

Update retained `evaluateBenchmark` tests to remove the `classifier` parameter.

**Expected outcome:** `evaluate.test.ts` covers only contact-resolution evaluation logic.

---

### Step 13: Update `benchmark/index.ts` barrel exports

**What:** Remove intent-related exports from the benchmark barrel file.

**Files to modify:**
- `services/ai-router/src/benchmark/index.ts`

**Details:**

Remove:
- Export of `evaluateIntentCase`
- Export of `Classifier` type

Keep all other exports.

**Expected outcome:** Clean barrel that exports only contact-resolution evaluation.

---

### Step 14: Migrate applicable tests from `llm-integration.test.ts`

**What:** Move tests from `llm-integration.test.ts` that duplicate promptfoo coverage into the YAML datasets. Keep multi-turn context, prompt injection, and latency tests in Vitest.

**Files to modify:**
- `services/ai-router/src/__tests__/llm-integration/llm-integration.test.ts`
- Potentially add assertions to existing YAML dataset entries

**Tests to migrate (remove from Vitest):**
- "Command Parsing" describe block -- all tests (covered by datasets)
- "Payload Extraction" describe block -- tests (add assertions to write-intent YAML entries)
- "False-Positive Mutation Safety" describe block -- tests (covered by `isMutating` assertions)
- "Out-of-Scope Rejection" describe block -- tests (covered by `guardrails.yaml`)
- "Greeting Handling" describe block -- tests (covered by `guardrails.yaml`)
- "Language Detection" describe block -- tests (add `detectedLanguage` assertions to YAML entries)
- "Structured Output Compliance" describe block -- tests (covered by `is-json` assertions)

**Tests to KEEP in Vitest:**
- "Multi-Turn Context Preservation" -- requires `buildSystemPrompt({ recentTurns })`
- "Clarification & Disambiguation" -- requires conversation history context
- "Confirmation Prompt Quality" -- requires checking `userFacingText` content
- "Active Pending Command Context" -- requires `buildSystemPrompt({ activePendingCommand })`
- "Prompt Injection Resistance" -- security tests, direct assertion control needed
- "Latency" -- latency gate stays in Vitest

**Expected outcome:** `llm-integration.test.ts` reduced from ~34 tests to ~11 tests.

---

### Step 15: Update `vitest.bench.config.ts`

**What:** Ensure the benchmark Vitest config still works for contact-resolution-only tests.

**Files to modify:**
- `services/ai-router/vitest.bench.config.ts`

**Details:**

Review and simplify -- remove `@langchain/openai` alias if the benchmark tests no longer import the classifier. Keep aliases needed for contact-resolution path.

**Expected outcome:** `vitest run --config vitest.bench.config.ts` runs only contact-resolution benchmark tests successfully.

---

### Step 16: Add `.gitignore` entries for promptfoo artifacts

**What:** Ensure promptfoo output files and cache are not committed.

**Files to modify:**
- `services/ai-router/.gitignore` (create or update)

**Details:**

Add:
```
promptfoo/results.json
promptfoo/.promptfoo/
.promptfoo/
```

**Expected outcome:** Git ignores promptfoo temp files and evaluation result output.

---

### Step 17: Verify CI integration end-to-end

**What:** Ensure both CI workflows correctly run the new evaluation pipeline.

**Files to verify:**
- `.github/workflows/ci.yml` -- `pnpm bench:ai` step
- `.github/workflows/llm-smoke.yml` -- `pnpm bench:ai` step

**Details:**

In `ci.yml`: `bench:ai` runs with `sk-fake-ci-key`. Promptfoo `check-thresholds.ts` detects fake key and skips. Only Vitest contact-resolution runs.

In `llm-smoke.yml`: `bench:ai` runs with real key. Both Vitest and promptfoo run.

No workflow YAML changes should be needed.

**Expected outcome:** CI passes with the same semantics as before.

---

## Test Strategy

### Unit Tests (Vitest)

1. **Contact-resolution evaluation (kept as-is):** `evaluate.test.ts` and `benchmark.test.ts` -- deterministic, no mocks needed.
2. **Threshold checker (new):** Unit test `check-thresholds.ts` with mock `results.json` to verify threshold logic. Create `promptfoo/__tests__/check-thresholds.test.ts`.

### TDD Sequence

1. **Step 2 (provider):** Write a failing promptfoo eval with 1 test case. Implement provider. Eval passes.
2. **Steps 3-6 (datasets):** Write YAML datasets with assertions. Run `npx promptfoo eval`.
3. **Step 8 (threshold checker):** Write failing test for threshold logic. Implement. Test passes.
4. **Steps 10-13 (slimming):** Write test calling `evaluateBenchmark(cases)` without classifier. Modify to remove classifier param. Test passes.

### Smoke Test Strategy

No Docker Compose smoke test needed -- promptfoo is a dev-time tool, not a runtime service. Validation:

1. **Local with fake key:** `OPENAI_API_KEY=sk-fake-ci-key pnpm bench` -- Vitest passes, promptfoo skipped. Exit 0.
2. **Local with real key:** `OPENAI_API_KEY=sk-real-key pnpm bench` -- Vitest passes, promptfoo runs 200 cases, thresholds checked. Exit 0.
3. **Vitest unit tests:** `pnpm test --filter @monica-companion/ai-router` -- all pass.

## Security Considerations

1. **API key handling:** Provider reads `OPENAI_API_KEY` from env. Must NOT be logged, hardcoded, or in YAML files.
2. **PII in datasets:** YAML fixtures contain synthetic utterance text only. Carry "ALL DATA IS SYNTHETIC" header.
3. **Output redaction:** `promptfoo/results.json` is gitignored. Not uploaded to CI artifacts.
4. **No production impact:** Promptfoo is a dev dependency only, excluded from tsup production builds.

## Risks

1. **promptfoo ESM compatibility:** Project uses ESM. Recent versions support this but must verify with pinned version.
2. **Evaluation JSON format:** `check-thresholds.ts` depends on promptfoo's output structure. Mitigated by pinning exact version.
3. **Dataset maintenance:** YAML is less type-safe than TS. Mitigated by `is-json` assertions and promptfoo's own validation.
4. **Dual test runner:** `pnpm bench:ai` runs both Vitest and promptfoo. `check-thresholds.ts` has proper error handling.
5. **BenchmarkMetrics type:** Still has intent fields. Set to 0 in Vitest path. Clean up in follow-up.
