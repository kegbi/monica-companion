# Implementation Plan: Benchmark & Quality Gates

## Objective

Build a labeled benchmark evaluation framework that measures the accuracy of intent classification, contact resolution, and mutation safety across a curated set of test utterances. The framework will:

1. Define a structured benchmark dataset of at least 200 labeled utterances (100 write intents, 60 read/query intents, 40 clarification/disambiguation turns).
2. Provide an evaluation runner that executes the benchmark against the system's classification and resolution logic, producing metric scores.
3. Track five metrics: read accuracy, write accuracy, contact-resolution precision, false-positive mutation rate, and p95 latency.
4. Add a CI gate that blocks releases when any metric falls below the threshold defined in `acceptance-criteria.md`.

This work establishes the quality infrastructure. The benchmark set starts with contact-resolution cases (the deterministic matcher already exists) and intent classification stubs (to be filled as the LangGraph pipeline is built in later phases). The framework is designed so that adding LLM-evaluated cases later requires only new fixtures, not structural changes.

## Scope

### In Scope

- A benchmark data format (TypeScript types + Zod schemas) for labeled test cases covering: write intents, read intents, clarification turns, and contact-resolution queries.
- A curated initial fixture set stored in the repository under `services/ai-router/src/benchmark/`.
- Contact-resolution benchmark cases that run today against the existing deterministic matcher.
- Intent-classification and end-to-end benchmark case types that are structurally complete but marked as `pending` until the LangGraph pipeline exists, so the runner can report them separately.
- An evaluation runner (`evaluate.ts`) that loads fixtures, runs the relevant function under test, compares against expected labels, and computes aggregate metrics.
- A Vitest test file (`benchmark.test.ts`) that runs the evaluation runner and asserts the acceptance-criteria thresholds.
- A `pnpm bench:ai` root script and a `bench` script in `ai-router` to run the benchmark suite independently of unit tests.
- A CI workflow step that runs the benchmark and fails the build if thresholds are not met.
- Documentation of the benchmark data format and how to add new cases.

### Out of Scope

- Building the LLM/LangGraph intent classification pipeline (Phase 3: Shared-Model Guardrails and Phase 4 tasks).
- Voice sample evaluation (requires the voice-transcription pipeline, which is Phase 4). The fixture schema includes a `voiceSamplePath` field for future use, but voice cases will be `pending` until the transcription service exists.
- Real OpenAI API calls during benchmark runs. All benchmark cases in V1 test deterministic logic (contact matcher, resolver). LLM-dependent cases will use a mock LLM adapter in the benchmark runner when the pipeline is built.
- Performance/latency benchmarking against a live stack (latency is measured during smoke tests, not during the unit-level benchmark suite). The framework records timing metadata but does not enforce latency thresholds in the unit benchmark -- those belong to the staging environment smoke tests.
- Changes to the contact matcher or resolver logic itself. This plan only builds the evaluation framework around the existing logic.

## Affected Services & Packages

| Package/Service | Changes |
|-----------------|---------|
| `services/ai-router` | New `src/benchmark/` directory with fixture types, dataset, evaluation runner, and test file. New `bench` script in `package.json`. |
| `packages/types` | New `BenchmarkCase` and `BenchmarkMetrics` Zod schemas in a new `src/benchmark.ts` module. |
| Root `package.json` | New `bench:ai` script. |
| `.github/workflows/ci.yml` | New step to run `pnpm bench:ai` and fail on threshold violations. |

## Implementation Steps

### Step 1: Define benchmark case and metrics schemas in `@monica-companion/types`

**What:** Create Zod schemas that define the structure of a benchmark test case and the aggregate metrics output. These schemas are shared types so that the benchmark data format is validated and reusable.

**Files to create:**
- `packages/types/src/benchmark.ts`

**Files to modify:**
- `packages/types/src/index.ts` -- export new schemas

**Schema design:**

