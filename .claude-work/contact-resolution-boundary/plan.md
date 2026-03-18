# Implementation Plan: Contact Resolution Boundary

## Objective

This task group completes the contact resolution boundary between `monica-integration` and `ai-router`. While the `ContactResolutionSummary` Zod schema, the Monica-to-projection mapping function, and the `GET /internal/contacts/resolution-summaries` endpoint already exist, the ai-router side is empty: there is no client to call the endpoint, no contact matching/ranking logic, no ambiguity detection, and no enforcement that ai-router never touches raw Monica types. This plan fills those gaps so that ai-router can resolve a user's natural language contact reference (e.g., "Mom", "Sherry", "my brother") to a ranked list of `ContactResolutionSummary` candidates and decide whether the match is unambiguous or requires disambiguation.

## Scope

### In Scope

1. A typed HTTP client in `ai-router` that calls `monica-integration`'s `GET /internal/contacts/resolution-summaries` endpoint and returns `ContactResolutionSummary[]`.
2. A deterministic contact matching module in `ai-router` that scores candidates against a natural-language contact reference string.
3. Deterministic ranking rules covering: exact display-name match, first-name match, nickname/alias match, relationship-label match (kinship like "mom", "brother", "colleague"), and recency tiebreaker.
4. Ambiguity thresholds: when the top match is unambiguous (auto-select) versus when disambiguation choices must be presented.
5. A `ContactResolutionResult` Zod schema in `@monica-companion/types` describing the output of the resolution process (resolved contact, disambiguation candidates, or no-match).
6. `MONICA_INTEGRATION_URL` config variable added to `ai-router`.
7. Boundary enforcement: a build-time verification that `ai-router` never imports from `@monica-companion/monica-api-lib` or any Monica-specific type.
8. Tests for all of the above.

### Out of Scope

- LLM-assisted contact resolution (fuzzy NLP matching using GPT). V1 uses deterministic string matching only. The LLM extracts a contact reference string from user input; this module matches it against the projection.
- Contact projection caching or incremental refresh. V1 fetches the full projection per request. Caching is a future optimization.
- Wiring contact resolution into the LangGraph conversation flow (that belongs to a later task).
- Changes to the `monica-integration` endpoint itself (it is already built and tested).
- Changes to the `ContactResolutionSummary` schema (it is already correct per the architecture docs).

## Affected Services & Packages

| Package/Service | Changes |
|---|---|
| `packages/types` | Add `ContactResolutionResult`, `ContactMatchCandidate`, `ContactResolutionRequest` Zod schemas. |
| `services/ai-router` | Add config for `MONICA_INTEGRATION_URL`. Add `contact-resolution/` module with client, matcher, and resolver. Add boundary enforcement test. |
| `docker-compose.yml` | Add `MONICA_INTEGRATION_URL` env var to `ai-router` service. |

## Implementation Steps

### Step 1: Add contact resolution result schemas to `@monica-companion/types`

**What:** Define Zod schemas for the output of the contact resolution process. These are Monica-agnostic contracts that `ai-router` (and eventually `delivery`) will use.

**Files to create/modify:**
- `packages/types/src/contact-resolution.ts` -- add new schemas alongside existing `ContactResolutionSummary`
- `packages/types/src/index.ts` -- export new schemas
- `packages/types/src/__tests__/contact-resolution.test.ts` -- add tests for new schemas

**New schemas:**

```
ContactMatchCandidate:
  contactId: number (int)
  displayName: string
  score: number (0.0 to 1.0)
  matchReason: enum ["exact_display_name", "exact_first_name", "alias_match", "relationship_label_match", "partial_match"]

ContactResolutionResult:
  outcome: enum ["resolved", "ambiguous", "no_match"]
  resolved: ContactResolutionSummary | null  (present when outcome is "resolved")
  candidates: ContactMatchCandidate[]  (present when outcome is "ambiguous", empty otherwise)
  query: string  (the original contact reference string for auditability)

ContactResolutionRequest:
  userId: string (uuid)
  contactRef: string  (the natural-language contact reference extracted by the LLM, e.g. "Mom", "Sherry Miller")
  correlationId: string
```

