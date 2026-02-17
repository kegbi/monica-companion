---
name: telegram-review-audit
description: Perform strict review for Telegram-first Monica assistant defects, architecture drift, security/safety risk, and missing tests. Use before completion or merge preparation.
---

# Telegram Review Audit

## Severity order
1. Crash/regression risk.
2. Security/safety failures (auth, dedupe/idempotency, spam/rate-limit, secret handling).
3. Contract compatibility breaks (private-chat-only, command-first, digest behavior).
4. Architecture boundary violations.
5. Duplication and maintainability issues.
6. Test coverage gaps.

## Output template
1. Findings (severity-sorted, file + line).
2. Open assumptions/questions.
3. Residual risk.

## Zero-findings rule
If no findings are present, state that explicitly and still report residual testing risk.
