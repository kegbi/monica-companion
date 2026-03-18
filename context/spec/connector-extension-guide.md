# Connector Extension Guide

This document describes how to add a new messaging connector (e.g., WhatsApp, Signal, Matrix) to the Monica Companion platform.

## Architecture Overview

The platform uses a connector-neutral architecture. All core services (ai-router, scheduler, delivery, voice-transcription, monica-integration) operate on connector-agnostic contracts. Only the connector bridge service (e.g., telegram-bridge) contains platform-specific logic.

## Connector-Neutral Contracts

The following shared types are connector-neutral by design:

- **`OutboundMessageIntentSchema`** -- `connectorType` is `z.string().min(1)` (not an enum). Any non-empty string is valid at the schema level. The delivery service's connector registry provides runtime validation.
- **`InboundEventSchema`** -- Uses opaque `sourceRef` strings. No connector types are embedded.
- **`ConfirmedCommandPayloadSchema`** -- Optional `connectorType` and `connectorRoutingId` fields. When absent, the scheduler resolves them from user-management.
- **`TranscriptionRequestMetadataSchema`** -- Binary upload or fetch URL. No connector-native file handles.

## Steps to Add a New Connector

### 1. Create the Bridge Service

Create a new service (e.g., `services/whatsapp-bridge/`) that:

- Receives inbound messages from the platform API (webhook or polling)
- Transforms them into `InboundEvent` objects and sends to ai-router
- Receives `OutboundMessageIntent` via `POST /internal/send` and formats for the platform
- Handles platform-specific authentication and rate limiting

### 2. Register the Connector URL in Delivery

Add a `CONNECTOR_URL_<TYPE>` environment variable in Docker Compose:

```yaml
delivery:
  environment:
    CONNECTOR_URL_TELEGRAM: http://telegram-bridge:3009
    CONNECTOR_URL_WHATSAPP: http://whatsapp-bridge:3010
```

The delivery service automatically discovers connectors from `CONNECTOR_URL_` prefixed env vars. The connector type is derived from the suffix (lowercased).

The JWT audience for the connector is derived as `${connectorType}-bridge` (e.g., `whatsapp-bridge`).

### 3. Allow the Connector as an Inbound Caller

Update `INBOUND_ALLOWED_CALLERS` on services that the connector calls:

```yaml
ai-router:
  environment:
    INBOUND_ALLOWED_CALLERS: telegram-bridge,whatsapp-bridge

voice-transcription:
  environment:
    INBOUND_ALLOWED_CALLERS: telegram-bridge,whatsapp-bridge
```

Default value is `telegram-bridge` for backward compatibility.

### 4. Add Connector-Specific User Lookup

In `services/user-management/src/app.ts`, add a `case` to the connector user lookup switch:

```typescript
switch (connectorType) {
  case "telegram": {
    const user = await findUserByTelegramId(db, connectorUserId);
    // ...
  }
  case "whatsapp": {
    const user = await findUserByWhatsappId(db, connectorUserId);
    // ...
  }
  default:
    return c.json({ error: "Unsupported connector type" }, 400);
}
```

This also requires adding the corresponding database column and repository function.

### 5. Store User Preferences with Connector Type

The `user_preferences` table stores `connector_type` and `connector_routing_id`. When a user registers via the new connector, these fields must be populated with the appropriate values.

### 6. Update Auth Allowlists

Add the new bridge service to:

- `user-management` telegramBridgeAuth (or create a separate auth for the new connector)
- The delivery service already accepts any connector via the registry

## Design Tradeoffs

- **`connectorType` is `z.string().min(1)` rather than a Zod enum.** This means typos are not caught at schema validation time. Instead, the delivery connector registry catches invalid types at runtime (400 response). This tradeoff enables adding connectors without modifying the shared types package.

- **`INBOUND_ALLOWED_CALLERS` defaults to `["telegram-bridge"]`.** New connectors must be explicitly added via environment variables. This keeps the default restrictive for security.

- **Scheduler resolves connector routing from user-management.** When `connectorType`/`connectorRoutingId` are not in the confirmed command payload, the scheduler fetches them from the user's schedule preferences. This avoids requiring ai-router to carry connector routing metadata.

## Boundary Enforcement

Static analysis tests in each connector-neutral service verify that:

1. No hardcoded `"telegram"` string literals appear in non-test source files
2. No imports from `grammy` or Telegram-specific packages exist

These tests are located at `services/<name>/src/__tests__/connector-neutrality.test.ts`.