**Expected outcome:** New schemas parse and validate correctly; existing schemas are unchanged.

**TDD sequence:**
1. Write failing tests for `ContactMatchCandidate.safeParse()`, `ContactResolutionResult.safeParse()`, and `ContactResolutionRequest.safeParse()` with valid and invalid inputs.
2. Implement the schemas.
3. Verify tests pass.

### Step 2: Add `MONICA_INTEGRATION_URL` to ai-router config

**What:** ai-router needs to know how to reach monica-integration. Add the config variable.

**Files to modify:**
- `services/ai-router/src/config.ts` -- add `MONICA_INTEGRATION_URL` to schema and `Config` interface
- `services/ai-router/src/__tests__/config.test.ts` -- add test for new env var
- `docker-compose.yml` -- add env var to ai-router service definition

**Expected outcome:** `loadConfig()` requires `MONICA_INTEGRATION_URL` and makes it available as `config.monicaIntegrationUrl`.

**TDD sequence:**
1. Write failing config test that expects `monicaIntegrationUrl` on the config object.
2. Add the field to the schema and Config interface.
3. Verify test passes.

### Step 3: Implement the contact resolution client in ai-router

**What:** A thin HTTP client that calls `GET /internal/contacts/resolution-summaries` on `monica-integration`, authenticating with a service JWT. Returns `ContactResolutionSummary[]`. This client uses `@monica-companion/auth`'s `createServiceClient` and validates the response against the `ContactResolutionSummary` schema from `@monica-companion/types`.

**Files to create:**
- `services/ai-router/src/contact-resolution/client.ts` -- the client module
- `services/ai-router/src/contact-resolution/__tests__/client.test.ts` -- unit test with mocked fetch

**Design:**
- Function signature: `fetchContactSummaries(config: Config, userId: string, correlationId: string): Promise<ContactResolutionSummary[]>`
- Uses `createServiceClient({ issuer: "ai-router", audience: "monica-integration", ... })`.
- Validates the response body `{ data: ContactResolutionSummary[] }` with Zod.
- Throws a typed `ContactResolutionClientError` on network/validation failures.
- No caching in V1; every call fetches fresh data.

**Expected outcome:** The client can call the monica-integration endpoint and return typed, validated summaries.

**TDD sequence:**
1. Write failing test: mock fetch to return a valid response, assert `fetchContactSummaries()` returns parsed `ContactResolutionSummary[]`.
2. Write failing test: mock fetch to return a 502, assert it throws `ContactResolutionClientError`.
3. Write failing test: mock fetch to return an invalid body, assert it throws on Zod validation.
4. Implement the client function.
5. Verify all tests pass.

### Step 4: Implement the deterministic contact matcher

**What:** A pure function that takes a contact reference string and a list of `ContactResolutionSummary` and returns scored candidates. This is the core ranking algorithm.

**Files to create:**
- `services/ai-router/src/contact-resolution/matcher.ts` -- the matching logic
- `services/ai-router/src/contact-resolution/__tests__/matcher.test.ts` -- comprehensive test suite

**Matching algorithm (deterministic, no LLM):**

The matcher normalizes the query and each candidate field to lowercase and trims whitespace for comparison.

**Scoring tiers (highest to lowest):**

