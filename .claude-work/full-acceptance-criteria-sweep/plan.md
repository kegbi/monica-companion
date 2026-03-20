# Implementation Plan: Full Acceptance Criteria Sweep

## Objective

Run the complete 65-item acceptance-criteria checklist from `context/product/acceptance-criteria.md` against the live Docker Compose stack. Produce a V1 release readiness report with verification results for every criterion, document any deferred items with rationale, and mark the final roadmap item as complete.

This is the **last task** in the roadmap. All Phases 1-7 are complete. This task is primarily a verification and documentation exercise, with targeted implementation only where gaps are discovered.

## Scope

### In Scope
- Systematic verification of all 65 acceptance criteria across 10 sections
- A comprehensive acceptance smoke test file (`tests/smoke/acceptance.smoke.test.ts`) that validates automatable criteria against the live Docker Compose stack
- A criteria-by-criteria audit matrix documenting how each criterion is verified (automated test, code inspection, existing test, or documentation review)
- Small targeted fixes if any criteria are found to not be met
- A V1 release readiness report at `context/product/v1-release-readiness-report.md`
- Updating `context/product/roadmap.md` to mark the final item complete

### Out of Scope
- New feature implementation beyond what is needed to close acceptance gaps
- Performance optimization (latency validation was completed in Phase 7)
- Real-Monica smoke suite execution (it exists and is a separate gated process)
- LLM benchmark re-execution (benchmark infrastructure and thresholds exist from Phase 6/7)
- Operational review findings population (template exists, measurements are environment-dependent)

## Affected Services & Packages

| Package/Service | Changes |
|-----------------|---------|
| `tests/smoke/` | New `acceptance.smoke.test.ts` for comprehensive criteria validation |
| `tests/smoke/smoke-config.ts` | Add `TELEGRAM_BRIDGE_URL` and `MONICA_INTEGRATION_URL` for full coverage |
| `tests/smoke/health.smoke.test.ts` | Expand to all 7 Hono services |
| `docker-compose.smoke.yml` | Expose telegram-bridge and monica-integration ports |
| `context/product/` | New `v1-release-readiness-report.md` |
| `context/product/roadmap.md` | Mark final item `[x]` |

## Pre-Implementation: Criteria Audit Matrix

Before writing any code, each acceptance criterion must be classified into one of four verification methods:

1. **AUTOMATED** — Can be verified by an HTTP request against the live Docker Compose stack (new smoke test)
2. **EXISTING-TEST** — Already verified by an existing smoke test, unit test, or integration test (cite the file)
3. **CODE-INSPECTION** — Must be verified by reviewing source code (cite files reviewed)
4. **DOCUMENTATION** — Verified by reviewing documentation or configuration files (cite the doc)

### Section 1: Core Functionality (12 criteria)