```
BenchmarkCaseCategory: enum ["write_intent", "read_intent", "clarification", "contact_resolution"]

BenchmarkCaseStatus: enum ["active", "pending"]
  -- "active" cases are evaluated and counted in metrics.
  -- "pending" cases are skipped with a note (e.g., "awaits LangGraph pipeline").

ContactResolutionBenchmarkCase:
  id: string (unique identifier, e.g. "cr-001")
  category: literal "contact_resolution"
  status: BenchmarkCaseStatus
  description: string (human-readable description of the scenario)
  input:
    query: string (the natural-language contact reference)
    contacts: ContactResolutionSummary[] (the simulated contact list)
  expected:
    outcome: ResolutionOutcome ("resolved" | "ambiguous" | "no_match")
    resolvedContactId: number | null (expected contactId when resolved)
    candidateContactIds: number[] (expected candidate IDs when ambiguous, order-sensitive)

IntentBenchmarkCase:
  id: string
  category: "write_intent" | "read_intent" | "clarification"
  status: BenchmarkCaseStatus
  description: string
  input:
    utterance: string (the user's text input)
    voiceSamplePath: string | null (relative path to audio file, null for text-only)
    contactContext: ContactResolutionSummary[] (simulated contacts for resolution)
  expected:
    commandType: string | null (expected CommandType from the types package, null for clarification)
    contactRef: string | null (expected contact reference extracted from utterance)
    resolvedContactId: number | null
    isMutating: boolean

BenchmarkCase: discriminated union of ContactResolutionBenchmarkCase | IntentBenchmarkCase

BenchmarkMetrics:
  readAccuracy: number (0.0 to 1.0)
  writeAccuracy: number (0.0 to 1.0)
  contactResolutionPrecision: number (0.0 to 1.0)
  falsePositiveMutationRate: number (0.0 to 1.0)
  totalCases: number
  activeCases: number
  pendingCases: number
  passedCases: number
  failedCases: number
  caseResults: array of { id, passed, actual, expected, error? }
```

**TDD sequence:**
1. Write failing tests for `ContactResolutionBenchmarkCase.safeParse()` with valid and invalid inputs.
2. Write failing tests for `IntentBenchmarkCase.safeParse()` with valid and invalid inputs.
3. Write failing tests for `BenchmarkMetrics.safeParse()`.
4. Implement the schemas.
5. Verify tests pass.

### Step 2: Create the contact-resolution benchmark fixture dataset

**What:** Build the initial set of labeled contact-resolution test cases. These exercise the existing deterministic matcher against a variety of scenarios documented in the contact resolution boundary plan and the matcher test suite, but structured as labeled benchmark data rather than hardcoded unit test expectations.

**Files to create:**
- `services/ai-router/src/benchmark/fixtures/contact-resolution.ts` -- exports `ContactResolutionBenchmarkCase[]`

**Dataset design (minimum 40 contact-resolution cases to start):**

The fixture file defines a shared set of simulated contacts (reused across cases) and the individual test cases. Categories include:

| Scenario Group | Count | Examples |
|---|---|---|
| Exact display name match | 5 | "John Doe", "Maria Smith (Mary)" |
| First + last name match | 4 | "John Doe" when display is "John Michael Doe" |
| Relationship label match | 6 | "Mom", "my brother", "wife", "boss" |
| Kinship normalization | 6 | "mama", "sis", "hubby", "coworker", "bff" |
| Single alias/nickname match | 4 | "Johnny" for "John Doe (Johnny)" |
| Prefix match | 3 | "Joh" for "John", "Al" for "Alex" |
| Ambiguous duplicate names | 5 | Two "Sherry"s, two "Alex"es |
| No match | 4 | "Xavier" against a list with no matching contacts |
| Compound queries | 3 | "brother Alex", "Mom Maria" |
| Edge cases | 5+ | Empty query, single char, possessives ("Mom's"), whitespace |

Each case references a shared contacts array or defines its own. Expected outcomes include the resolution outcome, resolved contact ID, or list of candidate IDs for ambiguous cases.

**TDD sequence:**
1. Write a test that loads the fixture file and validates every case against the `ContactResolutionBenchmarkCase` schema.
2. Create the fixture file.
3. Verify all cases parse successfully.

### Step 3: Create the intent classification benchmark fixture stubs

**What:** Define intent classification benchmark cases (write intents, read intents, clarification turns) with `status: "pending"`. These establish the data format and required distribution (100 write, 60 read, 40 clarification) but cannot be evaluated until the LangGraph pipeline exists. A small number of structurally complete examples (5-10 per category) demonstrate the format.

**Files to create:**
- `services/ai-router/src/benchmark/fixtures/write-intents.ts` -- exports `IntentBenchmarkCase[]`
- `services/ai-router/src/benchmark/fixtures/read-intents.ts` -- exports `IntentBenchmarkCase[]`
- `services/ai-router/src/benchmark/fixtures/clarification-turns.ts` -- exports `IntentBenchmarkCase[]`
- `services/ai-router/src/benchmark/fixtures/index.ts` -- barrel export combining all fixtures

