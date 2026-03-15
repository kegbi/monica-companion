# Service Boundary Rules

- Keep Telegram API specifics in telegram-bridge only. No Telegram types, formatting, or API calls in other services.
- Keep Monica API specifics in monica-integration and monica-api-lib only. No Monica types or API calls leak into ai-router, scheduler, or delivery.
- Keep Scheduler logic separate from live Telegram request handling. Scheduler operates on structured command payloads, not Telegram messages.
- Delivery service is connector-agnostic — it routes structured payloads. The connector (telegram-bridge) owns platform-specific formatting (inline keyboards, markdown).
- Enforce service-to-service auth and explicit caller allowlists on all internal endpoints. Each service only accepts calls from expected callers.
- One service per Docker container. Services communicate over Docker Compose private internal network only.
- Voice transcription is connector-agnostic — any connector can call it, not just Telegram.
- User-management is the single source of truth for user credentials and configuration. Other services query it to resolve user context.
