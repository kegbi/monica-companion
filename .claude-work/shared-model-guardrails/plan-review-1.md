---
verdict: REJECTED
attempt: 1
critical_count: 0
high_count: 1
medium_count: 3
low_count: 4
---

# Plan Review: Shared-Model Guardrails

## Findings

### CRITICAL
(none)

### HIGH

1. [HIGH] **voice-transcription lacks auth infrastructure required by guardrail middleware** -- The guardrail middleware (Step 8) extracts `userId` from Hono context set by `serviceAuth`. However, `voice-transcription` has zero auth infrastructure: no `@monica-companion/auth` dependency, no `serviceAuth` middleware, no `JWT_SECRET` env vars. Step 13 does not add these prerequisites. At runtime, the guardrail middleware would receive undefined for userId, causing per-user rate limiting to either throw or collapse all users into a single bucket. -- **Fix:** Either add auth as a prerequisite in Step 13, or defer voice-transcription guardrails to Phase 4 and scope this task to ai-router only.

### MEDIUM

1. [MEDIUM] **Budget tracker inflates spend counter on rejected requests** -- `recordAndCheckBudget` using atomic `INCRBY` means every rejected request (after budget exhaustion) still increments the counter, inflating it indefinitely. -- **Fix:** GET first; if already exhausted, reject without incrementing. Only INCRBY if pre-check passes.

2. [MEDIUM] **OTel metrics module ordering conflicts with TDD sequences** -- Steps 4-7 TDD sequences include OTel metric tests, but Step 14 creates the metrics module. Tests can't compile against a non-existent module. -- **Fix:** Move metrics interface/stub before Step 4, or revise Steps 4-7 to use local mock/spy.

3. [MEDIUM] **Missing TDD test case for Redis failure in middleware** -- The plan describes fail-closed behavior but Step 8's TDD sequence doesn't test Redis failure. -- **Fix:** Add test: "request returns 503 with `service_degraded` when Redis is unreachable."

### LOW

1. [LOW] **Guardrails package.json missing `hono` dependency** -- Step 8 creates Hono middleware but Step 1 doesn't list `hono` as a dependency. -- **Fix:** Add `hono` to Step 1 dependency list.

2. [LOW] **Concurrency gate `requestId` source unspecified in middleware** -- `acquireConcurrency` requires `requestId` but middleware options don't specify its source. -- **Fix:** Note that middleware uses `getCorrelationId(c)` or generates `crypto.randomUUID()`.

3. [LOW] **Step ordering: error contract types after middleware** -- Step 9 defines error types but Step 8 already uses them. -- **Fix:** Move Step 9 before Step 8.

4. [LOW] **"Request-size limits" terminology mismatch** -- Roadmap says "request-size limits" but plan implements rate limits (requests per window), which is different. -- **Fix:** Acknowledge in Scope section that "request-size limits" is implemented as rate limits + budget tracking.

## Verdict Rationale

REJECTED. The HIGH finding is a design-level gap: voice-transcription has no auth infrastructure and the plan doesn't add it, but the guardrail middleware requires authenticated userId. The plan must either add auth to voice-transcription or defer its guardrails to Phase 4.
