# Implementation Plan: Contact Resolution Integration into LangGraph Pipeline

## Objective

Wire the existing contact resolution infrastructure (`ai-router/src/contact-resolution/`) into the LangGraph conversation graph so that when the LLM produces a `contactRef` string for a mutating command or read query, the system resolves it against real Monica contact data via `monica-integration` before creating the pending command. This replaces the current behavior where the LLM fabricates disambiguation options and contact IDs with a deterministic resolution pipeline backed by real user data.

## Scope

### In Scope

- Add a `resolveContactRef` graph node between `classifyIntent` and `executeAction`
- Retype the provisional `resolvedContact` graph state field to hold a proper `ContactResolutionResult`
- Add a `contactSummariesCache` field to graph state for per-invocation caching
- When resolution returns `resolved`, inject `contactId` into the command payload automatically
- When resolution returns `ambiguous`, produce a disambiguation prompt with real contact data (display names, relationship labels) as inline keyboard button options
- When resolution returns `no_match`, produce a clarification prompt asking the user to clarify or offering to create a new contact
- Skip contact resolution for `create_contact` commands (which create new contacts) and for intents without a `contactRef`
- Ensure the contact summary list is fetched at most once per graph invocation
- Wire the `ServiceClient` for `monica-integration` into the graph config

### Out of Scope

- Changes to `monica-integration` endpoints (the `/internal/contacts/resolution-summaries` endpoint already exists and works)
- Changes to the matcher algorithm scoring or thresholds
- Changes to the Telegram-side rendering of disambiguation buttons (already handled by `telegram-bridge`)
- Incremental contact cache across graph invocations (future optimization)
- Multi-language kinship mapping (the KINSHIP_MAP is English-only in V1, which is a documented limitation)

## Affected Services & Packages

| Package/Service | Changes |
|-----------------|---------|
| `services/ai-router` | New `resolveContactRef` graph node; state schema changes; graph topology update; `executeAction` and `formatResponse` adjustments; new graph config dependency; tests |
| `packages/types` | No changes needed -- `ContactResolutionResult`, `ContactResolutionSummary`, `ContactMatchCandidate` already exist |
| `services/monica-integration` | No changes needed -- endpoint already exists |

## Implementation Steps

### Step 1: Retype Graph State for Contact Resolution

**What:** Replace the provisional `resolvedContact: Record<string, unknown> | null` with two properly typed fields:
- `contactResolution: ContactResolutionResult | null` -- the outcome of resolving the current `contactRef`
- `contactSummariesCache: ContactResolutionSummary[] | null` -- the cached list of contact summaries loaded once per invocation

**Files to modify:**
- `services/ai-router/src/graph/state.ts` -- update `ConversationStateSchema` and `ConversationAnnotation`

**Details:**
- Import `ContactResolutionResult` and `ContactResolutionSummary` from `@monica-companion/types`
- Replace `resolvedContact` with `contactResolution` (typed as `ContactResolutionResult | null`, default `null`)
- Add `contactSummariesCache` (typed as `ContactResolutionSummary[] | null`, default `null`)
- Remove the old `resolvedContact` field entirely

**TDD sequence:**
1. Write a failing test in `services/ai-router/src/graph/__tests__/state.test.ts` that validates a `ConversationStateSchema` with the new `contactResolution` field holding a valid `ContactResolutionResult` object
2. Write a failing test that confirms the old `resolvedContact` field is no longer accepted
3. Update the schema in `state.ts` to pass both tests

**Expected outcome:** Graph state accepts `ContactResolutionResult` objects in the `contactResolution` field. All existing test `makeState()` helpers will break (they reference `resolvedContact: null`) and need updating.

### Step 2: Update All Test Helpers for New State Shape

**What:** Fix all test files that create mock graph state objects so they use `contactResolution: null` and `contactSummariesCache: null` instead of `resolvedContact: null`.

**Files to modify:**
- `services/ai-router/src/graph/nodes/__tests__/execute-action.test.ts`
- `services/ai-router/src/graph/nodes/__tests__/classify-intent.test.ts`
- `services/ai-router/src/graph/nodes/__tests__/deliver-response.test.ts`
- `services/ai-router/src/graph/nodes/__tests__/format-response.test.ts`
- `services/ai-router/src/graph/nodes/__tests__/load-context.test.ts`
- `services/ai-router/src/graph/nodes/__tests__/persist-turn.test.ts`
- `services/ai-router/src/graph/nodes/__tests__/node-spans.test.ts`
- `services/ai-router/src/graph/__tests__/graph.test.ts`

