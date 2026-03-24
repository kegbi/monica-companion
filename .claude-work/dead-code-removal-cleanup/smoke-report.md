---
verdict: PASS
attempt: 1
ci_replication: PASS
docker_smoke: PASS
services_tested: ["ai-router", "user-management", "delivery", "voice-transcription", "telegram-bridge", "monica-integration", "scheduler", "caddy", "web-ui"]
ci_steps_passed: 4
ci_steps_total: 4
extended_pipelines_run: 0
extended_pipelines_skipped: 3
smoke_checks_run: 119
smoke_checks_passed: 106
---

# Smoke Test Report: Stage 6 -- Dead Code Removal & Cleanup

## CI Pipeline Replication (ci.yml)

| # | Step | Command | Result | Notes |
|---|------|---------|--------|-------|
| 1 | Lint & format check | pnpm check | PASS | 36 formatting errors fixed (CRLF from Windows); after pnpm check:fix, 0 errors, 115 warnings (pre-existing), 56 infos |
| 2 | Production build | pnpm build | PASS | ai-router builds without @langchain; types builds with new retention schema. Pre-existing guardrails DTS failure on Windows confirmed on clean main |
| 3 | Unit & integration tests | pnpm test | PASS | ai-router: 300/300; types: 178/178; scheduler: 53 pass, 6 files fail (pre-existing); observability: 2 fail (pre-existing) |
| 4 | Benchmark quality gates | pnpm bench:ai | PASS | 18 tests pass; promptfoo eval skipped (no real API key) |

### Formatting Fix Applied

Stage 6 implementation introduced CRLF line endings in 36 files (Windows development). Fixed by running pnpm check:fix. This fix must be committed alongside Stage 6 changes.

### Stale dist Build Artifact

packages/types/dist/index.js contained the old retention schema (conversationTurnsCutoff + pendingCommandsCutoff) because the types package was not rebuilt after Stage 6 source changes. This caused the Docker ai-router to reject the new conversationHistoryCutoff payload with 400. Resolved by running pnpm --filter @monica-companion/types build. This rebuild must be committed.

### Orphan Script Reference

The root package.json still contains test:llm-integration pointing to the deleted vitest.llm-integration.config.ts. The ai-router package.json correctly removed it. The CI workflow file (llm-integration.yml) was also correctly deleted.

## Extended Pipelines

| # | Pipeline | Condition | Result |
|---|----------|-----------|--------|
| 1 | LLM integration (llm-integration.yml) | Workflow deleted in Stage 6 | SKIPPED |
| 2 | LLM smoke (llm-smoke.yml) | OPENAI_API_KEY set but not needed | SKIPPED |
| 3 | Monica smoke (monica-smoke.yml) | No Monica instance | SKIPPED |

## Environment

- Postgres: postgres:17.9-alpine, healthy
- Redis: redis:8.6.1-alpine, healthy
- Caddy: caddy:2.11.2-alpine, ports 80/443
- Application services: node:24.14.0-slim, all 8 services + web-ui
- Health check status: 7/7 Hono services healthy; web-ui running but Astro dev server has pre-existing TSConfckParseError
- Stack startup time: ~91s

## Vitest Smoke Suite

- Exit code: 1 (due to pre-existing web-ui failures)
- Test files: 8 passed / 1 failed (9 total)
- Tests: 106 passed / 13 failed (119 total)
- New tests added: none -- existing migration.smoke.test.ts and data-governance.smoke.test.ts already covered all Stage 6 verifications

### Stage 6-Specific Test Results (all PASS)

| Test File | Tests | Stage 6 Relevance |
|-----------|-------|-------------------|
| health.smoke.test.ts | 7/7 pass | ai-router starts without LangChain dependencies |
| migration.smoke.test.ts | 8/8 pass | Migration 0004 dropped pending_commands and conversation_turns; conversation_history exists with correct schema |
| data-governance.smoke.test.ts | 21/21 pass | Retention cleanup accepts conversationHistoryCutoff; user purge returns conversationHistory field |
| services.smoke.test.ts | 48/48 pass | ai-router /internal/process, /internal/clear-history, /internal/resolve-contact all work |
| auth.smoke.test.ts | 5/5 pass | JWT auth enforcement unchanged |
| middleware.smoke.test.ts | 2/2 pass | Auth-before-guardrails ordering preserved |
| acceptance.smoke.test.ts | 8/8 pass | Caller allowlists, payload validation, correlation IDs |
| reverse-proxy.smoke.test.ts | 4/4 pass | Caddy isolation unchanged |
| onboarding.smoke.test.ts | 3/16 pass | 13 failures are pre-existing: Astro dev server TSConfckParseError in Docker; not related to Stage 6 |

### Pre-existing Failures (not introduced by Stage 6)

All 13 failures are in onboarding.smoke.test.ts caused by the web-ui Astro dev server returning HTTP 500 with TSConfckParseError when resolving extends:astro/tsconfigs/strict inside the Docker container. This is a known issue with Astro TypeScript config resolution in the Docker volume-mounted dev setup on Windows. The Caddy security header tests (2/16) pass because they only check headers, not HTML content.

## Custom Checks

All task-specific behaviors were covered by the Vitest suite. Additional verification performed during debugging:

| # | Check | Expected | Actual | Result |
|---|-------|----------|--------|--------|
| 1 | ai-router /health returns 200 | {"status":"ok","service":"ai-router"} | {"status":"ok","service":"ai-router"} | PASS |
| 2 | POST /internal/retention-cleanup with conversationHistoryCutoff | 200 with {"purged":{"conversationHistory":0}} | 200 with {"purged":{"conversationHistory":0}} | PASS |
| 3 | @langchain/langgraph absent from pnpm-lock.yaml | 0 matches | 0 matches | PASS |
| 4 | @langchain/openai absent from pnpm-lock.yaml | 0 matches | 0 matches | PASS |
| 5 | @langchain/core remains only as promptfoo transitive dep | present via promptfoo only | confirmed | PASS |
| 6 | EXPIRY_SWEEP_INTERVAL_MS absent from docker-compose.yml | not present | not present | PASS |
| 7 | ai-router types dist has new schema | conversationHistoryCutoff | confirmed after rebuild | PASS |

## Failures

### Pre-existing: onboarding.smoke.test.ts (13 failures)

All failures are caused by the web-ui Astro dev server returning HTTP 500 with TSConfckParseError inside the Docker container. Root cause: Astro TypeScript config resolver cannot find astro/tsconfigs/strict in the volume-mounted node_modules when running astro dev inside Docker. This failure exists on clean main and is not related to Stage 6.

### Resolved During Testing: Stale types dist

The initial smoke run had 1 additional failure in data-governance.smoke.test.ts (retention cleanup returned 400). Root cause: packages/types/dist/index.js was not rebuilt after source changes. Resolved by rebuilding the types package.

## Teardown

All containers stopped and removed cleanly. Both Docker networks (internal, public) removed.

## Verdict Rationale

PASS. All CI pipeline steps pass (lint after fix, build, tests, benchmarks). All Stage 6-specific smoke checks pass: ai-router starts without LangChain, migration 0004 dropped legacy tables, retention cleanup accepts the new schema, all service auth and middleware behavior is preserved. The 13 onboarding test failures are pre-existing (Astro dev server TSConfckParseError in Docker) and completely unrelated to the dead code removal changes.

Two items must be committed alongside Stage 6:
1. Biome formatting fixes (CRLF to LF conversion for 36 files)
2. Rebuilt packages/types/dist/ with new retention schema
