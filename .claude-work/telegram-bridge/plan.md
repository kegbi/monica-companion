# Implementation Plan: Telegram Bridge (Revised)

_Revision 2 -- addresses all findings from plan-review.md (attempt 1)._

## Review Findings Resolution Index

| ID | Severity | Finding | Resolution |
|---|---|---|---|
| HIGH-1 | HIGH | InboundEvent schema leaks Telegram-specific fields into shared types | Redesigned: shared `InboundEventSchema` uses `userId` (internal UUID), opaque `sourceRef` string, and no `callbackQueryId`. Telegram-specific types live only in `services/telegram-bridge/src/types/`. See Step 2. |
| MEDIUM-1 | MEDIUM | Risk 7 bypasses delivery for outbound messages | Removed. Step 12 implements a minimal delivery stub that forwards outbound intents from ai-router to telegram-bridge, preserving the architecture path. |
| MEDIUM-2 | MEDIUM | TelegramUserLookupResponse name is connector-specific | Renamed to `ConnectorUserLookupResponse` in shared types. See Step 2. |
| MEDIUM-3 | MEDIUM | Transcription metadata via HTTP headers | Changed to multipart/form-data with a JSON metadata part and a binary audio part, both Zod-validated. See Steps 2 and 10. |
| MEDIUM-4 | MEDIUM | No update deduplication strategy | Added always-200 mitigation documentation and optional `update_id` tracking with Redis SET NX for restart scenarios. See Step 5. |
| MEDIUM-5 | MEDIUM | Smoke test missing non-private chat rejection | Added smoke test for group message silent drop. See Smoke Test Strategy. |
| LOW-1 | LOW | No request-size limit on `/internal/transcribe` | Added 25MB body limit. See Step 10. |
| LOW-2 | LOW | Callback data format not validated for 64-byte limit at encode time | Encoder enforces 64-byte limit with runtime check. See Step 11. |
| LOW-3 | LOW | `USER_MANAGEMENT_URL` is optional but will be required | Made required in config schema. See Step 4. |
| LOW-4 | LOW | No mention of grammY error boundary interaction with Hono | Clarified in Step 14 that `bot.catch()` handles grammY-level errors inside `handleUpdate`, while Hono error handler covers request-level failures outside grammY. |

## Objective

Implement the full Telegram Bridge service functionality: webhook ingestion with grammY, private-chat-only enforcement, connector event normalization into connector-neutral internal envelopes, Telegram file retrieval for voice messages, voice routing through `voice-transcription`, and interactive confirmation/clarification flows using inline keyboards, text replies, and voice replies. This bridges the gap between Telegram-specific transport concerns and the connector-neutral internal service contracts.

## Scope

### In Scope

- Install `grammy` as a dependency of `telegram-bridge` (verify latest stable version before pinning).
- Implement a grammY `Bot` instance in webhook mode, receiving updates from the existing Hono POST `/webhook/telegram` endpoint.
- Enforce private-chat-only policy: reject all group, supergroup, and channel messages with no response (silent drop).
- Detect content type (text message, voice message, callback query) and normalize each into a connector-neutral `InboundEvent` envelope containing correlation ID, internal user ID (UUID), content type, opaque source reference, and payload. No Telegram-specific fields in shared types.
- Resolve Telegram user ID to internal user ID via a new `GET /internal/users/by-connector/:connectorType/:connectorUserId` endpoint on `user-management`.
- For voice messages: fetch the Telegram file using the Bot API, then forward the binary to `voice-transcription` as multipart/form-data (JSON metadata part + binary audio part).
- Route text messages and transcribed voice text to `ai-router` via its internal API.
- Accept connector-neutral outbound message intents on `POST /internal/send` from `delivery` and render them as Telegram messages (text with markdown, inline keyboards, typing indicators).
- Implement a minimal `delivery` stub that accepts outbound intents from `ai-router` and forwards them to the target connector service, preserving the `ai-router -> delivery -> telegram-bridge` architecture path.
- Support inline keyboard buttons for confirmation (Yes/Edit/Cancel) and disambiguation flows.
- Handle callback queries (button presses) by normalizing them into inbound events. The `callbackQueryId` is answered within telegram-bridge before forwarding.
- Send typing indicators while waiting for AI processing.
- Add `TELEGRAM_BOT_TOKEN`, `AI_ROUTER_URL`, `VOICE_TRANSCRIPTION_URL`, and `DELIVERY_URL` to config schemas as appropriate.
- Implement update deduplication mitigation (always-200 plus optional `update_id` tracking).
- Propagate correlation IDs and user identity across all inter-service calls.
- Apply `@monica-companion/redaction` to all logged data.
- Emit OpenTelemetry spans for webhook processing, file download, transcription request, and ai-router forwarding.