| # | Criterion | Method | Evidence |
|---|-----------|--------|----------|
| CF-1 | Voice message transcribe/parse/execute | EXISTING-TEST | `services/ai-router/src/__smoke__/command-parsing.smoke.test.ts`, `services/ai-router/src/__smoke__/latency-voice.smoke.test.ts` |
| CF-2 | Text message same result | EXISTING-TEST | `services/ai-router/src/__smoke__/command-parsing.smoke.test.ts` (all tests use text), `tests/smoke/services.smoke.test.ts` |
| CF-3 | Multi-language support | CODE-INSPECTION | `services/ai-router/src/graph/system-prompt.ts` (language detection directive), `services/voice-transcription/src/` (no language restriction on gpt-4o-transcribe) |
| CF-4 | 200+ benchmark utterances | EXISTING-TEST | `services/ai-router/src/benchmark/__tests__/fixtures.test.ts` line 174: asserts >= 200 total, line 184: >= 50 voice samples |
| CF-5 | Read accuracy >= 92% | CODE-INSPECTION + EXISTING-TEST | `services/ai-router/src/benchmark/evaluate.ts` computes `readAccuracy`, `services/ai-router/src/benchmark/__tests__/evaluate.test.ts` gates on thresholds |
| CF-6 | Write accuracy >= 90% | CODE-INSPECTION + EXISTING-TEST | Same as CF-5, `writeAccuracy` metric |
| CF-7 | Contact resolution precision >= 95% | CODE-INSPECTION + EXISTING-TEST | Same as CF-5, `contactResolutionPrecision` metric |
| CF-8 | False-positive mutation < 1% | CODE-INSPECTION + EXISTING-TEST | `services/ai-router/src/benchmark/evaluate.ts` `falsePositiveMutationRate` |
| CF-9 | p95 latency text <= 5s, voice <= 12s | EXISTING-TEST | `services/ai-router/src/__smoke__/latency-text.smoke.test.ts`, `latency-voice.smoke.test.ts` |
| CF-10 | Disambiguation inline keyboard buttons | CODE-INSPECTION | `services/ai-router/src/graph/nodes/format-response.ts` (options field), `services/telegram-bridge/src/bot/__tests__/outbound-renderer.test.ts` |
| CF-11 | Supported operations (create contact, note, activity, updates, lookups) | EXISTING-TEST | `services/ai-router/src/__smoke__/command-parsing.smoke.test.ts` covers all V1 command types |
| CF-12 | Typing indicators | CODE-INSPECTION | `services/telegram-bridge/src/bot/handlers/text-message.ts` (sendChatAction typing), same in voice-message.ts and callback-query.ts |

### Section 2: Command Lifecycle (6 criteria)

| # | Criterion | Method | Evidence |
|---|-----------|--------|----------|
| CL-1 | pendingCommandId, version, sourceRef, TTL | EXISTING-TEST | `services/ai-router/src/pending-command/__tests__/repository.integration.test.ts`, `state-machine.test.ts` |
| CL-2 | Lifecycle transitions | EXISTING-TEST | `services/ai-router/src/pending-command/__tests__/state-machine.test.ts` |
| CL-3 | Follow-ups attach to active pending command | EXISTING-TEST + EXISTING-SMOKE | `services/ai-router/src/__smoke__/dialog-clarification.smoke.test.ts` |
| CL-4 | Stale/expired rejection | EXISTING-TEST | `services/ai-router/src/pending-command/__tests__/confirm.test.ts` |
| CL-5 | Scheduler accepts only confirmed commands | EXISTING-TEST | `services/scheduler/src/__tests__/execute.test.ts`, `command-worker.test.ts` |
| CL-6 | Read-only bypasses scheduler | EXISTING-TEST | `services/ai-router/src/__smoke__/command-parsing.smoke.test.ts` (query tests return type "text") |

### Section 3: Onboarding & Multi-User (9 criteria)

| # | Criterion | Method | Evidence |
|---|-----------|--------|----------|
| OM-1 | 15-minute one-time setup link | AUTOMATED + EXISTING-TEST | `tests/smoke/services.smoke.test.ts` |
| OM-2 | One active setup link, signed, bound, consumed, invalidated, rejected | EXISTING-TEST | `services/user-management/src/setup-token/__tests__/repository.integration.test.ts` |
| OM-3 | CSRF/origin checks | EXISTING-TEST | `services/web-ui/src/lib/__tests__/csrf.test.ts` |
| OM-4 | Credentials never through Telegram | CODE-INSPECTION | No credential collection in telegram-bridge handlers |
| OM-5 | Monica base URLs normalized canonically | EXISTING-TEST | `services/monica-integration/src/__tests__/config.test.ts` |
| OM-6 | Reject http://, localhost, RFC1918, link-local | EXISTING-TEST | `services/monica-integration/src/__tests__/app.test.ts` |
| OM-7 | Multi-user independent operation | CODE-INSPECTION | Per-user database rows, userId in JWT subject |
| OM-8 | User data isolation | CODE-INSPECTION | All queries include userId filter |
| OM-9 | IANA timezone selection during onboarding | **GAP-CANDIDATE** | Web-ui form may not collect timezone yet; database schema supports it |

