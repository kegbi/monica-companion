---
verdict: REJECTED
attempt: 1
critical_count: 1
high_count: 0
medium_count: 4
---

# Plan Review: Stage 1 — Agent Loop Foundation

## Findings

### CRITICAL

1. [CRITICAL] **Step 12 removes `@langchain/*` dependencies while Step 8 explicitly retains old graph code until Stage 6.** The `ai-router/tsconfig.json` has `"include": ["src"]`, meaning TypeScript type-checks ALL `.ts` files under `src/`. Five files directly import from `@langchain/*`:
   - `src/graph/graph.ts` imports `{ END, START, StateGraph }` from `@langchain/langgraph`
   - `src/graph/state.ts` imports `{ Annotation }` from `@langchain/langgraph`
   - `src/graph/llm.ts` imports `{ ChatOpenAI }` from `@langchain/openai`
   - `src/graph/nodes/classify-intent.ts` imports `{ HumanMessage, SystemMessage }` from `@langchain/core/messages`
   - `src/__tests__/llm-integration/llm-integration.test.ts` imports from `@langchain/core/messages`

   After Step 12, `tsc` type-checking, Biome checks, and Vitest (which resolves these test files) will all fail because the `@langchain/*` modules no longer exist. Step 12 also removes the `@langchain/core/messages` alias from `vitest.config.ts`, compounding the breakage. The plan states "Old graph code NOT deleted (Stage 6). Just no longer called" (Step 8) — but "not called" is not the same as "not compiled".

   **Fix:** Defer LangChain dependency removal from `package.json` and `pnpm-workspace.yaml` to Stage 6, when the old graph code is actually deleted. In Stage 1, add `openai` to `ai-router/package.json` alongside the existing `@langchain/*` entries. Both dependency sets coexist during the transition (Stages 1-5). Step 12 should be reduced to: add `openai: "catalog:"` to `ai-router/package.json`, add new env vars to `.env.example` and `docker-compose.yml`.

### MEDIUM

1. [MEDIUM] **No Docker Compose smoke test step.** The plan has 13 implementation steps and a TDD sequence but does not include a final smoke test step verifying the live Docker Compose stack. Per `.claude/rules/completion.md`: "A roadmap item is only marked complete after full verification passes, including Docker Compose smoke tests against the live stack." Per `.claude/rules/testing.md`: "Smoke tests must verify the actual network path (reverse proxy, middleware, port exposure)."

   **Fix:** Add a Step 14: "Docker Compose Smoke Test" that spins up the relevant services, runs the existing smoke test suite or curl-based checks, and verifies the agent loop returns valid `GraphResponse` shapes through the actual network path.

2. [MEDIUM] **`userId` column type inconsistency within `ai-router`.** The plan defines `conversationHistory.userId` as `text("user_id")` but existing `conversationTurns` and `pendingCommands` tables use `uuid("user_id")`. The user purge route validates `userId` as `z.string().uuid()`.

   **Fix:** Use `uuid("user_id")` for `conversationHistory` to maintain consistency with the existing `ai-router` schema.

3. [MEDIUM] **Agent loop delivery integration not specified.** Step 7 does not enumerate what `deps` contains despite referencing delivery. The current `deliverResponse` node requires `DeliveryClient.deliver()` and `UserManagementClient.getDeliveryRouting()`.

   **Fix:** Explicitly list the `deps` interface for `runAgentLoop` in Step 7: `llmClient`, `db`, `deliveryClient`, `userManagementClient`.

4. [MEDIUM] **`search_contacts` tool classification ambiguous in Step 5.** The plan lists `MUTATING_TOOLS` and `READ_ONLY_TOOLS` but doesn't clearly state `search_contacts` belongs to `READ_ONLY_TOOLS`.

   **Fix:** Explicitly state `search_contacts` is in `READ_ONLY_TOOLS`: `new Set(["search_contacts", "query_birthday", "query_phone", "query_last_note"])`.

### LOW

1. [LOW] **Vitest resolve alias for `openai` SDK not mentioned.** May need alias similar to other deps in `vitest.config.ts`.

2. [LOW] **Plan does not mention updating `setupBot` ordering comment and `SetupDeps` type** when adding `/clear` command.

3. [LOW] **`OPENAI_API_KEY` retention rationale could be clearer.** Clarify it remains specifically because `guardrailMiddleware` references it.

## Verdict

**REJECTED** due to CRITICAL-1: Step 12 creates a build-time failure by removing `@langchain/*` dependencies while the graph code that imports them is explicitly retained. Fix: defer dep removal to Stage 6, only add `openai` SDK in Stage 1. Address MEDIUM findings in revised plan.