### Out of Scope

- Full `voice-transcription` service implementation (covered by the Voice Transcription task group). Only a stub endpoint is added here.
- Full `delivery` service implementation (covered by the Delivery task group). Only a minimal forwarding stub is added here.
- Full `ai-router` request processing (ai-router already has its internal endpoint structure; this plan only covers the telegram-bridge client that calls it and the ai-router inbound endpoint stub).
- Onboarding flow `/start` command handling beyond basic "not onboarded" detection and setup link issuance.
- Scheduler integration (scheduler is a separate task group).
- Complex multi-turn conversation state management (owned by ai-router).
- Telegram group/channel features (explicitly out of scope per product definition).

## Affected Services & Packages

| Package/Service | Changes |
|-----------------|---------|
| `services/telegram-bridge` | Major: grammY bot setup, webhook handler, event normalization, file retrieval, outbound rendering, inline keyboards, typing indicators, service clients for ai-router and voice-transcription. Telegram-specific types defined locally. |
| `packages/types` | New Zod schemas: `InboundEvent` (connector-neutral), `OutboundMessageIntent`, `TranscriptionRequestMetadata`, `TranscriptionResponse`, `ConnectorUserLookupResponse`. |
| `services/user-management` | New endpoint: `GET /internal/users/by-connector/:connectorType/:connectorUserId` (caller: telegram-bridge). |
| `services/voice-transcription` | Stub: `POST /internal/transcribe` endpoint accepting multipart/form-data (JSON metadata + binary audio). |
| `services/delivery` | Minimal stub: `POST /internal/deliver` accepts `OutboundMessageIntent` from ai-router and forwards to the target connector's `/internal/send` endpoint. |
| `services/ai-router` | Stub: `POST /internal/process` endpoint that accepts connector-neutral `InboundEvent` and returns 200. Add `DELIVERY_URL` to config. |
| `docker-compose.yml` | Add env vars to telegram-bridge, voice-transcription, delivery, and ai-router containers. |
| `.env.example` | Add new env var documentation. |
| `pnpm-workspace.yaml` | Add `grammy` to catalog with pinned version. |

## Implementation Steps

### Step 1: Add grammY to workspace catalog and telegram-bridge dependencies

**What:** Add `grammy` to the `pnpm-workspace.yaml` catalog with an exact pinned version (verify latest stable on npmjs.com before pinning). Add it as a dependency in `services/telegram-bridge/package.json`. Also add `@monica-companion/types` and `@monica-companion/redaction` as dependencies (both are workspace packages already available).

**Files to modify:**
- `pnpm-workspace.yaml` -- add `grammy: <verified-version>`
- `services/telegram-bridge/package.json` -- add `grammy: "catalog:"`, `@monica-companion/types: "workspace:*"`, `@monica-companion/redaction: "workspace:*"`

**Expected outcome:** `pnpm install` succeeds. grammY is available for import in telegram-bridge.

---

### Step 2: Define connector-neutral shared types and Telegram-local types

**What:** Add Zod schemas to `@monica-companion/types` for the contracts that flow between services. These schemas must be fully connector-neutral. Separately, define Telegram-specific internal types within `services/telegram-bridge/src/types/` that are never exported outside the service.

**[HIGH-1 fix]** The shared `InboundEventSchema` uses `userId` (internal UUID resolved by the connector), an opaque `sourceRef` string (format is connector-defined, other services must not parse it), and `correlationId`. No `telegramUserId`, `chatId`, `messageId`, or `callbackQueryId` in shared types. The `callback_action` variant in shared types carries only `action` and `data` (opaque string) -- telegram-bridge answers the callback query locally before forwarding.

