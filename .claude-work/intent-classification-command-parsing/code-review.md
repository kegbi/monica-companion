---
verdict: REJECTED
attempt: 1
biome_pass: true
tests_pass: true
test_summary: "178 passed, 22 skipped, 0 failed (1 integration test file fails due to missing PostgreSQL -- pre-existing)"
critical_count: 0
high_count: 1
medium_count: 1
---

# Code Review: Intent Classification & Command Parsing

## Automated Checks
- **Biome**: PASS -- 0 errors on 225 source files. (2 formatting errors in `.claude-work/` JSON files are not part of the implementation.)
- **Tests**: 19/20 test files pass, 178 tests pass, 22 skipped. The 1 failing file (`repository.integration.test.ts`) is a pre-existing integration test requiring PostgreSQL.

## Findings

### CRITICAL
(none)

### HIGH

1. [HIGH] `.gitignore:40-41` -- The `.claude-work/` gitignore entry was removed. This is an unintended deletion: the plan did not call for modifying `.gitignore`, and removing this entry would cause the orchestrator work directory (containing state files, plans, reviews) to be tracked by git. Per the review rules, significant deletions in files that should only be appended to are flagged as HIGH. **Fix:** Restore the two removed lines at the end of `.gitignore`:
   ```
   # Orchestrator work directory
   .claude-work/
   ```

### MEDIUM

1. [MEDIUM] `services/ai-router/src/graph/nodes/classify-intent.ts:37` -- The callback_action placeholder hardcodes `detectedLanguage: "en"` rather than attempting to detect the user's language. While callback actions have limited text content, the `action` string could be in any language if the bot later supports localized button labels. **Fix:** Document this limitation with a TODO comment noting that language detection for callback actions should be addressed when full callback handling is implemented.

### LOW

1. [LOW] `services/ai-router/src/graph/nodes/classify-intent.ts:54` -- The catch block silently swallows errors with `_error`. While the comment explains this is intentional to avoid leaking PII/API keys, having zero observability into LLM failures will make debugging difficult in production. **Fix:** Consider emitting a counter metric (e.g., `intent_classification_failures_total`) or a redacted structured log entry with just the error class name (not the message) when the OTel observability layer is wired.

2. [LOW] `services/ai-router/src/graph/llm.ts:32-34` -- `reasoning_effort` is passed via `modelKwargs` which is a catch-all for unsupported parameters. Whether `@langchain/openai` correctly forwards this to the API is untested without real calls. The impl-summary correctly documents this as a residual risk. No action needed now, but the smoke test plan should verify this.

3. [LOW] `services/ai-router/src/graph/system-prompt.ts:14` -- `new Date().toISOString().split("T")[0]` is called on every graph invocation. This is fine for correctness but means the date cannot be controlled in tests without mocking `Date`. Tests currently work by checking the real date, which is fragile if a test runs at midnight UTC. **Fix:** Accept an optional `currentDate` parameter for testability, defaulting to `new Date()`.

## Plan Compliance

The implementation follows the approved plan closely across all 9 steps. Justified deviations:

- **LOW-2 (configurable reasoning_effort)**: Not implemented; hardcoded to "medium" as plan Step 3 specified. Documented in impl-summary.
- **LOW-4 (OTel span attributes)**: Deferred; documented in impl-summary.
- **MEDIUM-1 (typed commandPayload)**: Documented with TODO in `intent-schemas.ts:47`. Appropriately deferred.
- **MEDIUM-2 (OPENAI_API_KEY redaction)**: Already covered by `sk-` pattern in `@monica-companion/redaction/patterns.ts:32`. Verified.
- **MEDIUM-3 (smoke test provisioning)**: Deferred; requires running Docker with valid API key.

The `.gitignore` modification was NOT part of the plan and is flagged as HIGH.

## Verdict Rationale

REJECTED. The implementation is well-structured and all automated checks pass. The code correctly follows service boundaries (no Telegram/Monica types in ai-router), uses Zod for schema validation, has comprehensive test coverage with mocked LLM calls, and properly handles errors with graceful fallbacks. However, the unintended removal of `.claude-work/` from `.gitignore` is a HIGH finding that must be reverted before approval.
