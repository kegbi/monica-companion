---
name: telegram-feature-delivery
description: Deliver Telegram-first Monica assistant features with a repeatable planner-implementer-reviewer-test loop. Use for medium/large feature work and architecture-sensitive edits.
---

# Telegram Feature Delivery

## Pipeline
1. Build a task contract first (objective, scope, validations, quality targets, stop conditions).
2. Plan with architecture contract first.
3. Implement in vertical slices.
4. Run review pass focused on regressions/architecture/duplication/safety.
5. Run targeted lint/tests.
6. Iterate until acceptance criteria are met.

## Implementation rules
1. Preserve PRD service boundaries and avoid cross-service leakage.
2. Keep Telegram API usage in Bot/Delivery and Monica API usage in Monica Integration.
3. Preserve command-first behavior and private-chat-only policy.
4. Add tests in module-aligned folders and keep scheduler/delivery reliability behavior covered when touched.

## Completion checklist
1. Behavior implemented.
2. Contracts preserved or migration documented.
3. Relevant tests pass.
4. No unresolved high/medium review findings.
5. Residual risks are documented.