**[MEDIUM-2 fix]** The user-lookup response type is named `ConnectorUserLookupResponse`, not `TelegramUserLookupResponse`.

**[MEDIUM-3 fix]** The `TranscriptionRequestMetadataSchema` defines the JSON metadata for multipart/form-data transcription requests (no custom HTTP headers for metadata).

**Files to create in `packages/types/src/`:**
- `inbound-event.ts` -- `InboundEventSchema` discriminated union:
  - `text_message`: `{ type: "text_message", userId: string (UUID), sourceRef: string, text: string, correlationId: string }`
  - `voice_message`: `{ type: "voice_message", userId: string (UUID), sourceRef: string, transcribedText: string, correlationId: string }`
  - `callback_action`: `{ type: "callback_action", userId: string (UUID), sourceRef: string, action: string, data: string, correlationId: string }`
- `outbound-message.ts` -- `OutboundMessageIntentSchema`:
  - `{ userId: string, connectorType: "telegram", connectorRoutingId: string, correlationId: string, content: OutboundContent }` where `OutboundContent` is a discriminated union:
    - `text`: `{ type: "text", text: string }`
    - `confirmation_prompt`: `{ type: "confirmation_prompt", text: string, pendingCommandId: string, version: number }`
    - `disambiguation_prompt`: `{ type: "disambiguation_prompt", text: string, options: Array<{ label: string, value: string }> }`
    - `error`: `{ type: "error", text: string }`
- `transcription.ts` -- `TranscriptionRequestMetadataSchema` and `TranscriptionResponseSchema`:
  - Metadata: `{ mimeType: string, durationSeconds: number, languageHint?: string, correlationId: string }`
  - Response: `{ success: boolean, text?: string, error?: string, correlationId: string }`
- `connector-user-lookup.ts` -- `ConnectorUserLookupResponseSchema`:
  - `{ found: boolean, userId?: string }`

**Files to create in `services/telegram-bridge/src/types/`:**
- `telegram.ts` -- Telegram-specific internal types used only inside telegram-bridge:
  - `TelegramInboundContext` -- carries `telegramUserId: number`, `chatId: number`, `messageId: number`, `callbackQueryId?: string` etc. This type never crosses service boundaries.

**Files to modify:**
- `packages/types/src/index.ts` -- re-export all new shared schemas

**Test files to create:**
- `packages/types/src/__tests__/inbound-event.test.ts`
- `packages/types/src/__tests__/outbound-message.test.ts`
- `packages/types/src/__tests__/transcription.test.ts`
- `packages/types/src/__tests__/connector-user-lookup.test.ts`

**TDD sequence:** Write failing parse tests for each schema variant first, then define the schemas to pass.

**Expected outcome:** All new shared types are connector-neutral and exported from `@monica-companion/types`. Telegram-specific types are strictly local to telegram-bridge.

---

### Step 3: Add connector-neutral user lookup endpoint to user-management

**What:** Add `GET /internal/users/by-connector/:connectorType/:connectorUserId` to `user-management`. For V1, only `connectorType: "telegram"` is supported. The endpoint resolves a connector user ID to the internal user UUID using the existing `findUserByTelegramId` repository function. It is protected by `serviceAuth` with `allowedCallers: ["telegram-bridge"]`. Returns `ConnectorUserLookupResponse`.

**Files to modify:**
- `services/user-management/src/app.ts` -- add new route

**Test files to modify:**
- `services/user-management/src/__tests__/app.test.ts` -- add tests:
  - Returns 401 without auth
  - Returns 403 for disallowed caller
  - Returns `{ found: true, userId: "..." }` for known Telegram user
  - Returns `{ found: false }` for unknown Telegram user
  - Returns 400 for unsupported connector type

**TDD sequence:** Write failing test for 200 response with known user, then implement the route handler.

**Expected outcome:** telegram-bridge can resolve connector user IDs to internal UUIDs via a connector-neutral endpoint.

---

### Step 4: Extend telegram-bridge config with new env vars