**Details:** In each `makeState()` function, replace `resolvedContact: null` with `contactResolution: null, contactSummariesCache: null`.

**TDD sequence:**
1. Run existing tests -- they all fail because `resolvedContact` no longer exists in the schema
2. Update each `makeState()` helper
3. All existing tests pass again

**Expected outcome:** All existing tests compile and pass with the new state shape.

### Step 3: Create the `resolveContactRef` Graph Node

**What:** Create a new graph node that runs between `classifyIntent` and `executeAction`. When the intent classification contains a non-null `contactRef` and the intent is `mutating_command` or `read_query` (and the command type is not `create_contact`), this node:
1. Fetches contact summaries from `monica-integration` via the existing `fetchContactSummaries` client (or uses cached summaries if already loaded in this invocation)
2. Runs the deterministic `matchContacts` + threshold logic from the existing `resolveContact` flow
3. Stores the `ContactResolutionResult` and the raw summaries cache in graph state
4. Based on the resolution outcome, modifies the intent classification:
   - **resolved**: Injects `contactId` into `commandPayload` and clears `needsClarification`
   - **ambiguous**: Sets `needsClarification = true`, `clarificationReason = "ambiguous_contact"`, and populates `disambiguationOptions` with real contact data (label: `"{displayName} -- {relationshipLabel}"`, value: `"{contactId}"`)
   - **no_match**: Sets `needsClarification = true`, `clarificationReason = "ambiguous_contact"`, and sets `userFacingText` to a prompt asking the user to clarify or offering to create a new contact

**Files to create:**
- `services/ai-router/src/graph/nodes/resolve-contact-ref.ts`

**Dependencies:**
- `fetchContactSummaries` from `../../contact-resolution/client.js`
- `matchContacts` from `../../contact-resolution/matcher.js`
- Resolution threshold constants from `../../contact-resolution/resolver.js`
- `ServiceClient` from `@monica-companion/auth`
- `ContactResolutionResult`, `ContactResolutionSummary` from `@monica-companion/types`

**Interface:**
```typescript
export interface ResolveContactRefDeps {
  monicaIntegrationClient: ServiceClient;
}
```

The node function receives `ServiceClient` (for `monica-integration`) as injected dependency. It does NOT need database access.

**Key behaviors:**
- If `intentClassification` is null, or `contactRef` is null, or `commandType` is `create_contact`, or intent is `greeting`/`out_of_scope`: pass through without calling Monica, return `{}` (no state changes)
- If `contactSummariesCache` is already populated in state (from a prior node run -- not applicable in current linear graph, but defensive): use it instead of re-fetching
- On `fetchContactSummaries` failure: log warning, set `contactResolution` to a no_match result with the original `contactRef`, and let `executeAction` proceed with the LLM's original (potentially incomplete) payload. This is a graceful degradation path.
- On `resolved`: mutate `intentClassification` to inject `contactId` into `commandPayload`, set `needsClarification = false`
- On `ambiguous`: mutate `intentClassification` to set `needsClarification = true`, `clarificationReason = "ambiguous_contact"`, populate `disambiguationOptions` from real candidates
- On `no_match`: mutate `intentClassification` to set `needsClarification = true`, `clarificationReason = "ambiguous_contact"`, update `userFacingText` to ask for clarification

**TDD sequence:**
1. Write a failing test: given a `mutating_command` with `contactRef = "John Doe"` and a mock service client returning summaries with one exact match, the node should return `contactResolution` with `outcome: "resolved"` and update `intentClassification.commandPayload.contactId`
2. Write a failing test: given `contactRef = "Sherry"` and two Sherrys in summaries, the node should return `contactResolution` with `outcome: "ambiguous"` and set `disambiguationOptions` with real data
3. Write a failing test: given `contactRef = "Xavier"` with no matches, the node should return `contactResolution` with `outcome: "no_match"` and set `needsClarification = true`
4. Write a failing test: given `commandType = "create_contact"`, the node should skip resolution entirely
5. Write a failing test: given a service client that throws, the node should gracefully degrade
6. Write a failing test: given `contactRef = null`, the node should skip resolution
7. Implement the node to pass all tests

