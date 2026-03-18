---
verdict: APPROVED
reviewer: plan-reviewer
date: 2026-03-16
attempt: 1
---

# Plan Review: Observability & Governance Baseline

## Summary

The plan is thorough, well-structured, and correctly scoped for the final Phase 1 deliverable. It covers all three roadmap sub-items (OTel instrumentation, redaction/retention/deletion rules, dashboards and alerts), respects service boundaries, and builds on the existing codebase correctly. The shared-package approach for observability is justified by the fact that all 8 services need identical OTel setup. There are no critical or high-severity issues. Five medium findings address practical implementation gaps and a minor ordering issue.

## Findings

### CRITICAL
(none)

### HIGH
(none)

### MEDIUM

1. [MEDIUM] **Step ordering: catalog entries (Step 3) should precede package implementation (Step 2).** Step 3 explicitly notes "do this before `pnpm install` for the observability package" yet is listed after Step 2. If an implementer follows steps in order, Step 2 will fail at `pnpm install` because the OTel catalog entries do not exist yet. -- **Fix:** Merge Step 3 into Step 2 as a prerequisite sub-step, or renumber so it comes first. The plan already acknowledges this ("separated for clarity"), but the separation creates a footgun.

2. [MEDIUM] **Redaction package already exists as a stub; plan says "create" without acknowledging existing state.** `packages/redaction/` exists with `package.json`, `tsup.config.ts`, and a stub `src/index.ts` exporting nothing. The plan's Step 1 describes creating `packages/redaction/package.json` from scratch. If the implementer literally follows the plan, they might overwrite the existing `package.json` and lose the current `devDependencies` and build config. -- **Fix:** Update Step 1 to say "extend the existing `packages/redaction` stub" and note that the `package.json` already has `tsup` and `typescript` configured. Only the `zod` dependency, source files, and test files need to be added.

3. [MEDIUM] **`initTelemetry` must be called before any other `import` for auto-instrumentation to work, but the plan uses standard static imports.** The plan shows `import { initTelemetry } from "@monica-companion/observability"` as a static import followed by `initTelemetry()` before "importing the app." However, with ES module static imports, all imports are hoisted and evaluated before any module body code runs. For `telegram-bridge`, `createApp` is imported from `./app` in the same file, which imports `hono` -- and `@opentelemetry/instrumentation-http` monkey-patches `http` at registration time. If `initTelemetry()` runs in module body but `hono` is already loaded via a hoisted import, the HTTP auto-instrumentation hooks may be missed. -- **Fix:** Document that `initTelemetry()` should be called in a separate preload module (e.g., `src/instrumentation.ts`) loaded via `node --import ./src/instrumentation.ts` or via the Node.js `--require` flag, OR use dynamic `await import("./app")` after `initTelemetry()` returns.

4. [MEDIUM] **Observability ports (3000, 3100, 3200, 9090, 4317, 4318) are bound to the host in `docker-compose.yml` and thus accessible from the local network.** The plan's Security section (item 3) states "OTel Collector listens on ports 4317/4318 on the `internal` Docker network only. It is not exposed through Caddy." However, the existing `docker-compose.yml` uses `ports:` (not `expose:`) for all observability services, which binds them to `0.0.0.0` on the host. While these are development-only, the plan adds no note about restricting these bindings in production. -- **Fix:** Add a note in the data-governance spec that production deployments must either remove the `ports:` mappings for observability services or bind them to `127.0.0.1` only.

5. [MEDIUM] **Smoke test Check 6 (redaction verification) may produce a false pass.** The redaction check sends an `Authorization: Bearer ...` header to `/health`, then queries Loki for the raw token string. However, the `/health` endpoint may not log the request headers at all, so the token would never appear in logs regardless of redaction. -- **Fix:** The smoke test should target an endpoint that actually processes/logs request metadata, or explicitly generate a log line with `createLogger` that includes a sensitive value, then verify it is redacted in Loki.

### LOW

1. [LOW] **`@monica-companion/redaction` dependency in individual service `package.json`.** Services that only use the observability package don't need a direct `redaction` dependency; the transitive dependency is sufficient.

2. [LOW] **Four dashboards described but only three JSON files in Step 10.** Reconcile the dashboard list in the Architecture Decisions section to match the three files in Step 10.

3. [LOW] **No LOG_LEVEL config in the `initTelemetry` config schema.** Include `LOG_LEVEL` as an optional field in the observability config schema with a default of `"info"`.

4. [LOW] **Grafana anonymous admin access in development.** Add the anonymous admin role disablement to the production-hardening notes in `data-governance.md`.

## Verdict Rationale

The plan is **APPROVED**. It correctly addresses all three roadmap sub-items, respects architecture and service boundaries, follows KISS by consolidating OTel setup into a single shared package, and provides comprehensive TDD sequences and smoke test coverage. The redaction-as-defense-in-depth design is sound. Security invariants from `security.md` are maintained. The scope is appropriate.

The five medium findings are all implementation-quality improvements, not architectural problems. None represent design-level risks that would require plan restructuring. The most important one (MEDIUM-3, OTel initialization order) is a well-known Node.js OTel concern that the implementer should address during Step 4 but does not change the overall plan structure.