**What:** Add `TELEGRAM_BOT_TOKEN`, `AI_ROUTER_URL`, and `VOICE_TRANSCRIPTION_URL` to the config schema. All three are required. Make `USER_MANAGEMENT_URL` required (was optional). Add `REDIS_URL` for update dedup.

**[LOW-3 fix]** `USER_MANAGEMENT_URL` changed from optional to required.

Add timeout config values with defaults: `AI_ROUTER_TIMEOUT_MS` (default 10000), `VOICE_TRANSCRIPTION_TIMEOUT_MS` (default 30000), `USER_MANAGEMENT_TIMEOUT_MS` (default 5000).

**Files to modify:**
- `services/telegram-bridge/src/config.ts` -- add new fields to `configSchema`
- `docker-compose.yml` -- add env vars to telegram-bridge container
- `.env.example` -- document new variables

**Test files to modify:**
- `services/telegram-bridge/src/__tests__/config.test.ts` -- add tests for new required fields

**TDD sequence:** Write failing test for missing `TELEGRAM_BOT_TOKEN`, then update the schema.

**Expected outcome:** Config loads and validates all required env vars.

---

### Step 5: Create grammY Bot instance and webhook handler with update deduplication

**What:** Create a grammY `Bot` instance configured for webhook mode. Replace the current placeholder `POST /webhook/telegram` handler with a handler that passes the Telegram Update object to grammY's `bot.handleUpdate()`. The bot does not use long polling; it exclusively uses webhook mode.

**[MEDIUM-4 fix]** Two-layer deduplication strategy:
1. **Primary mitigation:** Always return HTTP 200 to Telegram, even if processing fails.
2. **Restart-safe deduplication:** Track `update_id` in a Redis SET with a short TTL (60 seconds). Before calling `bot.handleUpdate()`, check if the `update_id` has been seen. If Redis is unavailable, fall back to processing (prefer availability over strict dedup).

**Files to create:**
- `services/telegram-bridge/src/bot/bot-instance.ts` -- factory function `createBot(token: string)` that creates and returns a `Bot` instance with no handlers yet.
- `services/telegram-bridge/src/bot/webhook-handler.ts` -- Hono route handler: parses JSON body, checks `update_id` dedup, calls `bot.handleUpdate()`, always returns 200.
- `services/telegram-bridge/src/bot/update-dedup.ts` -- `UpdateDedup` class with `isDuplicate(updateId: number): Promise<boolean>` using Redis SET NX with 60s TTL.

**Files to modify:**
- `services/telegram-bridge/src/app.ts` -- import and use the new webhook handler; create the bot instance.

**Test files to create:**
- `services/telegram-bridge/src/bot/__tests__/webhook-handler.test.ts`
- `services/telegram-bridge/src/bot/__tests__/update-dedup.test.ts`

**TDD sequence:** Write failing test that the webhook endpoint calls `bot.handleUpdate` for a new update, then wire the handler.

**Expected outcome:** Telegram webhook updates are received, deduplicated, and routed to the grammY bot instance.

---

### Step 6: Private-chat-only enforcement

**What:** Add a grammY middleware that checks `ctx.chat?.type`. If the chat type is not `"private"`, the middleware silently drops the update (does not call `next()`).

**Files to create:**
- `services/telegram-bridge/src/bot/middleware/private-chat-only.ts`
- `services/telegram-bridge/src/bot/middleware/__tests__/private-chat-only.test.ts`

**TDD sequence:** Write failing test that a group message update is silently dropped; then implement.

**Expected outcome:** Only private chat messages reach subsequent handlers.

---

### Step 7: User resolution middleware

**What:** Add a grammY middleware that extracts `ctx.from?.id` (Telegram user ID), calls the `user-management` lookup endpoint (`GET /internal/users/by-connector/telegram/:telegramUserId`), and attaches the internal `userId` to a custom grammY context. If the user is not found, replies with a setup prompt. Processing stops for non-onboarded users. Generates a correlation ID per update.

**Files to create:**
- `services/telegram-bridge/src/bot/middleware/user-resolver.ts`
- `services/telegram-bridge/src/bot/middleware/__tests__/user-resolver.test.ts`
- `services/telegram-bridge/src/bot/context.ts` -- custom context type with `userId: string`, `correlationId: string`, `telegramUserId: number`.