**Design:**
- Each file exports an array of `IntentBenchmarkCase` objects.
- Initial cases are `status: "pending"` with the exception of a few `status: "active"` examples that test trivially predictable outcomes (these can be activated once the LLM pipeline is wired up).
- Write intent examples: "Add a note to Mom about her garden project", "Create a contact named Sarah Miller", "Update Alex's birthday to April 12".
- Read intent examples: "What's Sarah's birthday?", "When did I last talk to Mom?", "What's Alex's phone number?"
- Clarification turn examples: "Which Sherry?", "The one from work", "Yes, that's right".
- Each case includes the `contactContext` array so the evaluation runner can simulate the contact resolution environment.

**TDD sequence:**
1. Write a test that loads all fixture files and validates each case against the `IntentBenchmarkCase` schema.
2. Write a test that counts cases per category and asserts the structural distribution targets (at least 10 write, 6 read, 4 clarification stubs exist, even if most are pending).
3. Create the fixture files.
4. Verify tests pass.

### Step 4: Implement the benchmark evaluation runner

**What:** A function that takes the full benchmark dataset, runs each active case against the relevant system function, and computes aggregate metrics. For V1, only contact-resolution cases are active; intent cases are skipped as pending.

**Files to create:**
- `services/ai-router/src/benchmark/evaluate.ts` -- the evaluation runner
- `services/ai-router/src/benchmark/index.ts` -- barrel export

**Design:**

```typescript
interface CaseResult {
  id: string;
  category: BenchmarkCaseCategory;
  passed: boolean;
  expected: unknown;
  actual: unknown;
  error?: string;
  durationMs: number;
}

interface EvaluationReport {
  metrics: BenchmarkMetrics;
  caseResults: CaseResult[];
  timestamp: string;
}

function evaluateBenchmark(cases: BenchmarkCase[]): EvaluationReport
```

The runner:
1. Iterates over all cases. Skips cases with `status: "pending"` (records them in metrics as `pendingCases`).
2. For `contact_resolution` cases: calls `matchContacts()` from the existing matcher, then applies the resolver's threshold logic to determine the outcome. Compares against expected outcome, resolvedContactId, and candidateContactIds.
3. For intent cases (`write_intent`, `read_intent`, `clarification`): calls an `evaluateIntent()` adapter function. In V1, this adapter is a no-op that throws `NotImplemented`. When the LangGraph pipeline is built, the adapter will be replaced.
4. Computes metrics:
   - `contactResolutionPrecision`: (correctly resolved + correctly ambiguous + correctly no_match) / total active contact_resolution cases
   - `readAccuracy`: correctly classified read intents / total active read_intent cases
   - `writeAccuracy`: correctly classified write intents / total active write_intent cases
   - `falsePositiveMutationRate`: cases where the system produced a mutating action when the expected outcome was non-mutating / total active cases
5. Returns the `EvaluationReport`.

The contact resolution evaluation logic is extracted as a pure function:

```typescript
function evaluateContactResolutionCase(
  case: ContactResolutionBenchmarkCase
): CaseResult
```

This calls `matchContacts()` with the case's input query and contacts, then applies the threshold constants from `resolver.ts` to determine outcome, matching exactly what `resolveContact()` would produce (but without the HTTP client call).

**TDD sequence:**
1. Write a failing test: pass a single active contact-resolution case with an exact match, assert the result is `passed: true`.
2. Write a failing test: pass a contact-resolution case where the matcher produces the wrong outcome (e.g., a deliberately misconfigured expected outcome), assert `passed: false`.
3. Write a failing test: pass a mix of active and pending cases, assert that `pendingCases` count is correct and `activeCases` only counts non-pending.
4. Write a failing test: verify metrics computation (contactResolutionPrecision = passed / active).
5. Implement `evaluateContactResolutionCase()`.
6. Implement `evaluateBenchmark()`.
7. Verify all tests pass.

### Step 5: Create the benchmark test file with threshold assertions

**What:** A Vitest test file that loads the full benchmark dataset, runs the evaluation, and asserts that all metrics meet the acceptance-criteria thresholds. This file is what the CI will run.

**Files to create:**
- `services/ai-router/src/benchmark/__tests__/benchmark.test.ts`

**Design:**

