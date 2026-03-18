# Implementation Plan: Connector-Ready Contracts

## Objective

Audit all shared contracts and service implementations for Telegram-specific assumptions that have leaked outside `telegram-bridge`, and fix them so that a future connector (WhatsApp, Signal, Matrix, etc.) can be added without modifying core service contracts. This is a hardening/review task -- not a greenfield feature. The goal is connector-neutrality in all services except `telegram-bridge` itself.

## Scope

### In Scope

- Audit and fix the `OutboundMessageIntentSchema` `connectorType` enum that is locked to `["telegram"]`
- Remove hardcoded `"telegram"` string literals from `scheduler` (command-worker, dead-letter, reminder-executor)
- Refactor `delivery` service to use a data-driven connector registry instead of a hardcoded Telegram URL map and ternary
- Widen `allowedCallers` on `voice-transcription` and `ai-router` to accept a configurable list of connectors (not only `telegram-bridge`)
- Fix the `user-management` connector lookup that hardcodes `if (connectorType !== "telegram")`
- Add boundary-enforcement tests that statically verify no Telegram-specific types/imports leak into `ai-router`, `scheduler`, `delivery`, `voice-transcription`, or `monica-integration`
- Update existing tests to pass with the widened contracts
- Document the connector contract extension points for future connector authors

### Out of Scope

- Implementing an actual second connector (WhatsApp, Signal, etc.)
- Changing the `telegram-bridge` service internals (those are correctly Telegram-specific)
- Changing the `InboundEventSchema`, `TranscriptionRequestMetadataSchema`, or `PendingCommandRecordSchema` (these are already connector-neutral)
- Refactoring the `user-management` database schema's `telegramUserId` column (V1 has only one connector; the schema correctly stores connector-specific user IDs and the column name is internal to user-management)
- Adding multi-connector user management (a user having accounts on multiple connectors simultaneously)
- Performance optimization or new features

## Analysis: Current Contract State

### Contracts Already Connector-Neutral (No Changes Needed)

| Contract | Location | Why It Is Clean |
|---|---|---|
| `InboundEventSchema` | `packages/types/src/inbound-event.ts` | Uses opaque `sourceRef` string, discriminated union by content type, no Telegram types |
| `TranscriptionRequestMetadataSchema` | `packages/types/src/transcription.ts` | Binary upload or fetch URL, no file IDs |
| `TranscriptionResponseSchema` | `packages/types/src/transcription.ts` | Generic text + error |
| `DeliveryResponseSchema` | `packages/types/src/delivery.ts` | Generic status enum |
| `PendingCommandRecordSchema` | `packages/types/src/commands.ts` | `sourceMessageRef` documented as opaque |
| `ConfirmedCommandPayloadSchema` | `packages/types/src/commands.ts` | No connector fields |
| `ContactResolutionSummary` | `packages/types/src/contact-resolution.ts` | Pure data projection |
| `UserScheduleResponse` | `packages/types/src/user-management.ts` | `connectorType: z.string()` (not enum) |
| `ConnectorUserLookupResponseSchema` | `packages/types/src/connector-user-lookup.ts` | Generic boolean response |
| grammY dependency | `services/telegram-bridge/` only | Not imported anywhere else |

### Telegram-Specific Leaks Found

| ID | Location | Finding | Severity |
|---|---|---|---|
| L1 | `packages/types/src/outbound-message.ts:44` | `connectorType: z.enum(["telegram"])` -- hardcoded enum in shared types | CRITICAL |
| L2 | `services/scheduler/src/workers/command-worker.ts:67` | Hardcodes `connectorType: "telegram"` in delivery intent | HIGH |
| L3 | `services/scheduler/src/lib/dead-letter.ts:67` | Hardcodes `connectorType: "telegram"` in error notification | HIGH |
| L4 | `services/scheduler/src/workers/reminder-executor.ts:15` | Type literal `connectorType: "telegram"` in `ReminderJobData` | HIGH |
| L5 | `services/delivery/src/app.ts:94` | Redundant ternary `intent.connectorType === "telegram" ? "telegram-bridge" : "telegram-bridge"` | MEDIUM |
| L6 | `services/delivery/src/app.ts:14-16` | `CONNECTOR_URL_MAP` hardcoded with only `telegram` key | MEDIUM |
| L7 | `services/delivery/src/config.ts:5,11` | Config only has `TELEGRAM_BRIDGE_URL` / `telegramBridgeUrl` | MEDIUM |
| L8 | `services/voice-transcription/src/app.ts:24` | `allowedCallers: ["telegram-bridge"]` hardcoded | LOW |
| L9 | `services/ai-router/src/app.ts:30` | `allowedCallers: ["telegram-bridge"]` hardcoded | LOW |
| L10 | `services/ai-router/src/contact-resolution/routes.ts:22` | `allowedCallers: ["telegram-bridge"]` hardcoded | LOW |
| L11 | `services/user-management/src/app.ts:288` | `if (connectorType !== "telegram")` hardcoded check | MEDIUM |
| L12 | `services/scheduler/src/workers/command-worker.ts:68` + `dead-letter.ts:68` | `connectorRoutingId: ""` -- empty string placeholder instead of resolving from user prefs | MEDIUM |