**Test file to create:**
- `services/ai-router/src/graph/nodes/__tests__/resolve-contact-ref.test.ts`

### Step 4: Wire the Node into the Graph Topology

**What:** Insert `resolveContactRef` between `classifyIntent` and `executeAction` in the graph definition. Update the `ConversationGraphConfig` to accept a `ServiceClient` for `monica-integration`.

**Files to modify:**
- `services/ai-router/src/graph/graph.ts` -- add the node to the graph, update edges, update config interface

**Details:**
- Add `monicaIntegrationClient: ServiceClient` to `ConversationGraphConfig`
- Import and create the `resolveContactRef` node
- Change edge: `classifyIntent -> resolveContactRef -> executeAction`
- New topology: `START -> loadContext -> classifyIntent -> resolveContactRef -> executeAction -> formatResponse -> deliverResponse -> persistTurn -> END`

**TDD sequence:**
1. Write a failing test in `services/ai-router/src/graph/__tests__/graph.test.ts` that verifies the graph config now requires `monicaIntegrationClient`
2. Write a failing test that verifies the graph processes a greeting through all 7 nodes (including the new one)
3. Update `graph.ts` to add the node
4. Update `makeConfig()` in graph tests to include the new dependency

### Step 5: Wire the ServiceClient in the App

**What:** Pass the `monicaIntegrationClient` (ServiceClient for `monica-integration`) from `app.ts` into the graph config. This client already exists in `app.ts` (used by `contactResolutionRoutes`).

**Files to modify:**
- `services/ai-router/src/app.ts` -- create a `monicaIntegrationServiceClient` and pass it to `createConversationGraph`

**Details:**
- A `ServiceClient` for `monica-integration` is already created inline in `contactResolutionRoutes()`. Extract the creation to `app.ts` so it can be shared:
  ```typescript
  const monicaIntegrationServiceClient = createServiceClient({
    issuer: "ai-router",
    audience: "monica-integration",
    secret: jwtSecret,
    baseUrl: config.monicaIntegrationUrl,
  });
  ```
- Pass `monicaIntegrationClient: monicaIntegrationServiceClient` to `createConversationGraph`
- Also pass the same `ServiceClient` to `contactResolutionRoutes` to avoid creating a second instance

**TDD sequence:**
1. This is wiring code. Verify by checking the app compiles and the graph receives the dependency.
2. The smoke tests in Step 8 validate the real network path.

### Step 6: Update `executeAction` to Respect Contact Resolution

**What:** Modify `executeAction` to use the `contactResolution` state when handling mutating commands.

**Files to modify:**
- `services/ai-router/src/graph/nodes/execute-action.ts`

**Details:**
- In `handleMutatingCommand`: when `contactResolution` exists with `outcome: "resolved"`, ensure `contactId` is in the payload (the `resolveContactRef` node already injects it, but `executeAction` should not override it)
- In `handleMutatingCommand`: when `contactResolution` exists with `outcome: "ambiguous"` or `outcome: "no_match"`, the `resolveContactRef` node already set `needsClarification = true`, so the existing `if (intentClassification.needsClarification)` path applies -- the command stays in `draft` status
- Key insight: The `resolveContactRef` node mutates `intentClassification` in state before `executeAction` runs, so `executeAction` mostly works as-is. The main change is removing the assumption that LLM-provided `contactId` values are real Monica IDs (they are fabricated). Instead, only trust `contactId` values that came from contact resolution.
- For `handleSelect`: the existing logic already parses the selected value as a `contactId` number and merges it into the draft payload. This works correctly with real contact IDs from disambiguation options. No changes needed here.

**TDD sequence:**
1. Write a failing test: when `contactResolution` has `outcome: "resolved"` and the intent is `mutating_command` with the resolved `contactId` already in the payload, verify the pending command is created with the correct `contactId`
2. Write a failing test: when `contactResolution` has `outcome: "ambiguous"`, verify the pending command stays in `draft` (this should already work because `needsClarification` is set by the resolver node)
3. Implement any needed adjustments

**Test file to modify:**
- `services/ai-router/src/graph/nodes/__tests__/execute-action.test.ts`

### Step 7: Update `formatResponse` for Real Disambiguation Data

**What:** Verify that `formatResponse` correctly renders disambiguation prompts using the real contact data options set by `resolveContactRef`. The options are already in `disambiguationOptions` format (`{ label, value }`), so `formatResponse` should work without changes.

