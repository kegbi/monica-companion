---
verdict: REJECTED
attempt: 1
critical_count: 0
high_count: 1
medium_count: 5
---

# Plan Review: Telegram Bridge

## Findings

### CRITICAL
(none)

### HIGH

1. [HIGH] **InboundEvent schema in shared types leaks Telegram-specific fields into connector-neutral contracts.** Step 2 defines `InboundEventSchema` in `packages/types` with `telegramUserId`, `chatId: number`, `messageId: number`, and (in the `callback_query` variant) `callbackQueryId`. All four are Telegram-specific concepts. The service-boundaries rule (`.claude/rules/service-boundaries.md`) states: "Keep Telegram API specifics in `telegram-bridge` only. No Telegram types, formatting, webhook logic, or file IDs in other services." The `packages/types` package is consumed by `ai-router` and potentially every other service. Placing Telegram-specific fields here forces downstream services to depend on Telegram semantics, violating the connector-neutral contract principle. When a second connector is added, these fields would be meaningless or require a parallel schema.

   **Fix:** Redesign `InboundEventSchema` to be connector-neutral. Replace `telegramUserId` with `userId` (the internal UUID, which the user-resolver middleware already resolves). Replace `chatId` and `messageId` with an opaque `sourceRef` object (e.g., `{ connectorType: string, routingId: string, messageRef: string }`) or simply drop them since `correlationId` already provides traceability. Remove `callbackQueryId` from the shared schema entirely -- `telegram-bridge` can answer the callback query itself before forwarding to `ai-router`. If `ai-router` needs to reference the original message, use `correlationId` plus an opaque string `sourceMessageRef`, not typed Telegram fields. Keep a Telegram-specific internal type within `services/telegram-bridge/src/` for use only inside that service.

### MEDIUM

1. [MEDIUM] **Risk 7 proposes bypassing `delivery` for outbound messages.** The plan states: "For development/testing, telegram-bridge also accepts direct calls on `/internal/send` from ai-router (temporarily allowing ai-router in the caller allowlist)." The architecture explicitly shows `ai-router -> delivery -> telegram-bridge` for all outbound messages. Even as a temporary workaround, adding `ai-router` to the `/internal/send` caller allowlist creates a boundary violation that could persist. **Fix:** Remove Risk 7's temporary allowlist expansion. Instead, implement a minimal delivery stub that forwards outbound intents from `ai-router` to `telegram-bridge`. This keeps the architecture path intact.

2. [MEDIUM] **`TelegramUserLookupResponse` schema name in shared types is connector-specific.** Step 2 defines `TelegramUserLookupResponseSchema` in `packages/types`. While user-management legitimately owns Telegram linkage, the shared type name hardcodes the connector name. **Fix:** Rename to `ConnectorUserLookupResponse` or `UserLookupByConnectorResponse`.

3. [MEDIUM] **Transcription request metadata sent via HTTP headers instead of a structured body.** Step 10 defines the transcription endpoint as accepting binary body with metadata in headers (`X-Mime-Type`, `X-Duration-Seconds`, `X-Correlation-ID`, `X-Language-Hint`). Using custom headers for structured metadata is fragile and harder to validate with Zod. **Fix:** Use `multipart/form-data` with a JSON metadata part and a binary audio part, or use a single JSON header that can be parsed and validated with Zod.

4. [MEDIUM] **No Telegram update deduplication.** The acceptance criteria state "Duplicate request protection prevents repeated side effects from Telegram retries." The plan returns 200 for all updates (Step 5) which mitigates most retries, but if the service restarts mid-processing, Telegram may redeliver. **Fix:** Add a brief note about `update_id` deduplication strategy. At minimum, document that always-200 is the primary mitigation.

5. [MEDIUM] **Smoke test does not verify non-private chat rejection.** None of the five HTTP checks verify that group/supergroup messages are silently dropped. **Fix:** Add a smoke test that sends a webhook update with `chat.type: "group"` and verifies no outbound response.

### LOW

1. [LOW] **No request-size limit on `/internal/transcribe`.** Add a body-size limit (e.g., 25MB).
2. [LOW] **Callback data format not validated for 64-byte limit at encode time.** Make the encoder enforce the limit.
3. [LOW] **`USER_MANAGEMENT_URL` is optional but will be required.** Step 4 should make it required.
4. [LOW] **No mention of grammY's built-in error boundary behavior.** Clarify interaction between `bot.catch()` and Hono error handler.

## Verdict Rationale

**REJECTED** due to one HIGH finding. The `InboundEvent` schema contains Telegram-specific fields that directly violate the service-boundary rule. Fixing the schema to be connector-neutral before implementation is significantly cheaper than refactoring after multiple services are built against Telegram-specific field names.