| Priority | Match Type | Score | Example |
|---|---|---|---|
| 1 | Exact `displayName` match | 1.0 | Query "John Doe" matches displayName "John Doe (Johnny)" after stripping the parenthetical nickname portion. Note: also match the full `displayName` including parenthetical. |
| 2 | Exact `first_name + last_name` match (derived from aliases) | 0.95 | Query "John Doe" matches aliases containing "John" and "Doe" |
| 3 | Exact relationship label match | 0.90 | Query "my partner" matches relationshipLabel "partner"; query "mom" matches relationshipLabel "parent" |
| 4 | Exact single-name/alias match | 0.80 | Query "Johnny" matches alias "Johnny" |
| 5 | Prefix match on first name or alias | 0.60 | Query "Jon" matches first_name "John" (prefix) |
| 6 | No match | 0.0 | |

**Relationship label normalization map:** A static lookup table that maps common natural-language kinship terms to Monica relationship type names:
- "mom", "mother" -> "parent"
- "dad", "father" -> "parent"
- "brother", "sister" -> "sibling"
- "grandma", "grandmother", "grandpa", "grandfather" -> "grandparent"
- "uncle", "aunt" -> "uncle" (Monica uses "uncle" for both)
- "nephew", "niece" -> "nephew"
- "cousin" -> "cousin"
- "wife", "husband" -> "spouse"
- "boss" -> "boss"
- "colleague", "coworker" -> "colleague"
- "friend", "buddy" -> "friend"
- "bestfriend", "best friend" -> "bestfriend"

This map is English-only in V1. Multi-language kinship normalization will be handled by GPT extracting a canonical English relationship term before passing it to the matcher.

**Tiebreaker for equal scores:** When two or more candidates have the same score, `lastInteractionAt` is used as a deterministic tiebreaker: more recently interacted contacts rank higher. If `lastInteractionAt` is null, the contact ranks below those with a date. If both are null, `contactId` (ascending) is the final tiebreaker for determinism.

**Function signature:**
```typescript
function matchContacts(
  query: string,
  candidates: ContactResolutionSummary[],
): ContactMatchCandidate[]
```

Returns all candidates with score > 0, sorted by score descending, then by tiebreaker.

**Expected outcome:** Given a query and candidate list, the matcher returns a deterministically ranked list of candidates with scores and match reasons.

**TDD sequence (specific test cases):**
1. Exact displayName: query "John Doe (Johnny)" against fixture, expect score 1.0.
2. Exact first+last: query "John Doe" against fixture, expect score 0.95.
3. Relationship label: query "my partner" against fixture with relationshipLabel ["partner"], expect score 0.90.
4. Kinship normalization: query "Mom" against candidate with relationshipLabel ["parent"], expect score 0.90.
5. Single alias match: query "Johnny" against fixture with alias "Johnny", expect score 0.80.
6. Prefix match: query "Joh" against fixture with first_name "John", expect score 0.60.
7. No match: query "Xavier" against fixture, expect empty results.
8. Duplicate names: two contacts named "Sherry" (one with alias "Sherry Miller", one "Sherry Chen"), query "Sherry", expect both returned with score 0.80, ordered by recency tiebreaker.
9. Tiebreaker: two contacts with same score, one has `lastInteractionAt` = "2026-03-10", other is null; first ranks higher.
10. Case insensitivity: query "johnny" matches alias "Johnny".
11. Relationship + name: query "brother Alex" -- the word "brother" maps to "sibling", "Alex" matches a name. If one contact matches both, it gets the higher of the two scores (relationship match at 0.90).

### Step 5: Implement the contact resolver (orchestrator)

**What:** A function that composes the client and matcher to produce a `ContactResolutionResult`. It applies the ambiguity threshold to decide the outcome.

**Files to create:**
- `services/ai-router/src/contact-resolution/resolver.ts` -- the resolver
- `services/ai-router/src/contact-resolution/__tests__/resolver.test.ts` -- tests
- `services/ai-router/src/contact-resolution/index.ts` -- barrel export

**Ambiguity thresholds:**