```typescript
describe("Benchmark Quality Gates", () => {
  const report = evaluateBenchmark(allCases);

  it("contact-resolution precision meets threshold (>= 95%)", () => {
    expect(report.metrics.contactResolutionPrecision).toBeGreaterThanOrEqual(0.95);
  });

  it("read accuracy meets threshold (>= 92%)", () => {
    // Skip if no active read cases yet
    if (report.metrics.activeCases === 0) return;
    expect(report.metrics.readAccuracy).toBeGreaterThanOrEqual(0.92);
  });

  it("write accuracy meets threshold (>= 90%)", () => {
    // Skip if no active write cases yet
    if (report.metrics.activeCases === 0) return;
    expect(report.metrics.writeAccuracy).toBeGreaterThanOrEqual(0.90);
  });

  it("false-positive mutation rate stays below threshold (< 1%)", () => {
    expect(report.metrics.falsePositiveMutationRate).toBeLessThan(0.01);
  });

  it("has at least the minimum number of active contact-resolution cases", () => {
    const activeCrCases = allCases.filter(
      c => c.category === "contact_resolution" && c.status === "active"
    ).length;
    expect(activeCrCases).toBeGreaterThanOrEqual(40);
  });

  it("all active cases pass", () => {
    const failed = report.caseResults.filter(r => !r.passed);
    // Print failed case IDs for debugging
    expect(failed.map(f => f.id)).toEqual([]);
  });

  it("prints benchmark summary for CI output", () => {
    console.log(formatBenchmarkSummary(report));
  });
});
```

The test file also includes a helper `formatBenchmarkSummary()` that prints a human-readable table of metrics and any failed cases, useful for CI output.

**TDD sequence:**
1. Write the test file that calls `evaluateBenchmark(allCases)`.
2. Run it -- it should fail because the fixtures from Steps 2-3 and the runner from Step 4 need to be wired together.
3. Wire the imports and verify it passes once the fixture set and runner are correct.

### Step 6: Add benchmark scripts to package.json files

**What:** Add npm scripts to run the benchmark suite independently from unit tests.

**Files to modify:**
- `services/ai-router/package.json` -- add `"bench": "vitest run src/benchmark/__tests__/benchmark.test.ts"`
- Root `package.json` -- add `"bench:ai": "pnpm --filter @monica-companion/ai-router bench"`

**Design notes:**
- The benchmark is a Vitest test file, not a separate tool. This keeps the infrastructure simple and reuses the existing Vitest config (including module aliases).
- Running `pnpm bench:ai` at the root executes only the benchmark test, not the full unit test suite.
- The regular `pnpm test` in ai-router does NOT run the benchmark tests (they are in a separate path that must be explicitly invoked). This is achieved by using Vitest's `include` patterns: the default `test` script runs `vitest run` which picks up `**/*.test.ts` but the benchmark test is under `benchmark/__tests__/` and is excluded from the default pattern via the vitest config's `exclude` array.

**TDD sequence:**
1. Add the scripts.
2. Run `pnpm bench:ai` and verify it executes only the benchmark test file.
3. Verify `pnpm test` in ai-router does not run the benchmark test.

### Step 7: Add CI quality gate step

**What:** Add a step to the GitHub Actions CI workflow that runs the benchmark and fails the build if thresholds are not met.

**Files to modify:**
- `.github/workflows/ci.yml` -- add a `Benchmark quality gates` step after the `Test` step.

**Design:**

```yaml
- name: Benchmark quality gates
  run: pnpm bench:ai
```

Since the benchmark is a Vitest test file with `expect()` assertions on the thresholds, a failing metric causes the test to fail, which causes the CI step to fail. No additional scripting is needed.

**Note on threshold enforcement:** The thresholds are hardcoded in the benchmark test file, derived from `acceptance-criteria.md`:
- Read accuracy >= 92%
- Write accuracy >= 90%
- Contact-resolution precision >= 95%
- False-positive mutation rate < 1%

These are constants in the test file, not dynamic config. If acceptance criteria change, the test file is updated to match.

**TDD sequence:**
1. Add the CI step.
2. Verify locally that `pnpm bench:ai` exits 0 when all thresholds are met and exits non-zero when a threshold is violated (by temporarily lowering a threshold constant to force a failure).

### Step 8: Update Vitest config to exclude benchmarks from regular test runs

**What:** Ensure that `vitest run` (the default test command) in ai-router excludes the benchmark test directory, so benchmarks only run when explicitly invoked via `pnpm bench`.

**Files to modify:**
- `services/ai-router/vitest.config.ts` -- add an `exclude` pattern for `**/benchmark/**`

