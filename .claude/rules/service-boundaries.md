# Service Boundary Rules

- Keep Telegram API specifics in `telegram-bridge` only. No Telegram types, formatting, webhook logic, or file IDs in other services.
- Keep Monica API specifics in `monica-integration` and `monica-api-lib` only. `ai-router`, `scheduler`, and `delivery` must depend on Monica-agnostic contracts.
- `ai-router` may consume only the minimized `ContactResolutionSummary` projection from `monica-integration`, not raw Monica payloads or credentials.
- `scheduler` operates on confirmed command payloads, not Telegram messages or raw Monica schemas.
- `delivery` routes connector-neutral outbound message intents. The connector owns platform-specific formatting and transport calls.
- `voice-transcription` is connector-agnostic. It accepts binary upload or short-lived fetch URLs plus media metadata, never connector-native file handles.
- Enforce service-to-service auth and explicit per-endpoint caller allowlists on all internal endpoints.
- One service per Docker container. Services communicate over the Docker internal network only.
- `user-management` is the source of truth for user identity, setup tokens, credentials, and preferences, but access must be split by capability:
  - non-secret preference access for `telegram-bridge`, `ai-router`, and `scheduler`
  - audited credential access only for `monica-integration`
  - onboarding setup flows for `web-ui`