### Section 4: Scheduled Reminders (9 criteria)

| # | Criterion | Method | Evidence |
|---|-----------|--------|----------|
| SR-1 | Daily/weekly event summary at chosen local time | EXISTING-TEST | `services/scheduler/src/__tests__/reminder-poller.test.ts` |
| SR-2 | Reminder digests delivered on schedule | EXISTING-TEST | `services/scheduler/src/__tests__/reminder-executor.test.ts` |
| SR-3 | Dedupe key prevents duplicates | EXISTING-TEST | `services/scheduler/src/__tests__/schedule-time.test.ts` |
| SR-4 | DST spring-forward fires at next valid minute | EXISTING-TEST | `services/scheduler/src/__tests__/schedule-time.test.ts` |
| SR-5 | DST fall-back sends only once | EXISTING-TEST | `services/scheduler/src/__tests__/schedule-time.test.ts` |
| SR-6 | Catch-up within 6 hours, skip otherwise | EXISTING-TEST | `services/scheduler/src/__tests__/catch-up.test.ts` |
| SR-7 | Failed deliveries retried with exponential backoff | EXISTING-TEST | `services/scheduler/src/__tests__/command-worker.test.ts` |
| SR-8 | User notified when retries exhausted | EXISTING-TEST | `services/scheduler/src/__tests__/command-worker.test.ts` |
| SR-9 | Job run history visible in observability | DOCUMENTATION + CODE-INSPECTION | Grafana dashboards, queue-metrics tests |

### Section 5: Security (12 criteria)

| # | Criterion | Method | Evidence |
|---|-----------|--------|----------|
| SE-1 | JWT auth on all internal endpoints | AUTOMATED + EXISTING-TEST | `tests/smoke/auth.smoke.test.ts` |
| SE-2 | Per-endpoint caller allowlists | AUTOMATED + EXISTING-TEST | `tests/smoke/auth.smoke.test.ts`, `tests/smoke/services.smoke.test.ts` |
| SE-3 | Only webhook + web-ui publicly exposed | AUTOMATED + EXISTING-TEST | `tests/smoke/reverse-proxy.smoke.test.ts` |
| SE-4 | Internal APIs not publicly routed | AUTOMATED + EXISTING-TEST | Same as SE-3 |
| SE-5 | Webhook requires secret token, size limit, rate limit | EXISTING-TEST | `services/telegram-bridge/src/__tests__/webhook-secret.test.ts` |
| SE-6 | Monica API keys encrypted at rest | EXISTING-TEST | `services/user-management/src/crypto/__tests__/credential-cipher.test.ts` |
| SE-7 | Only monica-integration gets decrypted credentials | EXISTING-TEST + AUTOMATED | `tests/smoke/services.smoke.test.ts` |
| SE-8 | Sensitive data redacted | EXISTING-TEST | `packages/observability/src/__tests__/processors.test.ts` |
| SE-9 | Duplicate request protection | EXISTING-TEST | `services/telegram-bridge/src/bot/__tests__/update-dedup.test.ts` |
| SE-10 | Private chats only | EXISTING-TEST | `services/telegram-bridge/src/bot/middleware/__tests__/private-chat-only.test.ts` |
| SE-11 | Secret rotation policy documented | DOCUMENTATION | `docs/secret-rotation.md` |
| SE-12 | Shared OpenAI key guardrails | EXISTING-TEST + AUTOMATED | `services/ai-router/src/__tests__/guardrails-wiring.test.ts` |

### Section 6: Reliability (6 criteria)