**Files to verify (no changes expected):**
- `services/ai-router/src/graph/nodes/format-response.ts`

**Details:**
- `resolveContactRef` populates `disambiguationOptions` with `{ label: "Sherry Miller -- friend", value: "20" }` format
- `formatResponse` already checks `needsClarification && disambiguationOptions.length > 0` and produces `disambiguation_prompt` type
- The `deliver-response` node already maps `disambiguation_prompt` to the outbound message schema
- No changes needed in `formatResponse`, but add a test confirming the integration

**TDD sequence:**
1. Write a test in `format-response.test.ts` that verifies disambiguation with real-data-style options (contactId as value, display name + relationship label as label)
2. Verify it passes with the existing implementation

### Step 8: Smoke Tests

**What:** Add a smoke test that verifies the real network path: a text message with a contact reference flows through `ai-router -> monica-integration -> ai-router` and produces contact-resolved output.

**Files to create:**
- `services/ai-router/src/__smoke__/contact-resolution.smoke.test.ts`

**Details:**
- The smoke test requires a running `ai-router`, `monica-integration`, and `user-management` stack with real (or mocked) Monica data
- Since the LLM smoke tests run with real OpenAI API keys but NOT real Monica instances, the contact resolution will call `monica-integration` which attempts to reach the user's Monica instance. For smoke tests with no real Monica, the resolution will fail gracefully (returning no_match or error), and the LLM will fall through to asking for clarification
- A more meaningful smoke test would be to use the `POST /internal/resolve-contact` HTTP endpoint directly (which already exists) to verify the network path without needing real Monica data
- Test cases:
  1. Send a `POST /internal/resolve-contact` request with a `contactRef` and verify the response shape matches `ContactResolutionResult`
  2. Send a text message through `/internal/process` with a contact reference and verify the response is not an error (graceful degradation when Monica is unavailable)

**Docker Compose services to start:** `ai-router`, `monica-integration`, `user-management`, `postgres`, `redis`

**What the smoke test proves:**
- The `ai-router` successfully creates a `ServiceClient` for `monica-integration`
- The graph invocation flows through the new `resolveContactRef` node without crashing
- When `monica-integration` cannot reach a real Monica instance, the system degrades gracefully rather than producing 500 errors
- The real network path through the Docker internal network works (ai-router -> monica-integration -> user-management for credentials)

### Step 9: Update Graph Index Exports

**What:** Export the new node from the graph index.

**Files to modify:**
- `services/ai-router/src/graph/index.ts` -- add export for the new node (if needed by external consumers)

**Details:** If the node is only consumed internally by `graph.ts`, no export is needed. If test utilities need it, add the export.

## Test Strategy

### Unit Tests (Vitest)

| Test File | What to Test | What to Mock |
|-----------|-------------|-------------|
| `graph/__tests__/state.test.ts` | New `contactResolution` and `contactSummariesCache` fields validate correctly; old `resolvedContact` is gone | Nothing |
| `graph/nodes/__tests__/resolve-contact-ref.test.ts` | All resolution outcomes (resolved/ambiguous/no_match), skip for create_contact, skip for null contactRef, graceful degradation on client error, caching behavior | `fetchContactSummaries` (mock HTTP client), OTel tracer |
| `graph/nodes/__tests__/execute-action.test.ts` | Existing tests still pass; new tests for resolved contact flows | DB operations, scheduler client, user-management client |
| `graph/nodes/__tests__/format-response.test.ts` | Disambiguation with real-data-style options | OTel tracer |
| `graph/__tests__/graph.test.ts` | Graph compiles with new node; greeting flows through all 7 nodes | LLM (ChatOpenAI), all deps |

### Integration Tests

- No new integration tests needed for this change. The existing `resolver.test.ts` and `matcher.test.ts` already cover the contact resolution logic. The `client.test.ts` covers the HTTP client.

### TDD Sequence Summary

1. State schema tests (Step 1)
2. Fix all `makeState()` helpers (Step 2)
3. `resolveContactRef` node tests (Step 3) -- 6 failing tests, then implementation
4. Graph topology tests (Step 4)
5. Execute action tests (Step 6)
6. Format response integration test (Step 7)

## Smoke Test Strategy

**Docker Compose services to start:**
```
docker compose --profile app up -d ai-router monica-integration user-management postgres redis
```

**HTTP checks to run:**