| Condition | Outcome |
|---|---|
| Top candidate score >= 0.90 AND gap to second candidate >= 0.10 (or only one candidate) | `resolved` -- auto-select top candidate |
| Top candidate score >= 0.60 AND (gap to second < 0.10 OR multiple candidates score >= 0.80) | `ambiguous` -- return top N candidates (max 5) for disambiguation |
| Top candidate score < 0.60 OR no candidates | `no_match` |

The threshold constants are defined as named constants, not magic numbers, for easy tuning.

**Function signature:**
```typescript
async function resolveContact(
  config: Config,
  request: ContactResolutionRequest,
): Promise<ContactResolutionResult>
```

Internally:
1. Call `fetchContactSummaries()` to get the user's contacts.
2. Call `matchContacts()` with the `contactRef` and the summaries.
3. Apply the ambiguity threshold to classify the outcome.
4. Return the `ContactResolutionResult`.

**Expected outcome:** The resolver returns a typed result that downstream code can use to decide whether to auto-fill a contact ID, present disambiguation buttons, or ask the user to rephrase.

**TDD sequence:**
1. Mock the client to return a list with one unambiguous match; assert outcome is "resolved" with the correct contact.
2. Mock the client to return a list with two close matches; assert outcome is "ambiguous" with both candidates.
3. Mock the client to return an empty list; assert outcome is "no_match".
4. Mock the client to return a list where no candidate scores above 0.60; assert outcome is "no_match".
5. Mock the client to throw `ContactResolutionClientError`; assert the error propagates with a meaningful message.

### Step 6: Add boundary enforcement test

**What:** A build/test-time check that `ai-router` never imports from `@monica-companion/monica-api-lib`. This enforces the architectural rule that ai-router only sees the Monica-agnostic projection.

**Files to create:**
- `services/ai-router/src/__tests__/boundary-enforcement.test.ts`

**Design:** A Vitest test that scans all `.ts` files under `services/ai-router/src/` for import statements containing `@monica-companion/monica-api-lib` or `monica-api-lib`. If any are found, the test fails with a descriptive message referencing the service-boundary rule.

This is a lightweight static analysis test, not a runtime check. It catches accidental imports during development.

**TDD sequence:**
1. Write the test (it should pass against the current codebase which has no such imports).
2. Verify it would fail by temporarily adding a mock import (then remove it).

### Step 7: Wire contact resolution into ai-router app

**What:** Expose the contact resolution capability so that the LangGraph conversation flow (built in a later task) can call it. For now, add an internal endpoint `POST /internal/resolve-contact` that the future LangGraph nodes will call internally (or that can be tested via HTTP).

**Files to modify:**
- `services/ai-router/src/app.ts` -- mount the new route
- `services/ai-router/src/index.ts` -- no changes needed (config already flows through)

**Files to create:**
- `services/ai-router/src/contact-resolution/routes.ts` -- Hono route handler

**Endpoint design:**
```
POST /internal/resolve-contact
Auth: serviceAuth({ audience: "ai-router", allowedCallers: ["telegram-bridge"] })
Body: ContactResolutionRequest (validated with Zod)
Response 200: ContactResolutionResult
Response 400: { error: "Invalid request" }
Response 502: { error: "Contact resolution service unavailable" }
```

Note: In the final system, this endpoint is called by the LangGraph orchestration within ai-router itself, or by telegram-bridge forwarding a user message. The endpoint ensures the contract is testable over HTTP.

**Expected outcome:** The endpoint returns a `ContactResolutionResult` for valid requests.

**TDD sequence:**
1. Write failing test: POST with valid body returns 200 with expected `ContactResolutionResult` shape.
2. Write failing test: POST with invalid body returns 400.
3. Write failing test: POST when monica-integration is down returns 502.
4. Implement the route handler.
5. Verify all tests pass.

### Step 8: Update Docker Compose and integration test

**What:** Add the `MONICA_INTEGRATION_URL` environment variable to the ai-router service in `docker-compose.yml`.

**Files to modify:**
- `docker-compose.yml` -- add `MONICA_INTEGRATION_URL: http://monica-integration:3004` to ai-router's environment