| # | Criterion | Method | Evidence |
|---|-----------|--------|----------|
| RE-1 | Timeout handling on all external calls | CODE-INSPECTION + EXISTING-TEST | Timeout env vars in docker-compose.yml |
| RE-2 | Transport retries only in edge client | CODE-INSPECTION + EXISTING-TEST | monica-integration retry logic, scheduler job-level only |
| RE-3 | Safe pagination for large datasets | EXISTING-TEST | `packages/monica-api-lib/` paginated methods |
| RE-4 | Monica redirects to blocked networks rejected | EXISTING-TEST | `services/monica-integration/src/__tests__/app.test.ts` |
| RE-5 | Graceful fallback messages | CODE-INSPECTION + EXISTING-TEST | `services/telegram-bridge/src/bot/__tests__/error-handler.test.ts` |
| RE-6 | Strict payload validation | AUTOMATED + EXISTING-TEST | `tests/smoke/services.smoke.test.ts` |

### Section 7: Data Governance (6 criteria)

| # | Criterion | Method | Evidence |
|---|-----------|--------|----------|
| DG-1 | Conversation state minimized | CODE-INSPECTION | `services/ai-router/src/graph/nodes/persist-turn.ts` |
| DG-2 | Voice audio not retained | EXISTING-TEST | `services/voice-transcription/src/__tests__/audio-retention.test.ts` |
| DG-3 | 30-day retention for conversation/pending commands | AUTOMATED + EXISTING-TEST | `tests/smoke/data-governance.smoke.test.ts` |
| DG-4 | 90-day retention for command logs/delivery audits | AUTOMATED + EXISTING-TEST | `tests/smoke/data-governance.smoke.test.ts` |
| DG-5 | 14-day retention for traces/logs/dead-letter | DOCUMENTATION | docker-compose.yml, loki/tempo configs |
| DG-6 | Account disconnection flow | AUTOMATED + EXISTING-TEST | `tests/smoke/data-governance.smoke.test.ts` |

### Section 8: Observability (7 criteria)

| # | Criterion | Method | Evidence |
|---|-----------|--------|----------|
| OB-1 | End-to-end correlation IDs | AUTOMATED + EXISTING-TEST | `tests/smoke/services.smoke.test.ts` |
| OB-2 | Job status/timing/retry/error visibility | EXISTING-TEST + DOCUMENTATION | Grafana dashboards |
| OB-3 | Inter-service call tracing | CODE-INSPECTION | OTel SDK init, correlation propagation |
| OB-4 | Structured, searchable, redacted logs | EXISTING-TEST | `packages/observability/src/__tests__/processors.test.ts` |
| OB-5 | /health on every service | AUTOMATED | Expand health smoke test to all 7 Hono services |
| OB-6 | Grafana dashboards | DOCUMENTATION | `docker/grafana/provisioning/dashboards/` |
| OB-7 | Alerting configured | DOCUMENTATION | `docker/grafana/provisioning/alerting/rules.yml` |

### Section 9: Delivery (3 criteria)

| # | Criterion | Method | Evidence |
|---|-----------|--------|----------|
| DL-1 | All outbound through delivery as connector-neutral intents | CODE-INSPECTION + EXISTING-TEST | delivery connector-neutrality tests |
| DL-2 | Connectors own formatting | CODE-INSPECTION + EXISTING-TEST | telegram-bridge outbound-renderer tests |
| DL-3 | Delivery audit records | EXISTING-TEST | `services/delivery/src/__tests__/app.test.ts` |

### Section 10: Testing & Release Gates (4 criteria)

| # | Criterion | Method | Evidence |
|---|-----------|--------|----------|
| TG-1 | CI uses mocked Monica tests | CODE-INSPECTION + DOCUMENTATION | Fixture-based tests, no real Monica in CI |
| TG-2 | Real-Monica smoke suite exists outside CI | EXISTING-TEST | `packages/monica-api-lib/src/__smoke__/` |
| TG-3 | LLM smoke tests cover all required scenarios | EXISTING-TEST | `services/ai-router/src/__smoke__/` |
| TG-4 | Release requires passing smoke suites | CODE-INSPECTION + DOCUMENTATION | package.json test scripts |