**Files to modify:**
- `services/telegram-bridge/src/lib/user-management-client.ts` -- add a `lookupByConnector` method.

**TDD sequence:** Write failing test that an onboarded user gets `userId` attached to context; then test that non-onboarded user gets a setup prompt.

**Expected outcome:** Every update from an onboarded user carries `userId` and `correlationId`.

---

### Step 8: Text message handler and ai-router forwarding

**What:** Register a handler for text messages. The handler:
1. Sends a typing indicator.
2. Builds a connector-neutral `InboundEvent` of type `text_message` using `userId` (UUID from context), `sourceRef` (opaque string like `"tg:msg:<messageId>"`), `text`, and `correlationId`.
3. Forwards the event to `ai-router` via `POST /internal/process`.
4. If the ai-router call fails, sends a user-facing error message.

**[HIGH-1 support]** The `InboundEvent` uses only connector-neutral fields. The `sourceRef` is opaque.

**Files to create:**
- `services/telegram-bridge/src/bot/handlers/text-message.ts`
- `services/telegram-bridge/src/lib/ai-router-client.ts`
- `services/telegram-bridge/src/bot/handlers/__tests__/text-message.test.ts`

**TDD sequence:** Write failing test that a text message triggers a call to ai-router with the correct connector-neutral payload; then implement.

**Expected outcome:** Text messages are forwarded to ai-router as connector-neutral events.

---

### Step 9: Voice message handler and transcription routing

**What:** Register a handler for voice messages. The handler:
1. Sends a typing indicator.
2. Extracts Telegram `file_id`, downloads the file binary.
3. Sends binary to `voice-transcription` via `POST /internal/transcribe` as multipart/form-data.
4. If transcription succeeds, sends a second typing indicator, builds an `InboundEvent` of type `voice_message`, forwards to ai-router.
5. If transcription fails, sends a user-facing error message.

**[MEDIUM-3 support]** Uses multipart/form-data for transcription metadata.

**Files to create:**
- `services/telegram-bridge/src/bot/handlers/voice-message.ts`
- `services/telegram-bridge/src/lib/voice-transcription-client.ts`
- `services/telegram-bridge/src/lib/telegram-file-fetcher.ts`
- `services/telegram-bridge/src/bot/handlers/__tests__/voice-message.test.ts`
- `services/telegram-bridge/src/lib/__tests__/telegram-file-fetcher.test.ts`

**TDD sequence:** Write failing test for the full voice flow; mock the Telegram API and voice-transcription service.

**Expected outcome:** Voice messages are downloaded, transcribed, and forwarded. Telegram file IDs never leave telegram-bridge.

---

### Step 10: Add stub transcription endpoint to voice-transcription

**What:** Add a `POST /internal/transcribe` endpoint accepting multipart/form-data with a JSON `metadata` field and a `file` binary part. Returns stub error response. Protected by `serviceAuth` with `allowedCallers: ["telegram-bridge"]`.

**[MEDIUM-3 fix]** Structured multipart/form-data. Metadata JSON validated with Zod.
**[LOW-1 fix]** 25MB body-size limit.

**Files to modify:**
- `services/voice-transcription/src/app.ts`
- `services/voice-transcription/package.json`

**Files to create:**
- `services/voice-transcription/src/config.ts`
- `services/voice-transcription/src/__tests__/app.test.ts`

**TDD sequence:** Write failing test that a valid multipart request returns the stub response; then implement.

**Expected outcome:** Transcription contract is testable end-to-end.

---

### Step 11: Callback query handler (button presses)

**What:** Register a handler for callback queries. The handler:
1. Parses callback data string (`action:pendingCommandId:version`).
2. Answers the callback query immediately inside telegram-bridge. **[HIGH-1 fix]** `callbackQueryId` never crosses the service boundary.
3. Sends a typing indicator.
4. Builds a connector-neutral `InboundEvent` of type `callback_action` with `action`, `data`, `userId`, `sourceRef`, and `correlationId`.
5. Forwards to ai-router.

**[LOW-2 fix]** Encoder enforces 64-byte limit at encode time.

