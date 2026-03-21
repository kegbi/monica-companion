# Implementation Plan: Telegram /start Command Handler

## Objective

Enable the end-to-end onboarding entry point: when a user sends `/start` in a private Telegram chat, the bot must detect whether the user is already registered. For unregistered users, it calls `user-management POST /internal/setup-tokens` to issue a signed 15-minute setup link and sends it back in the chat. For already-registered users, it replies with a "you're already set up" message. This closes the first gap in the Phase 8 user journey.

## Scope

### In Scope

- New `/start` command handler in `telegram-bridge`.
- New `issueSetupToken()` method on the `telegram-bridge` user-management client.
- Middleware ordering change in `setupBot()` so `/start` fires before the `userResolver` middleware (which currently blocks unregistered users).
- Updated setup test to expect 2 commands (`/start` and `/disconnect`).
- New unit tests for the `/start` handler (TDD).
- New unit test for `issueSetupToken()`.
- Smoke test additions for the `/start` flow through the real Docker Compose stack.

### Out of Scope

- Web-UI onboarding form (separate roadmap item).
- Contact resolution integration (separate roadmap item).
- Token cancellation when re-issuing from `/start` (already handled by `user-management`).
- Changes to `user-management` service (the `POST /internal/setup-tokens` endpoint already exists).

## Affected Services & Packages

| Package/Service | Changes |
|-----------------|---------|
| `services/telegram-bridge` | New `/start` handler, updated user-management client, updated `setupBot()` ordering, new and updated tests |
| `packages/types` | No changes needed — `IssueSetupTokenRequest`, `IssueSetupTokenResponse` already exist |
| `services/user-management` | No changes needed — `POST /internal/setup-tokens` endpoint already exists |
| `tests/smoke` | New smoke test case for the `/start` -> setup-token issuance flow |

## Critical Design Decision: Middleware Ordering

The current `setupBot()` registers handlers in this order:
1. `privateChatOnly` middleware
2. `userResolver` middleware (blocks unregistered users, does NOT call `next()`)
3. `bot.command("disconnect", ...)`
4. Message handlers

The `/start` command **must** work for unregistered users. Since `userResolver` stops the middleware chain for unknown users, `/start` must be registered **before** `userResolver`. The handler itself will perform its own user lookup to determine the registered/unregistered branch.

New order in `setupBot()`:
1. `privateChatOnly` middleware
2. `bot.command("start", ...)` — runs before user resolution, does its own lookup
3. `userResolver` middleware
4. `bot.command("disconnect", ...)`
5. Message handlers
6. Error handler

## Implementation Steps

### Step 1: Write failing tests for the `/start` command handler

**File:** `services/telegram-bridge/src/bot/handlers/__tests__/start-command.test.ts`

Test cases:
1. **Unregistered user**: `lookupUser` returns `{ found: false }`, handler calls `issueSetupToken()` with the Telegram user ID, and sends a reply containing the setup URL.
2. **Already-registered user**: `lookupUser` returns `{ found: true, userId: "..." }`, handler does NOT call `issueSetupToken()`, and replies with an "already set up" message.
3. **Error handling**: `issueSetupToken()` throws, handler catches the error and sends a graceful fallback message.
4. **No `from` field**: `ctx.from` is undefined, handler returns early without action.

Handler signature follows the same factory pattern as `createDisconnectHandler`:

```typescript
export type IssueSetupTokenFn = (
  telegramUserId: string,
  correlationId?: string,
) => Promise<{ setupUrl: string; tokenId: string; expiresAt: string }>;

export type StartUserLookupFn = (
  connectorUserId: string,
) => Promise<{ found: true; userId: string } | { found: false }>;

export function createStartHandler(
  lookupUser: StartUserLookupFn,
  issueSetupToken: IssueSetupTokenFn,
): (ctx: BotContext) => Promise<void>;
```

### Step 2: Implement the `/start` command handler

**File:** `services/telegram-bridge/src/bot/handlers/start-command.ts`