## Implementation Steps

### Step 1: Extend smoke-config.ts for Full Service Coverage

Add `TELEGRAM_BRIDGE_URL` and `MONICA_INTEGRATION_URL` to the smoke config schema so the acceptance smoke test can verify all 8 services.

**Files to modify:**
- `tests/smoke/smoke-config.ts` — add two optional URL fields with defaults
- `tests/smoke/run.sh` — export the two new URL environment variables

### Step 2: Expand Health Check Coverage

Update `tests/smoke/health.smoke.test.ts` to cover all 7 Hono services. Add telegram-bridge (3001), monica-integration (3004), and scheduler (3005).

**Files to modify:**
- `tests/smoke/health.smoke.test.ts`

### Step 3: Expose telegram-bridge and monica-integration Ports in Smoke Overlay

Add port mappings for telegram-bridge and monica-integration to the smoke overlay.

**Files to modify:**
- `docker-compose.smoke.yml`

### Step 4: Write the Comprehensive Acceptance Smoke Test

Create `tests/smoke/acceptance.smoke.test.ts` that systematically verifies every criterion that can be tested via HTTP against the live stack. Organized by section.

**File to create:**
- `tests/smoke/acceptance.smoke.test.ts`

### Step 5: Audit the Onboarding Form Gap (OM-9)

Investigate whether the web-ui form collects timezone. If not, document as deferred with rationale.

**Files to inspect (no changes expected):**
- `services/web-ui/src/pages/setup/[tokenId].astro`
- `services/web-ui/src/pages/setup/submit.ts`

### Step 6: Run All Existing Test Suites and Record Results

Execute:
1. `pnpm test` — all unit + integration tests
2. `pnpm test:smoke:stack` — stack smoke tests
3. New acceptance smoke test

Record pass/fail results for inclusion in the release readiness report.

### Step 7: Produce the V1 Release Readiness Report

Create `context/product/v1-release-readiness-report.md` with:

1. Executive Summary — V1 readiness verdict
2. Criteria Verification Matrix — All 65 criteria with status, method, evidence
3. Deferred Items — Each with rationale and risk assessment
4. Test Results Summary — Pass/fail counts
5. Architecture Conformance
6. Security Posture
7. Observability Posture
8. Known Risks and Residual Items
9. Changed Files

### Step 8: Update Roadmap

Mark the three sub-items under "Full Acceptance Criteria Sweep" as `[x]`.

## Test Strategy

### TDD Sequence
1. **RED:** Write acceptance.smoke.test.ts — tests will fail due to missing config fields and unexposed ports
2. **GREEN:** Add smoke-config fields (Step 1), expand health test (Step 2), expose ports (Step 3)
3. **GREEN:** All acceptance smoke tests pass against the live stack

### Smoke Test Services
All services must be running:
```bash
docker compose up -d postgres redis caddy
docker compose -f docker-compose.yml -f docker-compose.smoke.yml --profile app up -d
```

## Security Considerations

- No new secrets or credentials introduced
- Acceptance smoke test follows existing JWT signing pattern
- No sensitive data in test assertions
- Port exposure in smoke overlay is for testing only
- Release readiness report contains no secrets

## Risks & Open Questions

### Identified Gaps

1. **OM-9 (IANA timezone during onboarding):** Web-ui form may not collect timezone. Backend support is complete. Risk: LOW — UI-only gap, recommend defer.

2. **Operational review findings:** Metrics template has "pending" values. Load test infrastructure exists. Risk: LOW — operational task.

3. **web-ui /health:** Astro does not expose /health like Hono services. Acceptable — Docker healthcheck probes Astro directly.

### Recommendations

- OM-9: Defer with rationale. Backend complete, form is fast-follow.
- Operational review: Document as known state, not a blocker.
- Real-Monica smoke suite: Cite last passing run if available.