1. **Contact resolution endpoint check:**
   ```
   POST http://localhost:3002/internal/resolve-contact
   Authorization: Bearer <signed JWT>
   Body: { "contactRef": "John", "correlationId": "smoke-cr-1" }
   ```
   Expected: 200 with a `ContactResolutionResult` body (outcome may be `no_match` if no real Monica data is configured, but the response shape must be valid)

2. **Graph process check with contact reference:**
   ```
   POST http://localhost:3002/internal/process
   Authorization: Bearer <signed JWT>
   Body: { "type": "text_message", "userId": "<uuid>", "sourceRef": "smoke:1", "correlationId": "smoke-cr-2", "text": "Add a note to John about the meeting" }
   ```
   Expected: 200 with a GraphResponse body (type: "text" or "confirmation_prompt" or "disambiguation_prompt" -- any of these is acceptable; the key is that it does not return an error)

## Security Considerations

1. **Service boundary compliance:** `ai-router` only calls `monica-integration` through the read-only `/internal/contacts/resolution-summaries` endpoint, using a signed JWT with `issuer: "ai-router"` and `audience: "monica-integration"`. This endpoint is already restricted to `ai-router` callers via the `allowedCallers` config in `monica-integration`.

2. **No credential exposure:** `ai-router` never receives Monica API keys. The `ServiceClient` authenticates to `monica-integration` using internal JWTs. `monica-integration` independently fetches credentials from `user-management`.

3. **No raw Monica payload exposure:** The `ContactResolutionSummary` projection is the only data `ai-router` receives. Raw Monica payloads never leave `monica-integration`.

4. **Redaction:** Contact display names and relationship labels appear in disambiguation prompts sent to the user (this is the intended behavior -- the user needs to see them to choose). However, these are NOT logged. The `persistTurn` node only stores compressed summaries ("Responded with disambiguation_prompt"), not the actual contact data.

5. **No PII in logs:** The `resolveContactRef` node must log only the resolution `outcome` and `candidateCount`, never the `contactRef`, display names, or relationship labels. This matches the pattern already established in `contact-resolution/routes.ts`.

6. **Graceful degradation:** If `monica-integration` is unreachable or returns an error, the node returns `no_match` and the system falls through to asking the user for clarification rather than exposing internal errors.

## Risks & Open Questions

1. **LLM-generated `contactId` values:** Currently the LLM may fabricate `contactId` values in `commandPayload` (e.g., `{ contactId: 42, body: "lunch" }`). With contact resolution, the real `contactId` will be injected by the `resolveContactRef` node. Any LLM-fabricated `contactId` should be overridden. The implementation must ensure that when `resolveContactRef` runs successfully and returns `resolved`, the `contactId` from resolution takes precedence over any LLM-provided value. This is already handled because `resolveContactRef` mutates `intentClassification.commandPayload.contactId` directly.

2. **Read queries also need contact resolution:** The `read_query` intents (`query_birthday`, `query_phone`, `query_last_note`) also have `contactId` in their payloads. Currently these bypass `executeAction` and go directly to delivery, but the LLM-generated `contactId` is fabricated. The `resolveContactRef` node should also resolve contacts for `read_query` intents. However, read queries currently pass through the `resolvedContact` and the response is generated by the LLM (which fabricates data). Full read query resolution requires `ai-router` to call `monica-integration` for the actual data, which is a separate concern beyond contact resolution. For this task, the node should at minimum resolve the contact for read queries so the correct `contactId` is available for future read implementation.

3. **Performance impact:** Adding a network call to `monica-integration` for every command with a `contactRef` adds latency. The existing `/internal/contacts/resolution-summaries` endpoint fetches ALL contacts for the user, which may be slow for users with large Monica instances. This is mitigated by:
   - The call happens once per graph invocation (cached in `contactSummariesCache`)
   - The endpoint already has a 30-second timeout
   - For V1, this is acceptable; incremental caching (Redis) can be added later

4. **Disambiguation option label format:** The plan specifies labels like `"Sherry Miller -- friend"`. The exact format should be kept simple and consistent. When a contact has no relationship labels, use just the display name. When multiple labels exist, use the first one.

5. **create_activity with multiple contactIds:** The `create_activity` command has `contactIds: z.array(z.number().int())` (plural). Contact resolution currently handles single `contactRef` strings. For V1, the LLM typically produces one contact reference per activity. Multi-contact resolution is deferred.