1. Extract `ctx.from?.id`. If absent, return early.
2. Generate a `correlationId` (random UUID) for tracing.
3. Call `lookupUser(String(telegramUserId))`.
4. **If found (registered user):** Reply with "You're already set up! Send me a message or voice note to get started. Use /disconnect to unlink your account."
5. **If not found (unregistered user):** Call `issueSetupToken(String(telegramUserId), correlationId)`. Reply with welcome message including the setup URL. Explicitly state that credentials are collected through the web UI, never through Telegram chat.
6. **On error:** Reply with "Sorry, I encountered an error. Please try again later."

### Step 3: Write failing test for `issueSetupToken()` on the user-management client

**File:** `services/telegram-bridge/src/lib/__tests__/user-management-client.test.ts`

Test cases:
1. `issueSetupToken()` sends a POST to `/internal/setup-tokens` with `{ telegramUserId, step: "onboarding" }` and correct headers.
2. Returns `{ setupUrl, tokenId, expiresAt }` from the response body.
3. Throws on non-2xx response.
4. Respects the configured timeout.

### Step 4: Implement `issueSetupToken()` on the user-management client

**File:** `services/telegram-bridge/src/lib/user-management-client.ts`

Add `issueSetupToken()` method:
1. POST to `/internal/setup-tokens` with `{ telegramUserId, step: "onboarding" }`.
2. Sign JWT as `telegram-bridge` for `user-management`.
3. Parse and return the JSON response matching `IssueSetupTokenResponse`.
4. Throw on non-2xx.

### Step 5: Update `setupBot()` and its test

**Files:**
- `services/telegram-bridge/src/bot/setup.ts`
- `services/telegram-bridge/src/bot/__tests__/setup.test.ts`

Changes to `setup.ts`:
1. Add `issueSetupToken` to `SetupDeps`.
2. Import `createStartHandler`.
3. Register `/start` before `userResolver` middleware.

Changes to `setup.test.ts`:
1. Add `issueSetupToken` to mock deps.
2. Expect 2 commands (`start` before `disconnect`).
3. Verify `/start` is registered before `userResolver` middleware.

### Step 6: Wire `issueSetupToken` in `app.ts`

**File:** `services/telegram-bridge/src/app.ts`

Add `issueSetupToken` to the `setupBot` deps, delegating to the user-management client.

### Step 7: Add smoke test for the `/start` flow

**File:** `tests/smoke/services.smoke.test.ts`

Test the underlying HTTP path that `/start` triggers:
1. POST to `user-management /internal/setup-tokens` with JWT auth as `telegram-bridge`.
2. Verify 201 response with `setupUrl`, `tokenId` (UUID), `expiresAt` (future).
3. Verify `setupUrl` matches expected format.
4. Verify duplicate token handling (reissue returns different `tokenId`).

## Test Strategy

### TDD Sequence

1. **RED:** Write `start-command.test.ts` → fail (module not found).
2. **GREEN:** Create `start-command.ts` → pass.
3. **RED:** Write `user-management-client.test.ts` with `issueSetupToken` tests → fail (method missing).
4. **GREEN:** Add `issueSetupToken()` to the client → pass.
5. **RED:** Update `setup.test.ts` to expect 2 commands and `/start` before `userResolver` → fail.
6. **GREEN:** Update `setup.ts` with new ordering and deps → pass.
7. **REFACTOR:** Clean up duplication.

## Security Considerations

1. **Credentials never in chat:** The `/start` reply explicitly states credentials are collected via web UI.
2. **Setup link properties:** Signed, one-time, 15-minute TTL, bound to Telegram user ID — all enforced by `user-management`.
3. **Service-to-service auth:** `issueSetupToken()` uses signed JWT with `issuer: "telegram-bridge"`, `audience: "user-management"`.
4. **Private chat only:** `privateChatOnly` middleware runs before `/start`.
5. **No Telegram types leak:** Only string Telegram user ID crosses the service boundary.

## Risks

1. **grammY command vs. middleware ordering:** `/start` registered before `userResolver` will fire first per grammY's sequential middleware model. Handler does NOT call `next()`, so `userResolver` won't fire for `/start` messages. **Risk: LOW.**
2. **Race condition (double /start):** `user-management` handles token superseding atomically. **Risk: LOW.**
3. **`/start` with deep-link payload:** Ignored in V1. `ctx.match` available for future use. **Risk: NONE.**
