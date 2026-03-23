# Implementation Plan: Stage 4 -- Read-Only Query & Write Tool Handlers

## Objective

Replace the stub tool results in the agent loop with real handler implementations. Read-only tools (`query_birthday`, `query_phone`, `query_last_note`) call `monica-integration` directly and return structured data to the LLM. Mutating tools (`create_note`, `create_contact`, `create_activity`, `update_contact_birthday`, `update_contact_phone`, `update_contact_email`, `update_contact_address`) build a `ConfirmedCommandPayload` and call `SchedulerClient.execute()` when the user confirms. This replaces the stub execution in `handleConfirm` (loop.ts line 192-199, marked MEDIUM-3) with real scheduler integration, and replaces the "not_implemented" stubs for read-only tools (loop.ts line 518-526) with real handler calls.

## Scope

### In Scope

- Three read-only tool handler functions in `ai-router/src/agent/tool-handlers/`
- Seven mutating tool handler functions in `ai-router/src/agent/tool-handlers/`
- Zod validation schemas for the three read-only tools, added to `TOOL_ARG_SCHEMAS`
- Wire read-only handlers into the agent loop (replace "not_implemented" stubs at loop.ts line 517-527)
- Replace stub execution in `handleConfirm` (loop.ts line 190-199) with real `SchedulerClient.execute()` call
- Extend `AgentLoopDeps` interface with `schedulerClient: SchedulerClient`
- New `GET /internal/contacts/:contactId/contact-fields` endpoint on `monica-integration` (needed for `query_phone`)
- Add `ai-router` to allowed callers on `GET /internal/contact-field-types` reference route on `monica-integration` (needed for phone/email `contactFieldTypeId` resolution)
- Unit tests for each handler with mocked service clients
- Updated loop tests replacing stub expectations with real handler expectations

### Out of Scope

- Promptfoo eval updates (Stage 5)
- LangGraph dead code removal (Stage 6)
- Auto-confirmation logic (already wired; confirmation guardrail unchanged)
- Changes to `delivery`, `telegram-bridge`, or `scheduler` services
- Changes to the `GraphResponse` response contract

## Affected Services & Packages

| Package/Service | Changes |
|-----------------|---------|
| `services/ai-router` | New tool handler files in `tool-handlers/`, `loop.ts` updates (read-only dispatch + confirm execution), `tools.ts` Zod schema additions, `app.ts` dep wiring |
| `services/monica-integration` | New `contact-fields` read endpoint in `routes/read.ts`, reference route caller allowlist update in `routes/reference.ts` |
| `packages/types` | No changes -- existing `ConfirmedCommandPayload` and `MutatingCommandPayload` schemas are sufficient |
| `packages/monica-api-lib` | No changes -- existing `ContactField` schema and `getContactWithFields()` method are sufficient |

## Implementation Steps

### Step 1: Add Zod schemas for read-only query tools

**Files to modify:** `services/ai-router/src/agent/tools.ts`

Add three new Zod schemas for the read-only query tools and register them in `TOOL_ARG_SCHEMAS`:

- `QueryBirthdayArgsSchema = z.object({ contact_id: z.number().int().positive() })`
- `QueryPhoneArgsSchema = z.object({ contact_id: z.number().int().positive() })`
- `QueryLastNoteArgsSchema = z.object({ contact_id: z.number().int().positive() })`

Add all three to `TOOL_ARG_SCHEMAS`:
```
query_birthday: QueryBirthdayArgsSchema,
query_phone: QueryPhoneArgsSchema,
query_last_note: QueryLastNoteArgsSchema,
```

Export the three schemas as named exports so tests and handlers can reference them.

**Expected outcome:** All tool calls (read-only and mutating) are validated against Zod schemas in the loop before execution. On validation failure, an error tool result is returned to the LLM for self-correction. The existing validation logic at loop.ts line 441-470 and line 492-503 already uses `TOOL_ARG_SCHEMAS`, so no loop changes are needed for this step.