**Expected outcome:** ai-router can reach monica-integration over the Docker network.

## Schema Definitions

### ContactMatchCandidate (in `packages/types/src/contact-resolution.ts`)

```typescript
export const MatchReason = z.enum([
  "exact_display_name",
  "exact_first_name",
  "alias_match",
  "relationship_label_match",
  "partial_match",
]);

export const ContactMatchCandidate = z.object({
  contactId: z.number().int(),
  displayName: z.string(),
  score: z.number().min(0).max(1),
  matchReason: MatchReason,
});
```

### ContactResolutionResult (in `packages/types/src/contact-resolution.ts`)

```typescript
export const ResolutionOutcome = z.enum(["resolved", "ambiguous", "no_match"]);

export const ContactResolutionResult = z.object({
  outcome: ResolutionOutcome,
  resolved: ContactResolutionSummary.nullable(),
  candidates: z.array(ContactMatchCandidate),
  query: z.string(),
});
```

### ContactResolutionRequest (in `packages/types/src/contact-resolution.ts`)

```typescript
export const ContactResolutionRequest = z.object({
  userId: z.string().uuid(),
  contactRef: z.string().min(1).max(500),
  correlationId: z.string(),
});
```

## API Contracts

### ai-router -> monica-integration (existing, no changes)

```
GET /internal/contacts/resolution-summaries
Auth: service JWT (issuer: ai-router, audience: monica-integration)
Headers: X-Correlation-ID, Authorization: Bearer <jwt> with subject=userId
Response 200: { data: ContactResolutionSummary[] }
```

### telegram-bridge -> ai-router (new)

```
POST /internal/resolve-contact
Auth: service JWT (issuer: telegram-bridge, audience: ai-router)
Request body: ContactResolutionRequest
Response 200: ContactResolutionResult
Response 400: { error: "Invalid request" }
Response 502: { error: "Contact resolution service unavailable" }
```

## Ranking & Ambiguity Algorithm

### Matching Pipeline

1. **Normalize query:** lowercase, trim whitespace, strip possessives ("Mom's" -> "Mom"), strip leading "my " ("my brother" -> "brother").
2. **For each candidate, compute the highest applicable score:**
   - Check exact displayName match (1.0)
   - Check exact first+last name combination from aliases (0.95)
   - Check relationship label match with kinship normalization (0.90)
   - Check exact single alias/name match (0.80)
   - Check prefix match (query is prefix of any name/alias, minimum 2 chars) (0.60)
3. **Assign the highest matching score and the corresponding match reason.**
4. **Filter out candidates with score 0.**
5. **Sort by score descending, then by lastInteractionAt descending (nulls last), then by contactId ascending.**

### Ambiguity Decision

```
RESOLVED_THRESHOLD = 0.90
AMBIGUITY_GAP_THRESHOLD = 0.10
MINIMUM_MATCH_THRESHOLD = 0.60
MAX_DISAMBIGUATION_CANDIDATES = 5

candidates = matchContacts(query, summaries)

if candidates is empty:
  return no_match

topScore = candidates[0].score
secondScore = candidates.length > 1 ? candidates[1].score : 0

if topScore >= RESOLVED_THRESHOLD and (topScore - secondScore) >= AMBIGUITY_GAP_THRESHOLD:
  return resolved(candidates[0])

if topScore >= MINIMUM_MATCH_THRESHOLD:
  return ambiguous(candidates.slice(0, MAX_DISAMBIGUATION_CANDIDATES))

return no_match
```

### Kinship Term Normalization Table

A static `Map<string, string>` in the matcher module:

