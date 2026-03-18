# Implementation Summary: Telegram Bridge

## Files Changed

| File | Action | Description |
|------|--------|-------------|
| `pnpm-workspace.yaml` | modified | Added `grammy: 1.41.1` to catalog |
| `services/telegram-bridge/package.json` | modified | Added grammy, ioredis, @monica-companion/types, @monica-companion/redaction dependencies |
| `packages/types/src/inbound-event.ts` | created | Connector-neutral InboundEventSchema (text_message, voice_message, callback_action) |
| `packages/types/src/outbound-message.ts` | created | OutboundMessageIntentSchema with z.enum(["telegram"]) for connectorType |
| `packages/types/src/transcription.ts` | created | TranscriptionRequestMetadataSchema and TranscriptionResponseSchema |
| `packages/types/src/connector-user-lookup.ts` | created | ConnectorUserLookupResponseSchema (found/userId) |
| `packages/types/src/index.ts` | modified | Re-exported all new shared schemas |
| `services/telegram-bridge/src/types/telegram.ts` | created | Telegram-specific TelegramInboundContext (never crosses service boundaries) |
| `services/user-management/src/app.ts` | modified | Added GET /internal/users/by-connector/:connectorType/:connectorUserId endpoint |
| `services/telegram-bridge/src/config.ts` | modified | Added TELEGRAM_BOT_TOKEN, AI_ROUTER_URL, VOICE_TRANSCRIPTION_URL, USER_MANAGEMENT_URL (required), REDIS_URL, timeout configs |
| `services/telegram-bridge/src/bot/bot-instance.ts` | created | grammY Bot factory for webhook mode |
| `services/telegram-bridge/src/bot/webhook-handler.ts` | created | Hono handler feeding updates to grammY bot, always returns 200 |
| `services/telegram-bridge/src/bot/update-dedup.ts` | created | Redis SET NX-based update_id dedup with graceful degradation |
| `services/telegram-bridge/src/bot/middleware/private-chat-only.ts` | created | Silent drop of non-private chat updates |
| `services/telegram-bridge/src/bot/middleware/user-resolver.ts` | created | Resolves Telegram user ID to internal UUID, sends setup prompt for unknown users |
| `services/telegram-bridge/src/bot/context.ts` | created | BotContext type with userId, correlationId, telegramUserId |
| `services/telegram-bridge/src/bot/handlers/text-message.ts` | created | Text message handler: typing + forward to ai-router |
| `services/telegram-bridge/src/bot/handlers/voice-message.ts` | created | Voice handler: download + transcribe + forward |
| `services/telegram-bridge/src/bot/handlers/callback-query.ts` | created | Callback query handler: answer locally + forward |
| `services/telegram-bridge/src/bot/callback-data.ts` | created | Encode/decode with 64-byte limit enforcement |
| `services/telegram-bridge/src/bot/outbound-renderer.ts` | created | Renders OutboundMessageIntent as Telegram messages (text, confirmation, disambiguation, error) |
| `services/telegram-bridge/src/bot/error-handler.ts` | created | bot.catch() handler with graceful fallback message |
| `services/telegram-bridge/src/bot/setup.ts` | created | Wires middleware and handlers in correct order |
| `services/telegram-bridge/src/bot/index.ts` | created | Barrel export for bot module |
| `services/telegram-bridge/src/lib/user-management-client.ts` | modified | Added lookupByConnector method with timeout |
| `services/telegram-bridge/src/lib/ai-router-client.ts` | created | Service client for forwarding events to ai-router |
| `services/telegram-bridge/src/lib/voice-transcription-client.ts` | created | Service client for multipart/form-data transcription |
| `services/telegram-bridge/src/lib/telegram-file-fetcher.ts` | created | Downloads files from Telegram Bot API |
| `services/telegram-bridge/src/app.ts` | modified | Full integration: bot setup, webhook handler with dedup, outbound /internal/send with Zod validation |
| `services/telegram-bridge/src/index.ts` | modified | Redis connection for update dedup |
| `services/voice-transcription/package.json` | modified | Added auth, types, zod dependencies |
| `services/voice-transcription/src/config.ts` | created | Auth config loading |
| `services/voice-transcription/src/app.ts` | modified | Added POST /internal/transcribe stub with 25MB body limit and serviceAuth |
| `services/voice-transcription/src/index.ts` | modified | Uses loadConfig() |
| `services/delivery/package.json` | modified | Added auth, redaction, types, zod dependencies |
| `services/delivery/src/config.ts` | created | Config with TELEGRAM_BRIDGE_URL |
| `services/delivery/src/app.ts` | modified | Minimal stub: POST /internal/deliver with Zod validation, forwards to connector URL |
| `services/delivery/src/index.ts` | modified | Uses loadConfig() |
| `services/ai-router/src/app.ts` | modified | Added POST /internal/process stub with serviceAuth (allowedCallers: ["telegram-bridge"]) |
| `services/ai-router/src/config.ts` | modified | Added optional DELIVERY_URL |
| `docker-compose.yml` | modified | Added TELEGRAM_BOT_TOKEN, AI_ROUTER_URL, VOICE_TRANSCRIPTION_URL, REDIS_URL, timeout vars to telegram-bridge; JWT_SECRET to voice-transcription and delivery; TELEGRAM_BRIDGE_URL to delivery; DELIVERY_URL to ai-router |
| `.env.example` | modified | Added timeout env var documentation |