---

### Step 2: Add contact-fields read endpoint on `monica-integration`

**Files to modify:** `services/monica-integration/src/routes/read.ts`

Add a `GET /contacts/:contactId/contact-fields` endpoint with `aiRouterAuth` (allowed callers: `["ai-router"]`).

Implementation:
1. Extract `userId`, `correlationId`, `contactId` using existing patterns (`requireUserId`, `getCorrelationId`, param parsing).
2. Validate `contactId` is a positive finite number (same guard as existing endpoints).
3. Call `client.getContactWithFields(contactId)` (existing method on `MonicaApiClient` in `@monica-companion/monica-api-lib`).
4. Import `ContactField` schema from `@monica-companion/monica-api-lib`.
5. Parse each entry in the returned `contactFields` array using `ContactField.safeParse()`. Skip entries that fail parsing.
6. Return a Monica-agnostic response:
   ```json
   {
     "data": [
       { "fieldId": 42, "type": "phone", "typeName": "Phone", "typeId": 2, "value": "+1-555-1234" },
       { "fieldId": 43, "type": "email", "typeName": "Email", "typeId": 1, "value": "jane@example.com" }
     ]
   }
   ```
   Where `type` = `contact_field_type.type`, `typeName` = `contact_field_type.name`, `typeId` = `contact_field_type.id`, `value` = `content`.

Use `handleMonicaError` for error handling, same as other read routes.

**Why this is needed:** The `query_phone` handler needs contact field data. The existing `GET /internal/contacts/:contactId` endpoint returns a `ContactResolutionSummary` which does not include phone or email fields. This new endpoint exposes contact fields through the anti-corruption layer.

---

### Step 3: Add `ai-router` to reference routes allowed callers

**Files to modify:** `services/monica-integration/src/routes/reference.ts`

Change the `schedulerAuth` middleware's `allowedCallers` from `["scheduler"]` to `["scheduler", "ai-router"]` at line 18. This allows `ai-router` to call `GET /internal/contact-field-types` to resolve the `contactFieldTypeId` for "phone" and "email" types at runtime.

**Why this is needed:** The `ConfirmedCommandPayload` for `update_contact_phone` and `update_contact_email` requires `contactFieldTypeId` -- an account-specific Monica integer ID. The LLM does not know these IDs. The mutating handler must resolve them by querying `monica-integration`.

---

### Step 4: Implement read-only tool handlers

**Files to create:**
- `services/ai-router/src/agent/tool-handlers/query-birthday.ts`
- `services/ai-router/src/agent/tool-handlers/query-phone.ts`
- `services/ai-router/src/agent/tool-handlers/query-last-note.ts`

Each handler follows the same structural pattern as `search-contacts.ts`: accepts a typed params object with `serviceClient`, `userId`, `correlationId`, and tool-specific fields; returns a discriminated union of `{ status: "ok", ... }` or `{ status: "error", message }`.

#### `query-birthday.ts`

- **Params:** `{ contactId: number; serviceClient: ServiceClient; userId: string; correlationId: string }`
- **Response:** `{ status: "ok"; birthday: string | null; isYearUnknown: boolean; contactId: number } | { status: "error"; message: string }`
- **Implementation:** Call `serviceClient.fetch("/internal/contacts/${contactId}", { userId, correlationId, signal: AbortSignal.timeout(30_000) })`. The response is a `ContactResolutionSummary` object. Extract the `importantDates` entry with `label === "birthdate"`. Return `{ status: "ok", birthday: date || null, isYearUnknown, contactId }`.
- **Error handling:** Catch fetch errors, check response.ok. Return structured error.

#### `query-phone.ts`

- **Params:** `{ contactId: number; serviceClient: ServiceClient; userId: string; correlationId: string }`
- **Response:** `{ status: "ok"; phones: Array<{ value: string; typeName: string }>; contactId: number } | { status: "error"; message: string }`
- **Implementation:** Call `serviceClient.fetch("/internal/contacts/${contactId}/contact-fields", { userId, correlationId, signal: AbortSignal.timeout(30_000) })`. Parse the response `{ data: [...] }`. Filter for entries where `type === "phone"`. Return phone values with type names.