## Affected Services & Packages

| Package/Service | Changes |
|---|---|
| `packages/types` | Widen `OutboundMessageIntentSchema.connectorType` from `z.enum(["telegram"])` to `z.string().min(1)` |
| `services/delivery` | Refactor connector URL resolution from hardcoded map to config-driven registry; fix audience resolution |
| `services/scheduler` | Remove all hardcoded `"telegram"` literals; resolve `connectorType` and `connectorRoutingId` from job data or user prefs |
| `services/voice-transcription` | Make `allowedCallers` configurable via env var |
| `services/ai-router` | Make `allowedCallers` configurable via env var |
| `services/user-management` | Replace hardcoded `"telegram"` check with stored connector types |
| `packages/types` (tests) | Update `outbound-message.test.ts` to test with multiple connector types |
| All affected services (tests) | Update test fixtures and assertions |

## Implementation Steps

### Step 1: Widen `OutboundMessageIntentSchema.connectorType` (L1 -- CRITICAL)

**What:** Change `connectorType: z.enum(["telegram"])` to `connectorType: z.string().min(1)` in `packages/types/src/outbound-message.ts`.

**Why:** This is the single most impactful change. The shared types package defines the connector-neutral contract, yet it hardcodes `"telegram"` as the only valid connector type. Every service that validates outbound intents inherits this restriction.

**Files to modify:**
- `packages/types/src/outbound-message.ts` -- change line 44

**Files to update (tests):**
- `packages/types/src/__tests__/outbound-message.test.ts` -- update the "rejects unsupported connector type" test to instead test that any non-empty string is accepted; add a test that validates a hypothetical `"whatsapp"` connector type passes; keep the "rejects empty string" test

**TDD sequence:**
1. Write a failing test: `OutboundMessageIntentSchema.safeParse({...connectorType: "whatsapp"...})` should succeed but currently fails
2. Change the schema
3. Verify existing tests still pass, update the rejection test

---

### Step 2: Fix scheduler hardcoded connector literals (L2, L3, L4, L12)

**What:** Remove all hardcoded `"telegram"` strings and empty `connectorRoutingId` placeholders from scheduler workers. The scheduler should resolve connector routing metadata from the job data passed down from the caller.

**Files to modify:**
- `services/scheduler/src/workers/command-worker.ts` -- Read `connectorType` and `connectorRoutingId` from job data instead of hardcoding
- `services/scheduler/src/workers/reminder-executor.ts` -- Change `ReminderJobData` from `connectorType: "telegram"` (literal type) to `connectorType: string`
- `services/scheduler/src/lib/dead-letter.ts` -- Add `connectorType` and `connectorRoutingId` to `DeadLetterPayload` interface and pass from original job data

**Files to update (tests):**
- `services/scheduler/src/__tests__/command-worker.test.ts`
- `services/scheduler/src/__tests__/reminder-executor.test.ts`
- `services/scheduler/src/__tests__/dead-letter.test.ts`

**TDD sequence:**
1. Write a failing test: `processCommandJob` with `connectorType: "whatsapp"` in job data should produce a delivery intent with `connectorType: "whatsapp"`
2. Refactor the worker to use job data
3. Repeat for dead-letter and reminder-executor

---

### Step 3: Extend ConfirmedCommandPayload with connector routing (supports Step 2)

**What:** Add optional `connectorType` and `connectorRoutingId` fields to the `ConfirmedCommandPayloadSchema` in `packages/types/src/commands.ts`.

**Files to modify:**
- `packages/types/src/commands.ts` -- Add two optional fields

**Files to update (tests):**
- `packages/types/src/__tests__/commands.test.ts`

---

### Step 4: Refactor delivery service connector resolution (L5, L6, L7)

**What:** Replace the hardcoded `CONNECTOR_URL_MAP` and `telegramBridgeUrl` config with a config-driven connector registry.