**Files to create:**
- `services/telegram-bridge/src/bot/handlers/callback-query.ts`
- `services/telegram-bridge/src/bot/handlers/__tests__/callback-query.test.ts`
- `services/telegram-bridge/src/bot/callback-data.ts`
- `services/telegram-bridge/src/bot/__tests__/callback-data.test.ts`

**TDD sequence:** Write failing test for callback data encoding (valid format, 64-byte limit enforcement); then full handler flow.

**Expected outcome:** Button presses are normalized and forwarded as connector-neutral events.

---

### Step 12: Minimal delivery stub

**What:** Implement a minimal `delivery` stub that accepts `OutboundMessageIntent` from `ai-router` and forwards to the target connector's `/internal/send` endpoint.

**[MEDIUM-1 fix]** Preserves `ai-router -> delivery -> telegram-bridge` architecture path. No temporary bypass.

**What the stub does:**
1. Accepts `POST /internal/deliver` with `OutboundMessageIntentSchema` payload.
2. Validates with Zod.
3. Resolves target connector URL from `connectorType` (V1: "telegram" maps to `TELEGRAM_BRIDGE_URL`).
4. Forwards intent to connector's `POST /internal/send`.
5. Returns the connector's response.
6. Does NOT persist delivery audit records (deferred to full Delivery task group).

**Files to modify:**
- `services/delivery/src/app.ts`
- `services/delivery/package.json`

**Files to create:**
- `services/delivery/src/config.ts`
- `services/delivery/src/__tests__/app.test.ts`

**TDD sequence:** Write failing test that a valid `OutboundMessageIntent` is forwarded to the connector URL; then implement.

**Expected outcome:** ai-router can send outbound messages through delivery to telegram-bridge.

---

### Step 13: Add ai-router inbound stub endpoint

**What:** Add `POST /internal/process` to `ai-router` accepting connector-neutral `InboundEvent`. Returns `{ received: true }`. Add `DELIVERY_URL` to config.

Protected by `serviceAuth` with `allowedCallers: ["telegram-bridge"]`.

**Files to modify:**
- `services/ai-router/src/app.ts`
- `services/ai-router/src/config.ts`

**Expected outcome:** telegram-bridge has a working endpoint to forward events to.

---

### Step 14: Outbound message rendering on /internal/send

**What:** Replace the placeholder `/internal/send` endpoint with real implementation accepting `OutboundMessageIntentSchema` and rendering Telegram messages.

**[LOW-4 note]** The outbound `/internal/send` endpoint is a Hono route handler outside grammY's middleware chain. Its errors are caught by its own try/catch. No overlap with `bot.catch()`.

Dispatches based on `content.type`:
- `text`: `bot.api.sendMessage(chatId, text, { parse_mode: "Markdown" })`
- `confirmation_prompt`: text with inline keyboard (Yes/Edit/Cancel)
- `disambiguation_prompt`: text with inline keyboard from options
- `error`: plain text

**Files to create:**
- `services/telegram-bridge/src/bot/outbound-renderer.ts`
- `services/telegram-bridge/src/bot/__tests__/outbound-renderer.test.ts`

**Files to modify:**
- `services/telegram-bridge/src/app.ts`

**TDD sequence:** Write failing test for each content type; then implement.

**Expected outcome:** delivery can send connector-neutral intents that render as Telegram messages.

---

### Step 15: Typing indicators

Integrated into handlers from Steps 8, 9, and 11. Voice messages get a second typing indicator after transcription completes.

**Test files verify** `sendChatAction` is called with `"typing"` at expected points.

---

### Step 16: Graceful error handling and user-facing fallback messages

**What:** Add `bot.catch()` error handler that logs with redaction, sends fallback message, increments error counter. Add `AbortController` timeouts to all outbound HTTP calls.

**[LOW-4 fix]** `bot.catch()` handles grammY inbound pipeline errors. Hono error handler covers `/internal/send` and other HTTP routes. Separate execution paths, no conflict.

**Files to create:**
- `services/telegram-bridge/src/bot/error-handler.ts`
- `services/telegram-bridge/src/bot/__tests__/error-handler.test.ts`

**Files to modify:**
- Service client files -- add `AbortController` timeout using config values.

**TDD sequence:** Write failing test for error handler; then implement.