#### `query-last-note.ts`

- **Params:** `{ contactId: number; serviceClient: ServiceClient; userId: string; correlationId: string }`
- **Response:** `{ status: "ok"; note: { body: string; createdAt: string } | null; contactId: number } | { status: "error"; message: string }`
- **Implementation:** Call `serviceClient.fetch("/internal/contacts/${contactId}/notes?limit=1", { userId, correlationId, signal: AbortSignal.timeout(30_000) })`. Parse the response `{ data: [...] }`. Return the first note's `body` and `createdAt`, or `null` if the array is empty.

---

### Step 5: Implement mutating tool handlers

**Files to create:**
- `services/ai-router/src/agent/tool-handlers/mutating-handlers.ts`

All seven mutating handlers are in a single file because they share a common pattern: map LLM tool call args (snake_case) to a `ConfirmedCommandPayload` (camelCase), then call `SchedulerClient.execute()`.

**Primary function:**

```typescript
export async function executeMutatingTool(params: {
  toolName: string;
  args: Record<string, unknown>;
  userId: string;
  correlationId: string;
  pendingCommandId: string;
  schedulerClient: SchedulerClient;
  monicaServiceClient: ServiceClient;
}): Promise<{ status: "success"; executionId: string } | { status: "error"; message: string }>
```

The function:
1. Switches on `toolName` to build the appropriate `MutatingCommandPayload` from the tool args.
2. Wraps the payload in a `ConfirmedCommandPayload`:
   - `pendingCommandId`: from params
   - `userId`: from params
   - `commandType`: `toolName` (matches `MutatingCommandType` enum values)
   - `payload`: the mapped payload
   - `idempotencyKey`: `"${pendingCommandId}:v1"`
   - `correlationId`: from params
   - `confirmedAt`: `new Date().toISOString()`
3. Calls `schedulerClient.execute(confirmedPayload)`.
4. Returns `{ status: "success", executionId }` on success.
5. Catches errors and returns `{ status: "error", message }`.

**Per-tool arg-to-payload mapping:**

| Tool | Tool args (snake_case) | Payload fields (camelCase) | Notes |
|------|----------------------|---------------------------|-------|
| `create_note` | `contact_id`, `body` | `type: "create_note"`, `contactId`, `body` | Direct mapping |
| `create_contact` | `first_name`, `last_name?`, `gender_id?` | `type: "create_contact"`, `firstName`, `lastName?`, `genderId` | Default `genderId` to 3 ("Rather not say") |
| `create_activity` | `contact_ids`, `description`, `activity_type?`, `date?` | `type: "create_activity"`, `contactIds`, `summary`, `happenedAt` | Map `description` to `summary`; default `happenedAt` to today's ISO date; set `activityTypeId` to null (V1 pragmatism) |
| `update_contact_birthday` | `contact_id`, `date`, `is_age_based?` | `type: "update_contact_birthday"`, `contactId`, `day`, `month`, `year?` | Parse `date` string "YYYY-MM-DD" into `{ day, month, year }` |
| `update_contact_phone` | `contact_id`, `phone_number` | `type: "update_contact_phone"`, `contactId`, `value`, `contactFieldTypeId` | Resolve `contactFieldTypeId` via `fetchContactFieldTypeId("phone")` |
| `update_contact_email` | `contact_id`, `email` | `type: "update_contact_email"`, `contactId`, `value`, `contactFieldTypeId` | Resolve `contactFieldTypeId` via `fetchContactFieldTypeId("email")` |
| `update_contact_address` | `contact_id`, `street?`, `city?`, `province?`, `postal_code?`, `country?` | `type: "update_contact_address"`, `contactId`, `street?`, `city?`, `province?`, `postalCode?`, `country` | Map `postal_code` to `postalCode`; default `country` to "US" |