## Tests Added

| Test File | What It Tests |
|-----------|---------------|
| `packages/types/src/__tests__/inbound-event.test.ts` | InboundEventSchema: all 3 variants, rejection of invalid data, no Telegram-specific fields |
| `packages/types/src/__tests__/outbound-message.test.ts` | OutboundMessageIntentSchema: all 4 content types, connector type validation |
| `packages/types/src/__tests__/transcription.test.ts` | Transcription metadata and response schemas |
| `packages/types/src/__tests__/connector-user-lookup.test.ts` | ConnectorUserLookupResponseSchema: found/not-found |
| `services/telegram-bridge/src/bot/__tests__/webhook-handler.test.ts` | Webhook handler: new update, duplicate skip, error resilience |
| `services/telegram-bridge/src/bot/__tests__/update-dedup.test.ts` | Redis-based dedup: new/seen/degradation |
| `services/telegram-bridge/src/bot/__tests__/callback-data.test.ts` | Encode/decode roundtrip, 64-byte limit, invalid format |
| `services/telegram-bridge/src/bot/__tests__/outbound-renderer.test.ts` | All 4 content types rendered correctly |
| `services/telegram-bridge/src/bot/__tests__/error-handler.test.ts` | Fallback message, reply failure handling |
| `services/telegram-bridge/src/bot/__tests__/setup.test.ts` | Middleware/handler registration order |
| `services/telegram-bridge/src/bot/middleware/__tests__/private-chat-only.test.ts` | Private, group, supergroup, channel, chatless |
| `services/telegram-bridge/src/bot/middleware/__tests__/user-resolver.test.ts` | Onboarded user, non-onboarded, missing from |
| `services/telegram-bridge/src/bot/handlers/__tests__/text-message.test.ts` | Typing + forward, error fallback |
| `services/telegram-bridge/src/bot/handlers/__tests__/voice-message.test.ts` | Full voice flow, transcription failure, download failure |
| `services/telegram-bridge/src/bot/handlers/__tests__/callback-query.test.ts` | Answer + forward, invalid data, error handling |
| `services/telegram-bridge/src/lib/__tests__/telegram-file-fetcher.test.ts` | File download, API error |
| `services/voice-transcription/src/__tests__/app.test.ts` | Health, auth, stub response |
| `services/delivery/src/__tests__/app.test.ts` | Health, auth, forwarding, scheduler caller |

## Verification Results

- **Biome**: `pnpm biome check` -- 0 errors, 17 warnings (non-null assertions in grammy handlers, intentional)
- **Tests**:
  - `@monica-companion/types`: 8 test files, **123 passed**
  - `@monica-companion/telegram-bridge`: 17 test files, **80 passed**
  - `@monica-companion/voice-transcription`: 1 test file, **4 passed**
  - `@monica-companion/delivery`: 1 test file, **6 passed**
  - `@monica-companion/ai-router`: 9 test files passed, 89 tests passed, 22 skipped (1 file failed -- pre-existing DB-dependent integration test requiring PostgreSQL, unrelated to this change)
  - `@monica-companion/user-management`: Tests require running PostgreSQL. New endpoint added but test validation requires DB (5 new test cases added to existing app.test.ts).

## Plan Deviations

1. **Biome reordered some index.ts exports**: Biome auto-sorted the exports in `packages/types/src/index.ts` alphabetically, which moves the new exports around. This is cosmetic only.

2. **delivery `@monica-companion/redaction` dependency added but not yet imported**: The dependency is added to `package.json` per plan review LOW-3 advisory, ready for use when the full delivery implementation adds logging with redaction. The import was intentionally omitted from app.ts to avoid Biome unused-import warnings.

3. **ai-router /internal/process mounted before guardrail middleware**: The process endpoint needs its own serviceAuth (allowedCallers: ["telegram-bridge"]) separate from the guardrail-protected contact resolution routes. Mounting it first ensures it gets its own auth stack rather than going through the GPT budget guardrails.

4. **`DELIVERY_URL` in ai-router config is optional**: Made optional since it is not used in the stub phase. Will become required when full ai-router implementation sends outbound messages.

## Residual Risks

1. **user-management tests require PostgreSQL**: The 5 new test cases for the connector lookup endpoint are added but cannot be verified without a running database. The endpoint implementation follows the exact same pattern as existing endpoints that have passing tests.

2. **Smoke tests not executed**: Docker Compose smoke tests are deferred per the completion rules -- they require the full stack running. The plan's smoke test strategy is documented in the plan file.

3. **Biome warnings for non-null assertions**: 17 warnings about `!` operator in grammy handler code. These are safe because grammy guarantees the fields exist when the handler filter matches (e.g., `on("message:text")` guarantees `ctx.message.text` exists).

4. **ai-router /internal/process is a stub**: Returns `{ received: true }` only. Full AI processing is deferred to the AI Router task group.

5. **voice-transcription /internal/transcribe is a stub**: Returns `{ success: false, error: "Transcription not implemented" }`. Full Whisper integration is deferred to the Voice Transcription task group.

6. **delivery is a minimal forwarding stub**: No audit persistence or complex routing. Deferred to the Delivery task group.