**Expected outcome:** Users never see raw errors. All external calls have timeouts.

---

### Step 17: Update docker-compose.yml and .env files

**Files to modify:**
- `docker-compose.yml`:
  - telegram-bridge: add `TELEGRAM_BOT_TOKEN`, `AI_ROUTER_URL`, `VOICE_TRANSCRIPTION_URL`, `REDIS_URL`, timeout vars
  - voice-transcription: add `JWT_SECRET`, `JWT_SECRET_PREVIOUS`, `SERVICE_NAME`
  - delivery: add `JWT_SECRET`, `JWT_SECRET_PREVIOUS`, `SERVICE_NAME`, `TELEGRAM_BRIDGE_URL`
  - ai-router: add `DELIVERY_URL`
- `.env.example`: document new variables

Note on dependency edges: avoid circular `depends_on`. telegram-bridge depends on user-management at startup. ai-router and delivery have only request-time dependencies, not startup dependencies.

**Expected outcome:** Docker Compose stack has correct env var wiring.

---

### Step 18: Integration wiring and handler registration

**What:** Wire all handlers and middleware in order:
1. Private-chat-only middleware
2. User resolver middleware
3. Text message handler
4. Voice message handler
5. Callback query handler
6. Error handler (`bot.catch()`)

**Files to create:**
- `services/telegram-bridge/src/bot/setup.ts`
- `services/telegram-bridge/src/bot/index.ts`

**Files to modify:**
- `services/telegram-bridge/src/app.ts`
- `services/telegram-bridge/src/index.ts`

**Test files to create:**
- `services/telegram-bridge/src/bot/__tests__/setup.test.ts`

**TDD sequence:** Write failing integration test for full middleware chain; then wire.

**Expected outcome:** All components connected. Full update flow works end-to-end.

## Test Strategy

### Unit Tests (Vitest)

| Component | What to Test | What to Mock |
|-----------|-------------|--------------|
| `private-chat-only` middleware | Drops group/supergroup/channel; passes private | grammY context |
| `user-resolver` middleware | Attaches userId for onboarded user; sends setup prompt for unknown user | user-management HTTP client |
| `text-message` handler | Sends typing indicator; forwards connector-neutral event to ai-router; handles errors | grammY context, ai-router client |
| `voice-message` handler | Downloads file; sends multipart to transcription; forwards result to ai-router; handles failures | grammY context, Telegram file API, voice-transcription client |
| `callback-query` handler | Answers callback query locally; forwards connector-neutral event to ai-router | grammY context, ai-router client |
| `callback-data` utility | Encode/decode roundtrip; rejects invalid formats; enforces 64-byte limit at encode | None (pure function) |
| `outbound-renderer` | Renders each content type correctly (text, confirmation, disambiguation, error) | grammY Bot API |
| `telegram-file-fetcher` | Downloads binary; handles timeout; handles 404 | HTTP fetch (mocked) |
| `error-handler` | Logs with redaction; sends fallback message; handles send-failure gracefully | grammY context, logger |
| `update-dedup` | Returns false for new update_id; returns true for seen; degrades gracefully when Redis unavailable | Redis client (mocked) |
| Config | Validates all required fields (including `USER_MANAGEMENT_URL`); applies defaults; rejects missing | None |
| Shared types | All Zod schema variants parse correctly; reject invalid data; no Telegram-specific fields | None |
| Delivery stub | Forwards outbound intents to connector URL; validates payload; handles connector errors | HTTP fetch (mocked) |
| user-management lookup | Returns found/not-found; rejects unsupported connector type; enforces auth | Real PostgreSQL (integration) |

### Integration Tests

| Scenario | Real Dependencies |
|----------|-------------------|
| user-management lookup endpoint | Real PostgreSQL (seeded test user) |
| Full webhook handler chain | In-process Hono app with mocked external services |
| Delivery stub forwarding | In-process Hono app with mocked connector service |

## Smoke Test Strategy

### Services to Start

```bash
docker compose --profile app up -d caddy telegram-bridge user-management voice-transcription ai-router delivery
```

### HTTP Checks

1. **Health check through internal network:**
   ```bash
   docker compose exec telegram-bridge curl -sf http://localhost:3001/health
   ```