**Helper functions in the same file:**

`fetchContactFieldTypeId(serviceClient, userId, correlationId, typeString)`:
- Calls `serviceClient.fetch("/internal/contact-field-types", { userId, correlationId, signal: AbortSignal.timeout(10_000) })`.
- Parses the response `{ data: [{ id, name, type }] }`.
- Finds the entry where `type === typeString` (e.g., "phone" or "email").
- Returns the `id`.
- Throws if the type is not found or fetch fails.

`parseDateString(dateStr: string): { day: number; month: number; year?: number }`:
- Splits "YYYY-MM-DD" and returns `{ day, month, year }`.
- If parsing fails, throws with a descriptive error.

---

### Step 6: Wire read-only handlers into the agent loop

**Files to modify:** `services/ai-router/src/agent/loop.ts`

**Changes at the top of the file:**

1. Import the three new handler functions:
   ```typescript
   import { handleQueryBirthday } from "./tool-handlers/query-birthday.js";
   import { handleQueryPhone } from "./tool-handlers/query-phone.js";
   import { handleQueryLastNote } from "./tool-handlers/query-last-note.js";
   ```
2. Import the three new Zod schemas from `./tools.js`:
   ```typescript
   import { QueryBirthdayArgsSchema, QueryPhoneArgsSchema, QueryLastNoteArgsSchema } from "./tools.js";
   ```
   (Add to existing import statement.)

**Changes in the tool dispatch loop (line 517-527):**

Replace the `else` block that returns `"not_implemented"` stubs with dispatch logic for each read-only tool. Add `else if` branches for `query_birthday`, `query_phone`, `query_last_note` before a final `else` that returns an unknown-tool error.

For each read-only tool, follow the same pattern as `search_contacts` (line 475-516):
1. Parse JSON arguments.
2. Validate with the corresponding Zod schema from `TOOL_ARG_SCHEMAS`.
3. On validation failure, push error tool result and continue.
4. On success, call the handler with `{ contactId: validatedArgs.contact_id, serviceClient: deps.monicaServiceClient, userId, correlationId }`.
5. Push the handler result as a tool result message.

The final `else` branch handles truly unknown tools:
```typescript
} else {
  toolResults.push({
    role: "tool",
    tool_call_id: toolCall.id,
    content: JSON.stringify({
      status: "error",
      message: `Unknown tool "${toolName}".`,
    }),
  });
}
```

---

### Step 7: Extend `AgentLoopDeps` and replace `handleConfirm` stub with real execution

**Files to modify:**
- `services/ai-router/src/agent/loop.ts`
- `services/ai-router/src/app.ts`

**`AgentLoopDeps` changes (loop.ts line 38-50):**
- Add `schedulerClient: SchedulerClient` field.
- Add import: `import type { SchedulerClient } from "../lib/scheduler-client.js";`

**`app.ts` wiring (line 71-78):**
- Add `schedulerClient` to `agentDeps`:
  ```typescript
  const agentDeps = {
    llmClient,
    db,
    getHistory,
    saveHistory,
    pendingCommandTtlMinutes: config.pendingCommandTtlMinutes,
    monicaServiceClient: monicaIntegrationServiceClient,
    schedulerClient,  // ADD THIS
  };
  ```

**`handleConfirm` changes (loop.ts line 178-220):**

1. Import `executeMutatingTool` from `./tool-handlers/mutating-handlers.js`.
2. Replace lines 190-199 (the stub tool result construction) with:
   - Parse `pendingToolCall.arguments` to get the tool args.
   - Call `executeMutatingTool({ toolName: pendingToolCall.name, args: parsedArgs, userId, correlationId, pendingCommandId: pendingToolCall.pendingCommandId, schedulerClient: deps.schedulerClient, monicaServiceClient: deps.monicaServiceClient })`.
   - Build the tool result from the handler response:
     - On `{ status: "success" }`: `{ status: "success", executionId, message: "Action executed successfully." }`
     - On `{ status: "error" }`: `{ status: "error", message: handlerResult.message }`
   - Use this as `toolResult` instead of `stubToolResult`.