**Files to modify:**
- `services/delivery/src/config.ts` -- Replace `TELEGRAM_BRIDGE_URL` with `CONNECTOR_URLS` (JSON env var), keep `TELEGRAM_BRIDGE_URL` as backward-compat fallback
- `services/delivery/src/app.ts` -- Replace hardcoded map and ternary with registry lookup

**Files to update (tests):**
- `services/delivery/src/__tests__/config.test.ts`
- `services/delivery/src/__tests__/app.test.ts`

**TDD sequence:**
1. Write a failing test: delivery config with `CONNECTOR_URLS={"whatsapp":"http://whatsapp-bridge:3010"}` should produce a registry entry
2. Implement the config parser
3. Write a failing test: delivery app with registry entry for whatsapp should resolve URL correctly
4. Refactor the app to use the registry

---

### Step 5: Make `allowedCallers` configurable in voice-transcription and ai-router (L8, L9, L10)

**What:** Make the `allowedCallers` arrays configurable via `INBOUND_ALLOWED_CALLERS` env var while defaulting to `["telegram-bridge"]`.

**Files to modify:**
- `services/voice-transcription/src/config.ts`
- `services/voice-transcription/src/app.ts`
- `services/ai-router/src/config.ts`
- `services/ai-router/src/app.ts`
- `services/ai-router/src/contact-resolution/routes.ts`

**Files to update (tests):**
- `services/voice-transcription/src/__tests__/config.test.ts`
- `services/voice-transcription/src/__tests__/app.test.ts`
- `services/ai-router/src/__tests__/config.test.ts`

---

### Step 6: Fix user-management connector lookup hardcoding (L11)

**What:** Replace `if (connectorType !== "telegram")` with a `switch` that has a `"telegram"` case and a `default` case returning 400.

**Files to modify:**
- `services/user-management/src/app.ts` (around line 288)

**Files to update (tests):**
- `services/user-management/src/__tests__/app.test.ts`

---

### Step 7: Add boundary-enforcement tests for connector-neutrality

**What:** Add static analysis tests that verify no Telegram-specific imports or hardcoded `"telegram"` string literals appear in non-test source files of connector-neutral services.

**Files to create:**
- `services/scheduler/src/__tests__/connector-neutrality.test.ts`
- `services/delivery/src/__tests__/connector-neutrality.test.ts`
- `services/voice-transcription/src/__tests__/connector-neutrality.test.ts`
- `services/monica-integration/src/__tests__/connector-neutrality.test.ts`

**Pattern to follow:** `services/ai-router/src/__tests__/boundary-enforcement.test.ts`

---

### Step 8: Document connector extension points

**Files to create:**
- `context/spec/connector-extension-guide.md`

---

### Step 9: Update test fixtures across affected services

Full test sweep to ensure `pnpm test` passes across all packages and services.

## Test Strategy

### Unit Tests (Vitest)

| What to Test | Service |
|---|---|
| `OutboundMessageIntentSchema` accepts arbitrary connector types | `packages/types` |
| Delivery connector registry resolves URLs from config | `services/delivery` |
| Scheduler command-worker reads connectorType from job data | `services/scheduler` |
| Scheduler dead-letter reads connectorType from payload | `services/scheduler` |
| Voice-transcription config parses allowed callers from env | `services/voice-transcription` |
| AI-router config parses allowed callers from env | `services/ai-router` |
| Connector-neutrality boundary tests | All connector-neutral services |

### Integration Tests

No new integration tests required. Existing integration tests continue to exercise the same code paths.

## Smoke Test Strategy

### Docker Compose Services to Start

```bash
docker compose --profile app up -d delivery scheduler telegram-bridge ai-router voice-transcription user-management postgres redis caddy
```

### HTTP Checks

1. **Health checks** -- All services return `{"status":"ok"}`
2. **Delivery accepts `connectorType: "telegram"`** -- V1 flow still works
3. **Delivery rejects unknown connector at registry level (400)** -- Not at schema level
4. **End-to-end Telegram webhook flow** -- Full path through Caddy still works

## Security Considerations

1. `allowedCallers` defaults remain restrictive (`["telegram-bridge"]`). New connectors must be explicitly added via env vars.
2. Delivery connector registry maps types to internal Docker network URLs -- never exposed publicly.
3. No new public endpoints added.
4. JWT audience validation moves from hardcoded to registry-based, preserving the security boundary.

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Widening `connectorType` from enum to string could allow typos at runtime | Delivery registry provides runtime validation; boundary tests catch hardcoded strings |
| Configurable `allowedCallers` could be misconfigured | Default values are restrictive; documentation notes security implications |
| Scheduler command-worker needs connector routing from job data | Optional fields with fallback to user-management lookup |