| User term (normalized to lowercase) | Monica relationship type name |
|---|---|
| mom, mother, mama, mum | parent |
| dad, father, papa | parent |
| brother, bro | sibling |
| sister, sis | sibling |
| grandma, grandmother, nana | grandparent |
| grandpa, grandfather | grandparent |
| uncle | uncle |
| aunt, auntie | uncle |
| nephew | nephew |
| niece | nephew |
| cousin | cousin |
| wife | spouse |
| husband | spouse |
| partner | partner |
| boyfriend | partner |
| girlfriend | partner |
| boss | boss |
| colleague, coworker | colleague |
| friend, buddy, pal | friend |
| best friend, bestfriend, bff | bestfriend |
| mentor | mentor |
| godfather, godmother | godparent |

When the query (after stripping "my ") maps to a relationship type, the matcher checks each candidate's `relationshipLabels` array. If the label is "parent" and the query was "mom"/"mother", this is a relationship label match.

Note: When the query is a kinship term like "Mom", we match against relationship labels. When the query is a name like "Maria", we match against displayName/aliases. When the query is "Mom Maria" or "brother Alex", we first check if any word maps to a relationship term, and if so, we treat the remaining words as a name filter to narrow down among contacts that match the relationship. This compound matching is handled by: score = max(relationship_score, name_score) for each candidate, but if both match, score = max(relationship_score, name_score) (no additive bonus -- keep it simple for V1).

### Duplicate-Name Scenarios

When two contacts share a first name (e.g., two "Sherry"s), both will score equally on alias match (0.80). Because 0.80 < 0.90 (RESOLVED_THRESHOLD), or because the gap is < 0.10, the system will always return "ambiguous" and present disambiguation choices. The candidates include `displayName` (which includes last name and nickname) and `relationshipLabels` to help the user distinguish them.

## Test Strategy

### Unit Tests (Vitest)

| Module | What to test | Mocking |
|---|---|---|
| `packages/types` schemas | Valid/invalid parsing of `ContactMatchCandidate`, `ContactResolutionResult`, `ContactResolutionRequest` | None |
| `ai-router/contact-resolution/client.ts` | Successful fetch, HTTP error mapping, invalid response body, timeout | Mock `createServiceClient` to return a mock fetch |
| `ai-router/contact-resolution/matcher.ts` | All 11 test cases from Step 4 plus edge cases | None (pure function) |
| `ai-router/contact-resolution/resolver.ts` | Resolved/ambiguous/no_match outcomes, error propagation | Mock client |
| `ai-router/contact-resolution/routes.ts` | HTTP 200/400/502 responses | Mock resolver |
| `ai-router/boundary-enforcement.test.ts` | No `monica-api-lib` imports in ai-router source | None (filesystem scan) |

### Integration Tests

| What | Infrastructure needed |
|---|---|
| ai-router -> monica-integration HTTP call | Real Postgres (for user-management), both services running in Docker Compose test profile |

Integration tests are deferred to the smoke test since the contact resolution client is a thin HTTP wrapper and the matching logic is pure.

### TDD Sequence (ordered)

1. Schema tests for new types (Step 1)
2. Config test (Step 2)
3. Client tests (Step 3)
4. Matcher tests -- this is the largest and most important test suite (Step 4)
5. Resolver tests (Step 5)
6. Boundary test (Step 6)
7. Route handler tests (Step 7)

## Smoke Test Strategy

### Services to start

```bash
docker compose --profile app up -d ai-router monica-integration user-management postgres redis
```

### HTTP checks

1. **Health check ai-router:**
   ```bash
   curl -s http://localhost:3002/health | jq .status
   # Expected: "ok"
   ```

2. **Health check monica-integration:**
   ```bash
   curl -s http://localhost:3004/health | jq .status
   # Expected: "ok"
   ```