3. The rest of `handleConfirm` (calling LLM for success message, saving history) stays unchanged.

---

### Step 8: Update existing tests

**Files to modify:**
- `services/ai-router/src/agent/__tests__/loop.test.ts`

**Changes to `createMockDeps`:**
- Add `schedulerClient: { execute: vi.fn().mockResolvedValue({ executionId: "exec-1", status: "queued" }) }` to the default deps.

**Test: "still provides stub results for other read-only tools" (line 301-363):**
- This test expects `not_implemented` in the tool result for `query_birthday`. After Stage 4, the tool dispatches to a real handler. Update the test:
  - Mock the `handleQueryBirthday` module.
  - Set mock return value to `{ status: "ok", birthday: "1990-05-15", isYearUnknown: false, contactId: 1 }`.
  - Assert the tool result passed to the second LLM call contains `"1990-05-15"` instead of `"not_implemented"`.

**Test: "on confirm" callback (line 703-747):**
- This test expects a stub `"Tool ... executed successfully"` message. After Stage 4, confirm triggers real execution. Update the test:
  - Mock the `executeMutatingTool` module.
  - Set mock return value to `{ status: "success", executionId: "exec-123" }`.
  - Assert `executeMutatingTool` was called with correct `toolName`, `args`, `userId`, `correlationId`.
  - Assert the tool result passed to the LLM contains `"success"`.

**New test cases to add:**
- Confirm callback with scheduler error: mock `executeMutatingTool` returning `{ status: "error", message: "scheduler timeout" }`. Assert the LLM still gets called with the error result and generates a failure message.
- Read-only tool validation failure: `query_birthday` with `{ contact_id: -1 }` returns validation error tool result.

---

## Test Strategy

### Unit Tests (Vitest) -- what to test, what to mock

#### Read-only handler tests (`tool-handlers/__tests__/`)

**`query-birthday.test.ts`** (~6 tests):
- Mock: `serviceClient.fetch` (returns mock response)
- Test: successful birthday lookup (importantDates has birthdate entry)
- Test: contact has no birthday (importantDates empty) -> returns `{ birthday: null }`
- Test: contact has birthday with unknown year -> returns `{ isYearUnknown: true }`
- Test: fetch error -> returns `{ status: "error" }`
- Test: non-200 response -> returns `{ status: "error" }`
- Test: correct URL path and headers passed to serviceClient.fetch

**`query-phone.test.ts`** (~6 tests):
- Mock: `serviceClient.fetch`
- Test: contact has phone fields -> returns phone values
- Test: contact has no phone fields -> returns empty array
- Test: contact has multiple phone fields -> returns all
- Test: fetch error -> returns `{ status: "error" }`
- Test: non-200 response -> returns error
- Test: correct URL path

**`query-last-note.test.ts`** (~5 tests):
- Mock: `serviceClient.fetch`
- Test: contact has notes -> returns first note body and createdAt
- Test: contact has no notes -> returns `{ note: null }`
- Test: fetch error -> returns `{ status: "error" }`
- Test: non-200 response -> returns error
- Test: limit=1 query parameter in URL

**`mutating-handlers.test.ts`** (~15 tests):
- Mock: `schedulerClient.execute`, `serviceClient.fetch` (for contactFieldTypeId lookup)
- Test: `create_note` -> schedulerClient.execute called with correct ConfirmedCommandPayload
- Test: `create_contact` -> firstName/lastName/genderId mapped correctly
- Test: `create_contact` without genderId defaults to 3
- Test: `create_activity` -> description maps to summary, date maps to happenedAt
- Test: `create_activity` without date defaults to today
- Test: `update_contact_birthday` -> date parsed into day/month/year
- Test: `update_contact_phone` -> contactFieldTypeId fetched from monica-integration
- Test: `update_contact_email` -> contactFieldTypeId fetched from monica-integration
- Test: `update_contact_address` -> postal_code maps to postalCode, default country
- Test: scheduler error -> returns `{ status: "error" }`
- Test: `fetchContactFieldTypeId` returns correct ID for "phone"
- Test: `fetchContactFieldTypeId` throws when type not found
- Test: `parseDateString` parses "2024-03-15" correctly
- Test: `parseDateString` throws on invalid format
- Test: unknown tool name -> returns error