2. **Webhook ingress through Caddy (private chat message):**
   ```bash
   curl -s -X POST http://localhost/webhook/telegram \
     -H "Content-Type: application/json" \
     -H "X-Telegram-Bot-Api-Secret-Token: $TELEGRAM_WEBHOOK_SECRET" \
     -d '{"update_id":1,"message":{"message_id":1,"from":{"id":12345,"is_bot":false,"first_name":"Test"},"chat":{"id":12345,"type":"private"},"date":1700000000,"text":"hello"}}'
   # Expected: 200
   ```

3. **Webhook rejects missing secret:**
   ```bash
   curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost/webhook/telegram \
     -H "Content-Type: application/json" \
     -d '{"update_id":2}'
   # Expected: 401
   ```

4. **[MEDIUM-5 fix] Non-private chat message silently dropped:**
   ```bash
   curl -s -X POST http://localhost/webhook/telegram \
     -H "Content-Type: application/json" \
     -H "X-Telegram-Bot-Api-Secret-Token: $TELEGRAM_WEBHOOK_SECRET" \
     -d '{"update_id":3,"message":{"message_id":2,"from":{"id":12345,"is_bot":false,"first_name":"Test"},"chat":{"id":-100123,"type":"group"},"date":1700000000,"text":"hello group"}}'
   # Expected: 200 (accepted but silently dropped)
   ```

5. **Internal send endpoint rejects unauthenticated calls:**
   ```bash
   docker compose exec telegram-bridge curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:3001/internal/send
   # Expected: 401
   ```

6. **User-management lookup accessible from telegram-bridge:**
   ```bash
   docker compose exec telegram-bridge curl -sf \
     http://user-management:3007/internal/users/by-connector/telegram/nonexistent \
     -H "Authorization: Bearer $TOKEN"
   # Expected: {"found":false}
   ```

7. **Delivery stub health check:**
   ```bash
   docker compose exec delivery curl -sf http://localhost:3006/health
   ```

8. **Voice-transcription stub health check:**
   ```bash
   docker compose exec voice-transcription curl -sf http://localhost:3003/health
   ```

## Security Considerations

1. Telegram webhook secret validation with timing-safe comparison.
2. Private-chat-only enforcement: group messages silently dropped.
3. `TELEGRAM_BOT_TOKEN` treated as secret, never logged, covered by redaction.
4. Service-to-service auth with per-endpoint caller allowlists:
   - `/internal/send` on telegram-bridge: `["delivery"]` only
   - `/internal/deliver` on delivery: `["ai-router", "scheduler"]`
   - `/internal/process` on ai-router: `["telegram-bridge"]`
   - `/internal/transcribe` on voice-transcription: `["telegram-bridge"]`
   - `/internal/users/by-connector/:type/:id` on user-management: `["telegram-bridge"]`
5. No Telegram-specific fields in shared types.
6. Callback data: only opaque IDs, no PII. 64-byte limit enforced at encode.
7. All logging uses `@monica-companion/redaction`.
8. Body-size limits: 1MB on webhook (Caddy), 25MB on transcription.
9. File downloads: ephemeral URLs, explicit timeouts, no persistence.
10. User identity propagation: `userId` (UUID) and `correlationId` on all inter-service calls.
11. Update dedup: always-200 + Redis-backed `update_id` tracking.

## Risks & Mitigations

1. **ai-router inbound is a stub.** Returns `{ received: true }`. Full AI processing is separate.
2. **voice-transcription is a stub.** Returns error. Full Whisper integration in Voice Transcription task group.
3. **delivery is a minimal stub.** Forwards but no audit persistence. Full implementation in Delivery task group.
4. **grammY version compatibility.** Verify against Node.js 24.x LTS before pinning.
5. **Telegram callback_data 64-byte limit.** ~55 bytes typical. Encoder enforces limit.
6. **Race condition: message before onboarding completes.** User resolver replies with setup prompt.
7. **Redis unavailable for dedup.** Degrades to always-process (availability over strict dedup).
8. **Docker Compose dependency edges.** Avoid circular `depends_on`. Use request-time dependencies for ai-router <-> delivery.
