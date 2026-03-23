---
verdict: APPROVED
attempt: 1
critical_count: 0
high_count: 0
medium_count: 5
---

# Plan Review: Stage 4 -- Read-Only Query & Write Tool Handlers

## Findings

### CRITICAL
(none)

### HIGH
(none)

### MEDIUM

1. [MEDIUM] **Reference route over-permissioning (Step 3)** -- The plan changes the global `routes.use(schedulerAuth)` middleware in `reference.ts` (line 21) from `allowedCallers: ["scheduler"]` to `["scheduler", "ai-router"]`. This grants `ai-router` access to ALL reference endpoints, including `GET /genders`, when it only needs `GET /contact-field-types`. This violates the per-endpoint caller allowlist principle in `security.md`: "Each service must enforce per-endpoint caller allowlists. Do not treat a service-wide allowlist as sufficient when endpoints have different privilege levels." -- **Fix:** Instead of modifying the global `routes.use(schedulerAuth)`, split the reference routes into per-endpoint auth. Keep `schedulerAuth` (scheduler-only) on `/genders` and create a separate middleware with `allowedCallers: ["scheduler", "ai-router"]` only for `/contact-field-types`.

2. [MEDIUM] **`create_activity` field mapping risks 255-char truncation** -- The plan maps the tool's `description` argument to the payload's `summary` field, which has a `z.string().max(255)` constraint. -- **Fix:** Add `.max(255)` to `CreateActivityArgsSchema.description` so validation fails early with a self-correctable tool result, or document the 255-char limit in the tool definition's description parameter hint.

3. [MEDIUM] **Hardcoded idempotency key version string** -- The plan constructs the idempotency key as `"${pendingCommandId}:v1"`. The agent loop already has `PENDING_COMMAND_VERSION = 1` as a constant. -- **Fix:** Use the `PENDING_COMMAND_VERSION` constant: `` `${pendingCommandId}:v${PENDING_COMMAND_VERSION}` ``.

4. [MEDIUM] **Duplicated JSON-parse-and-validate pattern in loop dispatch (Step 6)** -- The plan adds 3 new `else if` branches, each duplicating the exact same 4-step pattern already present for `search_contacts`. -- **Fix:** Extract a generic `executeReadOnlyTool(toolName, toolCall, handler, deps)` helper.

5. [MEDIUM] **Missing `name` field in `update_contact_address` payload mapping** -- The `UpdateContactAddressPayloadSchema` includes a `name` field that represents the address label. The plan does not map it. -- **Fix:** Add a default value of `"Main"` in the mapper.

### LOW

1. [LOW] `query_birthday` handler reuses `ContactResolutionSummary` endpoint -- acceptable for V1.
2. [LOW] No caching for `contactFieldTypeId` resolution -- acceptable for V1.
3. [LOW] Nullable vs. optional mismatch in address fields -- works without changes, document the intent.
4. [LOW] Test file count may be optimistic -- let TDD drive actual count.

## Verdict Rationale

The plan is well-structured, correctly identifies all the stubbed code paths that need replacement, and respects the core architectural boundaries. Read-only tools correctly bypass the scheduler and call `monica-integration` directly. Mutating tools correctly flow through `SchedulerClient.execute()`. No critical or high findings. No scope creep detected.
