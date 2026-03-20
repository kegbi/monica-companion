---
verdict: PASS
services_tested: ["ai-router", "postgres", "redis"]
checks_run: 8
checks_passed: 8
---

# Smoke Test Report: Benchmark Expansion to Release Threshold

## Environment
- Services started: ai-router (node:24.14.0-slim), postgres (17.9-alpine), redis (8.6.1-alpine), user-management, monica-integration (transitive deps)
- Health check status: all healthy (postgres healthy, redis healthy, ai-router /health returned {"status":"ok","service":"ai-router"})
- Stack startup time: ~60s (including deps-init pnpm install)

## Note on Initial Failure

On the first test run, 2 tests failed because the `@monica-companion/types` package `dist/index.js` was stale -- it did not contain the newly added `out_of_scope` and `greeting` enum values in `BenchmarkCaseCategory`. Rebuilding the types package inside the container (`npx tsup` in `/app/packages/types`) resolved this. This is a build-order concern: when `deps-init` runs `pnpm install --frozen-lockfile`, it does not rebuild workspace packages. The source code is correct; the compiled dist was outdated. After rebuilding, all tests passed.

## Vitest Smoke Suite (In-Container)

### fixtures.test.ts
- Exit code: 0
- Tests: 29 passed / 29 total

### evaluate.test.ts
- Exit code: 0
- Tests: 24 passed / 24 total

### Full benchmark suite (fixtures + evaluate + benchmark quality gates)
- Exit code: 0
- Test files: 3 passed / 3 total
- Tests: 60 passed / 60 total

## Custom Checks

| # | Check | Expected | Actual | Result |
|---|-------|----------|--------|--------|
| 1 | ai-router /health returns OK | {"status":"ok","service":"ai-router"} | {"status":"ok","service":"ai-router"} | PASS |
| 2 | Write intent cases count | >= 100 | 100 | PASS |
| 3 | Read intent cases count | >= 60 | 60 | PASS |
| 4 | Clarification cases count | >= 25 | 25 | PASS |
| 5 | Out-of-scope cases count | >= 10 | 10 | PASS |
| 6 | Greeting cases count | >= 5 | 5 | PASS |
| 7 | Total intent cases | >= 200 | 200 | PASS |
| 8 | Voice samples | >= 50 | 59 | PASS |

## Benchmark Quality Gate Output (from benchmark.test.ts)

```
=== Benchmark Quality Gates Report ===
Timestamp: 2026-03-20T06:04:33.174Z

--- Metrics ---
Contact Resolution Precision: 100.0%
Read Accuracy:                0.0%  (no real OPENAI_API_KEY -- intent cases skipped)
Write Accuracy:               0.0%  (no real OPENAI_API_KEY -- intent cases skipped)
False Positive Mutation Rate:  0.0%

--- Case Counts ---
Total:   245
Active:  245
Pending: 0
Passed:  45  (contact resolution only, intent cases skipped without real API key)
Failed:  0

=== End Report ===
```

## Failures

None. All checks passed.

## Teardown

All services stopped cleanly:
- ai-router, monica-integration, user-management, redis, postgres, deps-init containers removed
- internal network removed