**Design:**

```typescript
test: {
  fileParallelism: false,
  exclude: [
    '**/node_modules/**',
    '**/dist/**',
    '**/benchmark/**',
  ],
},
```

**TDD sequence:**
1. Run `pnpm test` in ai-router and verify the benchmark test does NOT run.
2. Run `pnpm bench` in ai-router and verify the benchmark test DOES run.

## Schema Definitions

### BenchmarkCaseCategory (in `packages/types/src/benchmark.ts`)

```typescript
export const BenchmarkCaseCategory = z.enum([
  "write_intent",
  "read_intent",
  "clarification",
  "contact_resolution",
]);
```

### BenchmarkCaseStatus (in `packages/types/src/benchmark.ts`)

```typescript
export const BenchmarkCaseStatus = z.enum(["active", "pending"]);
```

### ContactResolutionBenchmarkCase (in `packages/types/src/benchmark.ts`)

```typescript
export const ContactResolutionBenchmarkCase = z.object({
  id: z.string().min(1),
  category: z.literal("contact_resolution"),
  status: BenchmarkCaseStatus,
  description: z.string(),
  input: z.object({
    query: z.string(),
    contacts: z.array(ContactResolutionSummary),
  }),
  expected: z.object({
    outcome: ResolutionOutcome,
    resolvedContactId: z.number().int().nullable(),
    candidateContactIds: z.array(z.number().int()),
  }),
});
```

### IntentBenchmarkCase (in `packages/types/src/benchmark.ts`)

```typescript
export const IntentBenchmarkCase = z.object({
  id: z.string().min(1),
  category: z.enum(["write_intent", "read_intent", "clarification"]),
  status: BenchmarkCaseStatus,
  description: z.string(),
  input: z.object({
    utterance: z.string(),
    voiceSamplePath: z.string().nullable(),
    contactContext: z.array(ContactResolutionSummary),
  }),
  expected: z.object({
    commandType: z.string().nullable(),
    contactRef: z.string().nullable(),
    resolvedContactId: z.number().int().nullable(),
    isMutating: z.boolean(),
  }),
});
```

### BenchmarkCase (in `packages/types/src/benchmark.ts`)

```typescript
// z.union (not z.discriminatedUnion) because IntentBenchmarkCase covers three category values
export const BenchmarkCase = z.union([
  ContactResolutionBenchmarkCase,
  IntentBenchmarkCase,
]);
```

### BenchmarkMetrics (in `packages/types/src/benchmark.ts`)

```typescript
export const BenchmarkMetrics = z.object({
  readAccuracy: z.number().min(0).max(1),
  writeAccuracy: z.number().min(0).max(1),
  contactResolutionPrecision: z.number().min(0).max(1),
  falsePositiveMutationRate: z.number().min(0).max(1),
  totalCases: z.number().int().nonnegative(),
  activeCases: z.number().int().nonnegative(),
  pendingCases: z.number().int().nonnegative(),
  passedCases: z.number().int().nonnegative(),
  failedCases: z.number().int().nonnegative(),
});
```

## Test Strategy

### Unit Tests (Vitest)

| Module | What to test | Mocking |
|---|---|---|
| `packages/types/src/benchmark.ts` | Valid/invalid parsing of all benchmark schemas | None |
| `services/ai-router/src/benchmark/fixtures/*.ts` | All fixtures parse against their schema; count distribution matches targets | None |
| `services/ai-router/src/benchmark/evaluate.ts` | Single case evaluation (pass/fail), multi-case metrics computation, pending case skipping, empty dataset handling | None (pure functions using the existing matcher) |
| `services/ai-router/src/benchmark/__tests__/benchmark.test.ts` | Threshold assertions against the full fixture set | None |

### Integration Tests

None required. The benchmark framework operates entirely on in-memory fixtures and pure functions (the contact matcher). No database, Redis, or external services are involved.

### TDD Sequence (ordered across all steps)

1. **Schema tests** (Step 1): Failing tests for `ContactResolutionBenchmarkCase`, `IntentBenchmarkCase`, `BenchmarkMetrics` parsing.
2. **Fixture validation tests** (Step 2): Failing test that all contact-resolution fixtures parse correctly.
3. **Fixture distribution tests** (Step 3): Failing test that intent fixtures exist and parse correctly.
4. **Evaluation runner tests** (Step 4): Failing test for single-case evaluation, then multi-case metrics.
5. **Threshold assertion test** (Step 5): The benchmark test file runs and passes when all fixtures and the runner are wired up.

