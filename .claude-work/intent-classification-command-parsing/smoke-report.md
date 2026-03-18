---
verdict: SKIP
reason: environment-limitation
---

# Smoke Test Report: Intent Classification & Command Parsing

## Environment Limitation

Smoke tests cannot run in this environment due to two infrastructure constraints:

1. **Docker image pulls blocked**: The egress proxy blocks blob downloads from Docker Hub's CDN (Cloudflare R2 storage), preventing any Docker containers from being built or started.
2. **No OPENAI_API_KEY available**: Smoke tests require real OpenAI API calls to verify intent classification, language detection, and out-of-scope rejection.

## What Was Verified Instead

- **Biome check**: 0 errors on 225 source files (PASS)
- **Unit tests**: 178 tests pass, 22 skipped (pre-existing integration tests needing PostgreSQL), 0 failures (PASS)
- **LLM mocking**: All graph tests use mocked LLM responses covering all 5 intent types, error handling, and callback action passthrough

## Tests That Would Run in Smoke

1. Health check returns OK
2. Text message → intent classification with real LLM
3. French message → French response (language detection)
4. Out-of-scope message → polite decline
5. Service auth rejection without JWT

## Verdict

SKIP — environment limitation, not a code defect. All unit-level verification passes.