#### Monica-integration endpoint test

**`services/monica-integration/src/__tests__/contact-fields-read.test.ts`** (~4 tests):
- Mock: `createMonicaClient` -> returns contact with contactFields
- Test: returns phone and email fields in Monica-agnostic format
- Test: invalid contactId -> returns 400
- Test: Monica API error -> returns error via handleMonicaError
- Test: unparseable contact fields are skipped (safeParse failure)

### TDD sequence (which failing test to write first for each step)

1. **Step 1:** Test `TOOL_ARG_SCHEMAS["query_birthday"]` exists and validates `{ contact_id: 1 }` but rejects `{}`. Write test first, then add schema.
2. **Step 2:** Test the `GET /contacts/:contactId/contact-fields` endpoint returns the expected response shape with mocked Monica data. Write test first, then add route.
3. **Step 3:** Test that `GET /internal/contact-field-types` accepts `ai-router` as caller. Write test first, then update allowedCallers.
4. **Step 4:** For each read handler, write test asserting `{ status: "ok", ... }` with mocked fetch. Then implement handler.
5. **Step 5:** Write test asserting `executeMutatingTool("create_note", ...)` calls `schedulerClient.execute` with correct payload shape. Then implement.
6. **Step 6:** Write test that `query_birthday` tool call in the loop dispatches to the mocked handler (not stub). Then wire it.
7. **Step 7:** Write test that confirm callback calls `executeMutatingTool`. Then replace stub.

## Smoke Test Strategy

### Docker Compose services to start

```bash
docker compose --profile app up -d caddy telegram-bridge ai-router monica-integration scheduler delivery user-management postgres redis
```

### HTTP checks to run

1. **Health checks** -- verify all services are up
2. **Read-only query flow** -- POST to ai-router's /internal/process with service auth JWT
3. **Confirm flow** -- send a mutating text message, get confirmation_prompt, then confirm
4. **New contact-fields endpoint** -- directly hit monica-integration

## Security Considerations

1. **Service boundary enforcement**: Read-only tools call `monica-integration` directly, bypassing scheduler. Mutating tools go through `scheduler` via `SchedulerClient.execute()`.
2. **Per-endpoint caller allowlists**: New `contact-fields` endpoint allows only `["ai-router"]`. Reference routes update: `["scheduler", "ai-router"]`.
3. **Zod validation on all inbound contracts**: All tool arguments validated before execution.
4. **No credential exposure**: Read-only handlers receive a `ServiceClient` (JWT signing is internal).
5. **Sensitive data redaction**: No personal data in log output.
6. **Timeout handling**: All `serviceClient.fetch` calls use `AbortSignal.timeout(30_000)`.

## Risks & Open Questions

1. **`contactFieldTypeId` is account-specific.** Fetched at runtime via `GET /internal/contact-field-types`. Caching deferred to future.
2. **`country` field required for address payload.** Default to `"US"` when not provided.
3. **`genderId` for contact creation.** Default to `3` ("Rather not say") when not provided.
4. **Date parsing for birthday updates.** Must handle "YYYY-MM-DD" format.
5. **Activity type resolution.** Set `activityTypeId` to `null` for V1.
6. **`contactFields` typed as `z.array(z.unknown())`.**  Parse each entry with `ContactField.safeParse()` and skip failures.
7. **Existing loop test assumptions.** Several tests assert stub behavior and must be updated.