## Smoke Test Strategy

### Services to start

```bash
docker compose --profile app up -d ai-router postgres redis
```

### HTTP checks

1. **Health check ai-router:**
   ```bash
   curl -s http://localhost:3002/health | jq .status
   # Expected: "ok"
   ```

2. **Verify benchmark does not interfere with normal operation:**
   The benchmark is a build-time test, not a runtime component. The smoke test verifies that ai-router starts normally and its health endpoint responds, confirming that the benchmark module does not introduce import-time side effects or break the service.

### What the smoke test proves

- The benchmark module's fixture imports and evaluation logic do not affect service startup or runtime behavior.
- ai-router continues to serve its existing endpoints correctly after the benchmark code is added.
- The benchmark is a test-time artifact only.

### Teardown

```bash
docker compose --profile app down
```

## Security Considerations

1. **No secrets in fixtures:** Benchmark fixtures contain only synthetic contact data (names, relationship labels, dates). No real user data, API keys, or credentials appear in fixture files. Per `security.md`, sensitive data must never appear in logs or test artifacts.

2. **No PII in CI output:** The benchmark summary printed to CI logs includes case IDs, scores, and metric percentages. It does not include contact names or utterance text from fixtures. The `formatBenchmarkSummary()` function must omit PII-bearing fields.

3. **Fixture data is synthetic:** All contact names, relationships, and dates in the benchmark fixtures are fabricated test data. No real Monica user data is referenced.

4. **No network calls during benchmark runs:** The benchmark framework calls only pure in-process functions (the matcher). It does not make HTTP requests to monica-integration, OpenAI, or any external service. This eliminates credential exposure risk during benchmark execution.

5. **Benchmark code is test-only:** The benchmark module is under `src/benchmark/` and excluded from the production build via `tsup` entry point configuration. It is never deployed.

## Risks & Open Questions

1. **Intent classification cases are pending until LangGraph exists.** The benchmark framework includes structurally complete intent cases with `status: "pending"`, but they cannot be evaluated until the LLM pipeline is built. The metrics for `readAccuracy` and `writeAccuracy` will report 0/0 (not counted) until then. The CI gate gracefully handles this by skipping threshold assertions when there are no active cases for a metric category. **Risk:** The full 200-case benchmark requirement from `acceptance-criteria.md` cannot be met until the LLM pipeline exists. The contact-resolution subset (40+ cases) is sufficient for V1 of the benchmark framework.

2. **Voice samples are deferred.** The acceptance criteria require "at least 50 voice samples." Voice evaluation requires the voice-transcription service, which is a Phase 4 deliverable. The `voiceSamplePath` field is defined in the schema but voice cases will be `pending`. **Mitigation:** The framework is forward-compatible; adding voice cases later only requires audio files and setting `status: "active"`.

3. **Latency measurement is not in-scope for the unit-level benchmark.** The acceptance criteria include p95 latency thresholds (5s text, 12s voice). These require a running stack with real network latency and are properly measured during staging smoke tests, not during unit-level benchmark evaluation. The benchmark runner records `durationMs` per case for profiling, but does not assert latency thresholds. **Open question:** Should a separate latency benchmark against the live Docker stack be added later?

4. **Threshold constants are duplicated.** The acceptance-criteria thresholds (92%, 90%, 95%, 1%) appear both in `acceptance-criteria.md` and in the benchmark test file. If the product criteria change, both must be updated. **Mitigation:** The test file includes a comment referencing `acceptance-criteria.md` as the source of truth. A more sophisticated approach (reading the thresholds from a config file) is not warranted for V1.

5. **False-positive mutation rate is hard to measure without the LLM pipeline.** The false-positive mutation rate requires the system to produce a mutation when the expected outcome is non-mutating. Since intent classification is pending, this metric will be 0/0 (not counted) until LLM cases are active. The contact-resolution benchmark can partially test this: a case where the expected outcome is "no_match" but the matcher incorrectly returns "resolved" would count as a false positive, though this is more about resolution precision than mutation safety. **Mitigation:** Track the metric structurally from the start. It becomes meaningful once intent cases are active.

6. **Benchmark dataset growth.** The initial 40+ contact-resolution cases are a floor. As bugs are found and edge cases discovered, new cases should be added. The framework supports this without structural changes -- just add entries to the fixture arrays. **Recommendation:** Document a convention that any contact-resolution bug fix must include a new benchmark case that reproduces the bug.