3. **Contact resolution endpoint (requires a test user with Monica credentials):**
   This smoke test requires a user with valid Monica credentials in the database. If user-management is seeded with a test user:
   ```bash
   # Generate a service JWT for telegram-bridge -> ai-router
   TOKEN=$(node -e "const {signServiceToken}=require('@monica-companion/auth'); signServiceToken({issuer:'telegram-bridge',audience:'ai-router',secret:process.env.JWT_SECRET,subject:'test-user-id',correlationId:'smoke-1'}).then(t=>console.log(t))")

   curl -s -X POST http://localhost:3002/internal/resolve-contact \
     -H "Authorization: Bearer $TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"userId":"test-user-id","contactRef":"John","correlationId":"smoke-1"}' \
     | jq .outcome
   # Expected: one of "resolved", "ambiguous", "no_match"
   ```

4. **Boundary verification:** The smoke test also proves that ai-router talks to monica-integration over the Docker internal network (not directly to Monica), confirming the anti-corruption boundary.

### What the smoke test proves

- ai-router can reach monica-integration over the Docker internal network.
- Service-to-service JWT authentication works end-to-end.
- The contact resolution endpoint accepts requests, calls monica-integration, and returns a valid `ContactResolutionResult`.
- No Monica-specific types or credentials leak into the ai-router response.

### Teardown

```bash
docker compose --profile app down
```

## Security Considerations

1. **No credential leaks:** ai-router never sees Monica API tokens. The `fetchContactSummaries()` client authenticates to monica-integration with a service JWT; monica-integration resolves credentials internally via user-management. The `ContactResolutionSummary` projection contains no secrets.

2. **Service-to-service auth on all endpoints:** The new `POST /internal/resolve-contact` endpoint on ai-router requires a service JWT with `audience: "ai-router"` and `allowedCallers: ["telegram-bridge"]`. The existing `GET /internal/contacts/resolution-summaries` endpoint on monica-integration already restricts to `allowedCallers: ["ai-router"]`.

3. **No raw Monica payloads:** The boundary enforcement test (Step 6) ensures ai-router never imports `@monica-companion/monica-api-lib`. All contact data flows through the `ContactResolutionSummary` projection.

4. **Redaction:** The `contactRef` (user's natural language input) may contain personal names. It is included in the `ContactResolutionResult` for auditability but must be redacted from logs and traces via `@monica-companion/redaction`. Any logging in the client or resolver must use the redaction package.

5. **Request validation:** All inbound payloads are validated with Zod schemas (`ContactResolutionRequest`). Invalid payloads are rejected with 400 before any processing.

6. **No public exposure:** The `POST /internal/resolve-contact` endpoint is internal-only (not routed through Caddy).

## Risks & Open Questions

1. **Performance of full contact fetch per request:** V1 fetches all contacts from Monica on every resolution request. For users with thousands of contacts, this could be slow (10+ seconds at Monica's 60 req/min rate limit). Mitigation: This is acceptable for V1 as documented in `monica-api-scope.md`. A short-lived cache (e.g., 5-minute TTL in Redis) is a natural follow-up optimization but is explicitly out of scope for this task.

2. **English-only kinship normalization:** The kinship term map is English-only. Users speaking other languages will rely on the LLM to translate kinship terms to English before passing them to the matcher. If the LLM fails to normalize, the matcher will fall back to name matching. This is a known V1 limitation.

3. **Relationship label matching for "parent" ambiguity:** If a user says "Mom" and has two contacts with `relationshipLabel: ["parent"]` (mother and father), both will match equally. The disambiguation flow will present both. This is correct behavior -- the system should not guess which parent the user means.

4. **Score threshold tuning:** The thresholds (0.90 for auto-resolve, 0.10 gap, 0.60 minimum) are initial values. They should be tuned against the benchmark set in the "Benchmark & Quality Gates" roadmap task. The constants are named and centralized for easy adjustment.

5. **Compound queries ("brother Alex"):** The V1 matcher handles compound queries by checking relationship and name separately and taking the max score. A more sophisticated approach (requiring both relationship AND name to match) would be more precise but adds complexity. V1 keeps it simple; the benchmark results will determine if this needs refinement.
